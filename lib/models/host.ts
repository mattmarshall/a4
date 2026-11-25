/**
 * The model host. It owns everything a plugin must not decide: which
 * operations, presets, and instructions may run (from the card), what a valid
 * result is (plane shapes),
 * whether a page fits (laid out here, never trusted from the model), how many
 * repairs to ask for, and consent for plugins that send text off the device.
 */

import { clone, create } from "@bufbuild/protobuf";
import {
  DescribeRequestSchema,
  ModelCardSchema,
  Operation,
  PrepareRequestSchema,
  ScoreRequestSchema,
  StatusRequestSchema,
  TransformRequestSchema,
  View,
  type ModelCard,
} from "../gen/a4/v1/model_pb.js";
import { SheetSchema, type Sheet, type TextSpan } from "../gen/a4/v1/sheet_pb.js";
import { type PageSpec, normalizeText, pageFit } from "../page/index.ts";
import { encodeGrid } from "../tensor/codec.ts";
import { pageSpecMessage, presetEnum, verifySheet } from "../tensor/record.ts";
import { remoteHost } from "./capabilities.ts";
import { closeClient, type SheetModelClient } from "./client.ts";
import { ConsentBroker, type ConsentRequest, type ConsentToken } from "./consent.ts";
import { CredentialStore } from "./credentials.ts";
import { ErrorCode, ModelError, toModelError } from "./errors.ts";
import { pluginIdOf, type PluginId } from "./plugin-id.ts";
import { isClosed } from "./worker-transport.ts";

/** What the host gives a plugin when it connects: a getter for its own credentials. */
export interface PluginContext {
  credential(kind: string): string | null;
}

/** A bundled plugin: a static card plus a lazy connection to its code. */
export interface PluginEntry {
  card: ModelCard;
  connect: (context: PluginContext) => Promise<SheetModelClient>;
}

interface PlaneResult {
  pluginId: PluginId;
  pluginName: string;
  name: string;
  label: string;
  /** The page text the values were computed for. */
  text: string;
  rows: number;
  cols: number;
  values: Float32Array;
}

export interface FindingResult {
  kind: string;
  spans: { start: number; end: number }[];
  value: number;
  label: string;
}

export interface ScoreResult {
  planes: PlaneResult[];
  scores: { name: string; value: number }[];
  findings: FindingResult[];
}

export interface TransformOptions {
  instruction: string;
  consent?: ConsentToken;
  signal?: AbortSignal;
  /** At most this many attempts in all (default: the card's `max_attempts`). */
  maxAttempts?: number;
  /** Called as each attempt starts (0 characters) and as it writes. */
  onProgress?: (progress: { attempt: number; maxAttempts: number; characters: number }) => void;
  onAttempt?: (attempt: { attempt: number; maxAttempts: number; rowsUsed: number; fits: boolean }) => void;
}

export interface TransformResult {
  text: string;
  model: string;
  rowsUsed: number;
  rowsAllowed: number;
  fits: boolean;
  /** Rows over the page when it doesn't fit, else 0. */
  overBy: number;
  attempts: number;
  /** The most attempts this request allowed. */
  maxAttempts: number;
}

/**
 * What the host enforces for a plugin, derived once from its card at
 * registration. Kept private, so changing a card object later can't change
 * whether a call needs consent.
 */
interface Policy {
  /** "none": text stays on the device; otherwise where it goes. */
  readonly egress: "none" | { readonly host: string };
}

/** Freeze a message and everything in it. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

interface Registered {
  readonly card: ModelCard;
  readonly policy: Policy;
  readonly connect: (context: PluginContext) => Promise<SheetModelClient>;
}

/** The checks every card passes before the host registers it, bundled or installed. */
export function checkCard(card: ModelCard): void {
  if (!card.id) throw new ModelError(ErrorCode.INVALID_CARD, "A model card needs an id.");
  if (card.operations.includes(Operation.TRANSFORM)) {
    if (!card.transform?.instructions.length)
      throw new ModelError(ErrorCode.INVALID_CARD, `Model "${card.id}" transforms but declares no instructions.`);
    if (card.transform.maxAttempts < 1)
      throw new ModelError(ErrorCode.INVALID_CARD, `Model "${card.id}" transforms but allows no attempts.`);
  }
  if (!card.placement.case) throw new ModelError(ErrorCode.INVALID_CARD, `Model "${card.id}" declares no placement.`);
  if (card.placement.case === "remote" && !card.placement.value.destinationHost) {
    throw new ModelError(
      ErrorCode.INVALID_CARD,
      `Model "${card.id}" sends text off the device but names no destination.`,
    );
  }
}

export class ModelHost {
  readonly #plugins = new Map<PluginId, Registered>();
  readonly #clients = new Map<PluginId, Promise<SheetModelClient>>();
  readonly #consent = new ConsentBroker();

  /**
   * Consent for plugins that send text off the device: the dialog asks for a
   * request and approves it once. Only the host consumes the token.
   */
  readonly consent = {
    request: (id: PluginId, operation: Operation, text: string): ConsentRequest =>
      this.#consent.request(id, operation, text),
  };

  readonly #credentials = new CredentialStore();

  /**
   * The author's credentials for plugins, in memory only, for the kinds each
   * card declares. A plugin gets a getter for its own when it connects.
   */
  readonly credentials = {
    set: (id: PluginId, kind: string, value: string): void => {
      this.#declared(id, kind);
      this.#credentials.set(id, kind, value);
    },
    has: (id: PluginId, kind: string): boolean => this.#credentials.has(id, kind),
    forget: (id: PluginId, kind: string): void => this.#credentials.forget(id, kind),
  };

  #declared(id: PluginId, kind: string): void {
    if (!this.card(id).credentials.some((c) => c.kind === kind)) {
      throw new ModelError(ErrorCode.INVALID_CARD, `Model "${id}" doesn't declare a "${kind}" credential.`);
    }
  }

  /** Register a bundled plugin; returns its id, the only way to call it. */
  register(entry: PluginEntry): PluginId {
    checkCard(entry.card);
    if (this.#plugins.has(pluginIdOf(entry.card)))
      throw new ModelError(ErrorCode.INVALID_CARD, `Model "${entry.card.id}" is already registered.`);
    // A private, frozen copy: later changes to the caller's card object change nothing here.
    const card = deepFreeze(clone(ModelCardSchema, entry.card));
    const host = remoteHost(card);
    const policy: Policy = { egress: host === null ? "none" : { host } };
    const id = pluginIdOf(card);
    this.#plugins.set(id, { card, policy, connect: entry.connect });
    return id;
  }

  /**
   * Remove a plugin: its client is closed (ending its worker or sandbox), and
   * its credentials and any consent already given for it are forgotten.
   * Calls to it then fail as not found. Removing an unknown id does nothing.
   */
  unregister(id: PluginId): void {
    const entry = this.#plugins.get(id);
    if (!entry) return;
    this.#plugins.delete(id);
    const pending = this.#clients.get(id);
    this.#clients.delete(id);
    pending?.then(closeClient, () => {});
    for (const credential of entry.card.credentials) this.#credentials.forget(id, credential.kind);
    this.#consent.revoke(id);
  }

  #policy(id: PluginId): Policy {
    const entry = this.#plugins.get(id);
    if (!entry) throw new ModelError(ErrorCode.NOT_FOUND, `No model "${id}".`);
    return entry.policy;
  }

  list(): ModelCard[] {
    return [...this.#plugins.values()].map((p) => p.card);
  }

  card(id: PluginId): ModelCard {
    const entry = this.#plugins.get(id);
    if (!entry) throw new ModelError(ErrorCode.NOT_FOUND, `No model "${id}".`);
    return entry.card;
  }

  /** Connect once, and check the plugin describes itself as its card says. */
  async #client(id: PluginId): Promise<SheetModelClient> {
    const entry = this.#plugins.get(id);
    if (!entry) throw new ModelError(ErrorCode.NOT_FOUND, `No model "${id}".`);
    let pending = this.#clients.get(id);
    if (pending) {
      // A client whose worker failed is replaced by a fresh connection.
      const client = await pending.catch(() => null);
      if (client && !isClosed(client)) return client;
      if (this.#clients.get(id) === pending) this.#clients.delete(id);
      pending = undefined;
    }
    if (!pending) {
      pending = (async () => {
        const client = await entry.connect({ credential: (kind) => this.#credentials.get(id, kind) });
        const described = await client.describe(create(DescribeRequestSchema));
        if (described.card?.id !== id)
          throw new ModelError(
            ErrorCode.INVALID_CARD,
            `Model "${id}" describes itself as "${described.card?.id ?? ""}".`,
          );
        return client;
      })();
      pending.catch(() => this.#clients.delete(id));
      this.#clients.set(id, pending);
    }
    return pending;
  }

  /** The card, when it declares `operation` and the page's preset (an empty list means every preset). */
  #require(id: PluginId, operation: Operation, spec: PageSpec): ModelCard {
    const card = this.card(id);
    if (!card.operations.includes(operation)) {
      throw new ModelError(
        ErrorCode.UNSUPPORTED_OPERATION,
        `${card.name || id} doesn't support ${Operation[operation].toLowerCase()}.`,
      );
    }
    if (card.presets.length && !card.presets.includes(presetEnum(spec.id))) {
      throw new ModelError(
        ErrorCode.UNSUPPORTED_OPERATION,
        `${card.name || id} doesn't support the ${spec.name} page.`,
      );
    }
    return card;
  }

  /**
   * The sheet in exactly the views the card declares (text, grid, or both),
   * spec always included, and verified before it crosses to the plugin.
   */
  #sheet(card: ModelCard, text: string, spec: PageSpec): Sheet {
    const sheet = create(SheetSchema, {
      spec: pageSpecMessage(spec),
      ...(card.views.includes(View.TEXT) ? { text } : {}),
      ...(card.views.includes(View.GRID) ? { grid: encodeGrid(text, spec) } : {}),
    });
    verifySheet(sheet);
    return sheet;
  }

  /**
   * The one egress guard: every operation that sends page text calls it before
   * contacting the plugin. Text that stays on the device needs no consent.
   */
  #guardEgress(id: PluginId, operation: Operation, text: string, consent?: ConsentToken): void {
    if (this.#policy(id).egress === "none") return;
    this.#consent.consume(consent, id, operation, text);
  }

  async status(id: PluginId): Promise<boolean> {
    const client = await this.#client(id);
    return (await client.status(create(StatusRequestSchema))).ready;
  }

  /** Download and load model files. Call only after the author asks. */
  async prepare(
    id: PluginId,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const client = await this.#client(id);
    try {
      for await (const event of client.prepare(create(PrepareRequestSchema), signal)) {
        onProgress?.(Number(event.loadedBytes), Number(event.totalBytes));
      }
    } catch (error) {
      throw toModelError(error);
    }
  }

  /** Score `text`. A plugin that sends text off the device needs `consent` for exactly this text. */
  async score(
    id: PluginId,
    text: string,
    spec: PageSpec,
    signal?: AbortSignal,
    consent?: ConsentToken,
  ): Promise<ScoreResult> {
    const card = this.#require(id, Operation.SCORE, spec);
    this.#guardEgress(id, Operation.SCORE, text, consent);
    const client = await this.#client(id);
    let response: Awaited<ReturnType<SheetModelClient["score"]>>;
    try {
      response = await client.score(create(ScoreRequestSchema, { sheet: this.#sheet(card, text, spec) }), signal);
    } catch (error) {
      throw toModelError(error);
    }
    const grid = encodeGrid(text, spec);
    const who = card.name || id;
    const names = new Set<string>();
    const planes = response.planes.map((plane): PlaneResult => {
      const [rows, cols, depth = 1] = plane.shape;
      if (
        rows !== grid.rows ||
        cols !== grid.cols ||
        plane.shape.length > 3 ||
        plane.values.length !== rows * cols * depth
      ) {
        throw new ModelError(
          ErrorCode.INVALID_RESULT,
          `${who} returned a ${plane.shape.join(" × ")} plane for a ${grid.rows} × ${grid.cols} grid.`,
        );
      }
      // The sheet paints one value per cell; deeper planes aren't supported yet.
      if (depth !== 1)
        throw new ModelError(
          ErrorCode.INVALID_RESULT,
          `${who} returned a plane with depth ${depth}; only depth 1 is supported.`,
        );
      if (!plane.name) throw new ModelError(ErrorCode.INVALID_RESULT, `${who} returned a plane without a name.`);
      if (names.has(plane.name))
        throw new ModelError(ErrorCode.INVALID_RESULT, `${who} returned two planes named "${plane.name}".`);
      names.add(plane.name);
      if (plane.text !== text)
        throw new ModelError(ErrorCode.INVALID_RESULT, `${card.name || id} scored different text than it was sent.`);
      return {
        pluginId: id,
        pluginName: card.name,
        name: plane.name,
        label: plane.label || plane.name,
        text,
        rows,
        cols,
        values: Float32Array.from(plane.values),
      };
    });
    const span = (s: TextSpan) => {
      if (
        !(
          Number.isInteger(s.start) &&
          Number.isInteger(s.end) &&
          0 <= s.start &&
          s.start <= s.end &&
          s.end <= text.length
        )
      ) {
        throw new ModelError(
          ErrorCode.INVALID_RESULT,
          `${who} returned a span ${s.start}–${s.end} outside the ${text.length}-character page.`,
        );
      }
      return { start: s.start, end: s.end };
    };
    return {
      planes,
      scores: response.scores.map((s) => ({ name: s.name, value: s.value })),
      findings: response.findings.map((f) => ({
        kind: f.kind,
        spans: f.spans.map(span),
        value: f.value,
        label: f.label,
      })),
    };
  }

  /**
   * Run a Transform until a candidate fits the page, asking for repairs with
   * the overflow, for at most `maxAttempts` attempts. Keeps the candidate with
   * the fewest rows when none fits.
   */
  async transform(id: PluginId, text: string, spec: PageSpec, options: TransformOptions): Promise<TransformResult> {
    const card = this.#require(id, Operation.TRANSFORM, spec);
    if (!card.transform?.instructions.includes(options.instruction)) {
      throw new ModelError(
        ErrorCode.UNSUPPORTED_OPERATION,
        `${card.name || id} doesn't take the instruction "${options.instruction}".`,
      );
    }
    this.#guardEgress(id, Operation.TRANSFORM, text, options.consent);
    const client = await this.#client(id);
    const sheet = this.#sheet(card, text, spec);
    const max = Math.max(1, options.maxAttempts ?? card.transform?.maxAttempts ?? 1);
    let resume: Uint8Array = new Uint8Array();
    let last: { rowsUsed: number } | null = null;
    let best: { text: string; rowsUsed: number; model: string } | null = null;
    for (let attempt = 1; attempt <= max; attempt++) {
      if (options.signal?.aborted) throw new ModelError(ErrorCode.CANCELED, "Canceled.");
      options.onProgress?.({ attempt, maxAttempts: max, characters: 0 });
      const request = create(TransformRequestSchema, {
        sheet,
        instruction: options.instruction,
        attempt,
        feedback: last ? { rowsUsed: last.rowsUsed, rowsAllowed: spec.rows } : undefined,
        resume,
      });
      let candidate: { text: string; resume: Uint8Array; model: string } | null = null;
      try {
        for await (const event of client.transform(request, options.signal)) {
          if (event.event.case === "progress") {
            options.onProgress?.({ attempt, maxAttempts: max, characters: event.event.value.characters });
          } else if (event.event.case === "candidate") {
            candidate = event.event.value;
          }
        }
      } catch (error) {
        throw toModelError(error);
      }
      if (!candidate) throw new ModelError(ErrorCode.INVALID_RESULT, `${card.name || id} finished without a result.`);
      const result = normalizeText(candidate.text);
      // The page's one fit rule: rows through the last row with ink.
      const { rowsUsed, fits } = pageFit(result, spec);
      options.onAttempt?.({ attempt, maxAttempts: max, rowsUsed, fits });
      if (!best || rowsUsed < best.rowsUsed) best = { text: result, rowsUsed, model: candidate.model };
      if (fits) {
        return {
          text: result,
          model: candidate.model,
          rowsUsed,
          rowsAllowed: spec.rows,
          fits: true,
          overBy: 0,
          attempts: attempt,
          maxAttempts: max,
        };
      }
      resume = candidate.resume;
      last = { rowsUsed };
    }
    if (!best) throw new ModelError(ErrorCode.INVALID_RESULT, `${card.name || id} finished without a result.`);
    return {
      text: best.text,
      model: best.model,
      rowsUsed: best.rowsUsed,
      rowsAllowed: spec.rows,
      fits: false,
      overBy: best.rowsUsed - spec.rows,
      attempts: max,
      maxAttempts: max,
    };
  }
}
