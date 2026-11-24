/**
 * The Semantic repetition plugin: handlers whose state (the inference library,
 * the loaded extractor, and any load in progress) lives in a closure. The
 * worker serves it; tests serve it over a MessageChannel with a fake library.
 *
 * - The model (pinned revision) downloads only on Prepare, which the app sends
 *   only after the author asks; the library caches it in Cache Storage.
 * - Page text never leaves the worker: scoring makes no network request.
 */

import { AsyncQueue } from "../../async-queue.ts";
import { implement, type SheetModelClient } from "../../client.ts";
import { ErrorCode, ModelError } from "../../errors.ts";
import { readTextSheet } from "../../sheet-input.ts";
import { DOWNLOAD_BYTES, EMBEDDING_MODEL, EMBEDDING_REVISION, SEMANTIC_REPETITION } from "./descriptor.ts";
import { scoreUnits } from "./similarity.ts";
import { extractUnits } from "./units.ts";

/** Sentence embeddings: one row of `dims[last]` values per input text. */
export type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

/** The part of the inference library the plugin uses. */
export interface InferenceLibrary {
  pipeline(
    task: "feature-extraction",
    model: string,
    options: {
      revision: string;
      dtype: "q8";
      device: "wasm";
      progress_callback: (info: { status: string; file?: string; loaded?: number }) => void;
    },
  ): Promise<unknown>;
}

export interface SemanticDeps {
  /** Load the inference library, pinned to the model's revision (lib/models/plugins/semantic/library.ts). */
  importLibrary: () => Promise<InferenceLibrary>;
  /** Whether the model is already downloaded (Cache Storage). */
  isCached: () => Promise<boolean>;
}

const TOTAL = DOWNLOAD_BYTES.model + DOWNLOAD_BYTES.runtime;
const { card, names } = SEMANTIC_REPETITION;

export function createSemanticPlugin(deps: SemanticDeps): SheetModelClient {
  let library: Promise<InferenceLibrary> | null = null;
  let extractor: Extractor | null = null;
  let loading: Promise<Extractor> | null = null;

  function importLibrary(): Promise<InferenceLibrary> {
    library ??= deps.importLibrary();
    library.catch(() => {
      library = null;
    });
    return library;
  }

  /** Load the pipeline, reporting model bytes as they arrive. */
  function load(onProgress?: (loaded: number) => void): Promise<Extractor> {
    loading ??= (async () => {
      const lib = await importLibrary();
      const perFile = new Map<string, number>();
      const pipe = await lib.pipeline("feature-extraction", EMBEDDING_MODEL, {
        revision: EMBEDDING_REVISION,
        dtype: "q8",
        device: "wasm",
        progress_callback: (info) => {
          if (info.status === "progress" && info.file && typeof info.loaded === "number") {
            perFile.set(info.file, info.loaded);
            let sum = 0;
            for (const n of perFile.values()) sum += n;
            onProgress?.(Math.min(sum, DOWNLOAD_BYTES.model));
          }
        },
      });
      extractor = pipe as Extractor;
      return extractor;
    })();
    loading.catch(() => {
      loading = null;
    });
    return loading;
  }

  return implement({
    describe: () => ({ card }),

    status: async () => {
      if (extractor) return { ready: true };
      const cached = await deps.isCached();
      // Downloaded in an earlier session: fetch the library code now, while
      // the page is online, so scoring works later even without a network.
      if (cached) void importLibrary().catch(() => {});
      return { ready: cached };
    },

    async *prepare() {
      const progress = new AsyncQueue<number>();
      load((loaded) => progress.push(loaded)).then(
        () => progress.end(),
        (error: unknown) => progress.fail(error),
      );
      try {
        for await (const loaded of progress) yield { loadedBytes: BigInt(loaded), totalBytes: BigInt(TOTAL) };
      } catch (failure) {
        throw new ModelError(
          ErrorCode.NETWORK,
          `Couldn’t download the model: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
      }
      yield { loadedBytes: BigInt(TOTAL), totalBytes: BigInt(TOTAL), ready: true };
    },

    score: async (request) => {
      const { text, spec } = readTextSheet(request.sheet, "Semantic repetition");
      let embed = extractor;
      if (!embed) {
        if (!(await deps.isCached())) throw new ModelError(ErrorCode.NOT_READY, "Download the model first.");
        embed = await load(); // from Cache Storage: no network for the model
      }
      const units = extractUnits(text, spec.cols);
      let vectors: Float32Array[] = [];
      if (units.length) {
        const output = await embed(
          units.map((u) => u.text),
          { pooling: "mean", normalize: true },
        );
        const dim = output.dims[output.dims.length - 1] ?? 0;
        vectors = units.map((_, i) => output.data.slice(i * dim, (i + 1) * dim));
      }
      const scored = scoreUnits(text, units, vectors, { cols: spec.cols, rows: spec.rows });
      const span = (i: number) => ({ start: units[i]?.start ?? 0, end: units[i]?.end ?? 0 });
      return {
        planes: [
          {
            name: names.plane,
            label: card.score?.planes[0]?.label ?? "",
            shape: [scored.rows, scored.cols],
            values: Array.from(scored.values),
            text,
          },
        ],
        scores: [
          { name: names.scores.units, value: units.length },
          { name: names.scores.restating, value: scored.restating },
        ],
        findings: scored.pairs.map((pair) => ({
          kind: names.findings.similar,
          spans: [span(pair.a), span(pair.b)],
          value: pair.similarity,
          label: units[pair.b]?.text ?? "",
        })),
      };
    },
  });
}
