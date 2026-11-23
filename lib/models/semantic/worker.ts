/**
 * Worker entry for the Semantic repetition plugin. It serves the SheetModel
 * contract over the worker's own port, so the embedding model never blocks
 * the editor.
 *
 * - The model (pinned revision) downloads from Hugging Face only on Prepare,
 *   which the app sends only after the author asks; the library caches it in
 *   Cache Storage for later sessions.
 * - The ONNX runtime is served from this app (never a CDN), and runs on
 *   WebAssembly on the CPU.
 * - Page text never leaves the worker: scoring makes no network request.
 */

import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { implement } from "../client.ts";
import { ModelError } from "../errors.ts";
import { servePort, type PortLike } from "../worker-transport.ts";
import { semanticModelCached as modelCached } from "./cache.ts";
import { DOWNLOAD_BYTES, EMBEDDING_MODEL, EMBEDDING_REVISION, SEMANTIC_REPETITION_CARD } from "./card.ts";
import { scoreUnits } from "./similarity.ts";
import { extractUnits } from "./units.ts";

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

const TOTAL = DOWNLOAD_BYTES.model + DOWNLOAD_BYTES.runtime;

let extractor: Extractor | null = null;
let loading: Promise<Extractor> | null = null;
let library: Promise<typeof import("@huggingface/transformers")> | null = null;

/**
 * Import the inference library and pin it: every Hub URL it builds uses the
 * pinned commit (some of its metadata lookups otherwise ask for "main"), so
 * after the first download every file is a Cache Storage hit.
 */
function importLibrary() {
  library ??= import("@huggingface/transformers").then((lib) => {
    const { env } = lib;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.remotePathTemplate = `{model}/resolve/${EMBEDDING_REVISION}/`;
    const wasm = env.backends.onnx.wasm;
    if (wasm) {
      wasm.wasmPaths = { mjs: new URL(ortMjsUrl, self.location.href).href, wasm: new URL(ortWasmUrl, self.location.href).href };
      wasm.numThreads = 1;
    }
    return lib;
  });
  library.catch(() => {
    library = null;
  });
  return library;
}

/** Load the pipeline, reporting model bytes as they arrive. */
function load(onProgress?: (loaded: number) => void): Promise<Extractor> {
  loading ??= (async () => {
    const { pipeline } = await importLibrary();
    const perFile = new Map<string, number>();
    const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL, {
      revision: EMBEDDING_REVISION,
      dtype: "q8",
      device: "wasm",
      progress_callback: (info: { status: string; file?: string; loaded?: number }) => {
        if (info.status === "progress" && info.file && typeof info.loaded === "number") {
          perFile.set(info.file, info.loaded);
          let sum = 0;
          for (const n of perFile.values()) sum += n;
          onProgress?.(Math.min(sum, DOWNLOAD_BYTES.model));
        }
      },
    });
    extractor = pipe as unknown as Extractor;
    return extractor;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

servePort(
  self as unknown as PortLike,
  implement({
    describe: () => ({ card: SEMANTIC_REPETITION_CARD }),

    status: async () => {
      if (extractor) return { ready: true };
      const cached = await modelCached();
      // Downloaded in an earlier session: fetch the library code now, while
      // the page is online, so scoring works later even without a network.
      if (cached) void importLibrary().catch(() => {});
      return { ready: cached };
    },

    async *prepare() {
      const events: { loaded: number }[] = [];
      let wake: (() => void) | null = null;
      let done = false;
      let failure: unknown = null;
      load((loaded) => {
        events.push({ loaded });
        wake?.();
      }).then(
        () => {
          done = true;
          wake?.();
        },
        (error) => {
          failure = error;
          done = true;
          wake?.();
        },
      );
      for (;;) {
        const event = events.shift();
        if (event) {
          yield { loadedBytes: BigInt(event.loaded), totalBytes: BigInt(TOTAL) };
          continue;
        }
        if (done) break;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
      if (failure) throw new ModelError("network", `Couldn’t download the model: ${failure instanceof Error ? failure.message : String(failure)}`);
      yield { loadedBytes: BigInt(TOTAL), totalBytes: BigInt(TOTAL), ready: true };
    },

    score: async (request) => {
      const sheet = request.sheet;
      if (!sheet?.spec) throw new ModelError("invalid-result", "Score needs a sheet with a page spec.");
      if (!extractor) {
        if (!(await modelCached())) throw new ModelError("not-ready", "Download the model first.");
        await load(); // from Cache Storage: no network for the model
      }
      const text = sheet.text;
      const units = extractUnits(text);
      let vectors: Float32Array[] = [];
      if (units.length) {
        const output = await extractor!(units.map((u) => u.text), { pooling: "mean", normalize: true });
        const dim = output.dims[output.dims.length - 1];
        vectors = units.map((_, i) => output.data.slice(i * dim, (i + 1) * dim));
      }
      const scored = scoreUnits(text, units, vectors, { cols: sheet.spec.cols, rows: sheet.spec.rows });
      const span = (i: number) => ({ start: units[i].start, end: units[i].end });
      return {
        planes: [
          {
            name: "semantic-repetition",
            label: "Semantic repetition",
            shape: [scored.rows, scored.cols],
            values: Array.from(scored.values),
            text,
          },
        ],
        scores: [
          { name: "units", value: units.length },
          { name: "restating", value: scored.restating },
        ],
        findings: scored.pairs.map((pair) => ({
          kind: "similar",
          spans: [span(pair.a), span(pair.b)],
          value: pair.similarity,
          label: units[pair.b].text,
        })),
      };
    },
  }),
);
