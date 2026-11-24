/**
 * The model host. It owns everything a plugin must not decide: which
 * operations may run (from the card), what a valid result is (plane shapes),
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
import { type PageSpec, layoutRows, normalizeText } from "../page/index.ts";
import { encodeGrid } from "../tensor/codec.ts";
import { pageSpecMessage } from "../tensor/record.ts";
import type { SheetModelClient } from "./client.ts";
import { consumeConsent, type ConsentToken } from "./consent.ts";
import { ErrorCode, ModelError, toModelError } from "./errors.ts";
import { pluginIdOf, type PluginId } from "./plugin-id.ts";
import { isClosed } from "./worker-transport.ts";

/** A bundled plugin: a static card plus a lazy connection to its code. */
export interface PluginEntry {
  card: ModelCard;
  connect: () => Promise<SheetModelClient>;
}

export interface PlaneResult {
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
  /** At most this many attempts in all (default 3). */
  maxAttempts?: number;
  onProgress?: (progress: { attempt: number; characters: number }) => void;
  onAttempt?: (attempt: { attempt: number; rowsUsed: number; fits: boolean }) => void;
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
}

export const MAX_ATTEMPTS = 3;

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
  readonly connect: () => Promise<SheetModelClient>;
}

function checkCard(card: ModelCard): void {
  if (!card.id) throw new ModelError(ErrorCode.INVALID_CARD, "A model card needs an id.");
  if (card.sendsTextOffDevice && !card.destinationHost) {
    throw new ModelError(
      ErrorCode.INVALID_CARD,
      `Model "${card.id}" sends text off the device but names no destination.`,
    );
  }
}

export class ModelHost {
  readonly #plugins = new Map<PluginId, Registered>();
  readonly #clients = new Map<PluginId, Promise<SheetModelClient>>();

  /** Register a bundled plugin; returns its id, the only way to call it. */
  register(entry: PluginEntry): PluginId {
    checkCard(entry.card);
    if (this.#plugins.has(pluginIdOf(entry.card)))
      throw new ModelError(ErrorCode.INVALID_CARD, `Model "${entry.card.id}" is already registered.`);
    // A private, frozen copy: later changes to the caller's card object change nothing here.
    const card = deepFreeze(clone(ModelCardSchema, entry.card));
    const policy: Policy = { egress: card.sendsTextOffDevice ? { host: card.destinationHost } : "none" };
    const id = pluginIdOf(card);
    this.#plugins.set(id, { card, policy, connect: entry.connect });
    return id;
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
        const client = await entry.connect();
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

  #require(id: PluginId, operation: Operation): ModelCard {
    const card = this.card(id);
    if (!card.operations.includes(operation)) {
      throw new ModelError(
        ErrorCode.UNSUPPORTED_OPERATION,
        `${card.name || id} doesn't support ${Operation[operation].toLowerCase()}.`,
      );
    }
    return card;
  }

  /** The sheet in the views the card declares; spec always included. */
  #sheet(card: ModelCard, text: string, spec: PageSpec): Sheet {
    return create(SheetSchema, {
      spec: pageSpecMessage(spec),
      text: card.views.includes(View.TEXT) ? text : "",
      grid: card.views.includes(View.GRID) ? encodeGrid(text, spec) : undefined,
    });
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

  async score(id: PluginId, text: string, spec: PageSpec, signal?: AbortSignal): Promise<ScoreResult> {
    const card = this.#require(id, Operation.SCORE);
    if (this.#policy(id).egress !== "none")
      throw new ModelError(ErrorCode.CONSENT_REQUIRED, "Scoring with a remote model isn't supported.");
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
    const card = this.#require(id, Operation.TRANSFORM);
    if (this.#policy(id).egress !== "none") consumeConsent(options.consent, id, text);
    const client = await this.#client(id);
    const sheet = this.#sheet(card, text, spec);
    const max = Math.max(1, options.maxAttempts ?? MAX_ATTEMPTS);
    let resume: Uint8Array = new Uint8Array();
    let last: { rowsUsed: number } | null = null;
    let best: { text: string; rowsUsed: number; model: string } | null = null;
    for (let attempt = 1; attempt <= max; attempt++) {
      if (options.signal?.aborted) throw new ModelError(ErrorCode.CANCELED, "Canceled.");
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
            options.onProgress?.({ attempt, characters: event.event.value.characters });
          } else if (event.event.case === "candidate") {
            candidate = event.event.value;
          }
        }
      } catch (error) {
        throw toModelError(error);
      }
      if (!candidate) throw new ModelError(ErrorCode.INVALID_RESULT, `${card.name || id} finished without a result.`);
      const result = normalizeText(candidate.text);
      const rowsUsed = layoutRows(result, spec.cols).length;
      const fits = rowsUsed <= spec.rows;
      options.onAttempt?.({ attempt, rowsUsed, fits });
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
        };
      }
      resume = candidate.resume;
      last = { rowsUsed };
    }
    const kept = best!;
    return {
      text: kept.text,
      model: kept.model,
      rowsUsed: kept.rowsUsed,
      rowsAllowed: spec.rows,
      fits: false,
      overBy: kept.rowsUsed - spec.rows,
      attempts: max,
    };
  }
}
