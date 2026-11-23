/**
 * The model host. It owns everything a plugin must not decide: which
 * operations may run (from the card), what a valid result is (plane shapes),
 * whether a page fits (laid out here, never trusted from the model), how many
 * repairs to ask for, and consent for plugins that send text off the device.
 */

import { create } from "@bufbuild/protobuf";
import {
  DescribeRequestSchema,
  Operation,
  PrepareRequestSchema,
  ScoreRequestSchema,
  StatusRequestSchema,
  TransformRequestSchema,
  View,
  type ModelCard,
} from "../gen/a4/v1/model_pb.js";
import { SheetSchema, type Sheet, type TextSpan } from "../gen/a4/v1/sheet_pb.js";
import type { PageSpec } from "../page-spec.ts";
import { layoutRows, normalizeText } from "../text.ts";
import { encodeGrid } from "../tensor/codec.ts";
import { pageSpecMessage } from "../tensor/record.ts";
import type { SheetModelClient } from "./client.ts";
import { consumeConsent, type ConsentToken } from "./consent.ts";
import { ModelError, toModelError } from "./errors.ts";

/** A bundled plugin: a static card plus a lazy connection to its code. */
export interface PluginEntry {
  card: ModelCard;
  connect: () => Promise<SheetModelClient>;
}

export interface PlaneResult {
  pluginId: string;
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

function checkCard(card: ModelCard): void {
  if (!card.id) throw new ModelError("invalid-result", "A model card needs an id.");
  if (card.sendsTextOffDevice && !card.destinationHost) {
    throw new ModelError("invalid-result", `Model "${card.id}" sends text off the device but names no destination.`);
  }
}

export class ModelHost {
  readonly #plugins = new Map<string, PluginEntry>();
  readonly #clients = new Map<string, Promise<SheetModelClient>>();

  register(entry: PluginEntry): void {
    checkCard(entry.card);
    if (this.#plugins.has(entry.card.id)) throw new ModelError("invalid-result", `Model "${entry.card.id}" is already registered.`);
    this.#plugins.set(entry.card.id, entry);
  }

  list(): ModelCard[] {
    return [...this.#plugins.values()].map((p) => p.card);
  }

  card(id: string): ModelCard {
    const entry = this.#plugins.get(id);
    if (!entry) throw new ModelError("unsupported-operation", `No model "${id}".`);
    return entry.card;
  }

  /** Connect once, and check the plugin describes itself as its card says. */
  async #client(id: string): Promise<SheetModelClient> {
    const entry = this.#plugins.get(id);
    if (!entry) throw new ModelError("unsupported-operation", `No model "${id}".`);
    let pending = this.#clients.get(id);
    if (!pending) {
      pending = (async () => {
        const client = await entry.connect();
        const described = await client.describe(create(DescribeRequestSchema));
        if (described.card?.id !== id) throw new ModelError("invalid-result", `Model "${id}" describes itself as "${described.card?.id ?? ""}".`);
        return client;
      })();
      pending.catch(() => this.#clients.delete(id));
      this.#clients.set(id, pending);
    }
    return pending;
  }

  #require(id: string, operation: Operation): ModelCard {
    const card = this.card(id);
    if (!card.operations.includes(operation)) {
      throw new ModelError("unsupported-operation", `${card.name || id} doesn't support ${Operation[operation].toLowerCase()}.`);
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

  async status(id: string): Promise<boolean> {
    const client = await this.#client(id);
    return (await client.status(create(StatusRequestSchema))).ready;
  }

  /** Download and load model files. Call only after the author asks. */
  async prepare(id: string, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    const client = await this.#client(id);
    try {
      for await (const event of client.prepare(create(PrepareRequestSchema), signal)) {
        onProgress?.(Number(event.loadedBytes), Number(event.totalBytes));
      }
    } catch (error) {
      throw toModelError(error);
    }
  }

  async score(id: string, text: string, spec: PageSpec, signal?: AbortSignal): Promise<ScoreResult> {
    const card = this.#require(id, Operation.SCORE);
    if (card.sendsTextOffDevice) throw new ModelError("consent-required", "Scoring with a remote model isn't supported.");
    const client = await this.#client(id);
    let response;
    try {
      response = await client.score(create(ScoreRequestSchema, { sheet: this.#sheet(card, text, spec) }), signal);
    } catch (error) {
      throw toModelError(error);
    }
    const grid = encodeGrid(text, spec);
    const planes = response.planes.map((plane): PlaneResult => {
      const [rows, cols, depth = 1] = plane.shape;
      if (rows !== grid.rows || cols !== grid.cols || plane.shape.length > 3 || plane.values.length !== rows * cols * depth) {
        throw new ModelError(
          "invalid-result",
          `${card.name || id} returned a ${plane.shape.join(" × ")} plane for a ${grid.rows} × ${grid.cols} grid.`,
        );
      }
      if (plane.text !== text) throw new ModelError("invalid-result", `${card.name || id} scored different text than it was sent.`);
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
    const span = (s: TextSpan) => ({ start: s.start, end: s.end });
    return {
      planes,
      scores: response.scores.map((s) => ({ name: s.name, value: s.value })),
      findings: response.findings.map((f) => ({ kind: f.kind, spans: f.spans.map(span), value: f.value, label: f.label })),
    };
  }

  /**
   * Run a Transform until a candidate fits the page, asking for repairs with
   * the overflow, for at most `maxAttempts` attempts. Keeps the candidate with
   * the fewest rows when none fits.
   */
  async transform(id: string, text: string, spec: PageSpec, options: TransformOptions): Promise<TransformResult> {
    const card = this.#require(id, Operation.TRANSFORM);
    if (card.sendsTextOffDevice) consumeConsent(options.consent, id, text);
    const client = await this.#client(id);
    const sheet = this.#sheet(card, text, spec);
    const max = Math.max(1, options.maxAttempts ?? MAX_ATTEMPTS);
    let resume: Uint8Array = new Uint8Array();
    let last: { rowsUsed: number } | null = null;
    let best: { text: string; rowsUsed: number; model: string } | null = null;
    for (let attempt = 1; attempt <= max; attempt++) {
      if (options.signal?.aborted) throw new ModelError("cancelled", "Canceled.");
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
      if (!candidate) throw new ModelError("invalid-result", `${card.name || id} finished without a result.`);
      const result = normalizeText(candidate.text);
      const rowsUsed = layoutRows(result, spec.cols).length;
      const fits = rowsUsed <= spec.rows;
      options.onAttempt?.({ attempt, rowsUsed, fits });
      if (!best || rowsUsed < best.rowsUsed) best = { text: result, rowsUsed, model: candidate.model };
      if (fits) {
        return { text: result, model: candidate.model, rowsUsed, rowsAllowed: spec.rows, fits: true, overBy: 0, attempts: attempt };
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
