/**
 * The inference library, pinned: every Hub URL it builds uses the model's
 * commit (some of its metadata lookups otherwise ask for "main"), so after
 * the first download every file is a Cache Storage hit. The ONNX runtime is
 * served from this app (never a CDN) and runs on WebAssembly on the CPU.
 * Worker-only: it reads the worker's location.
 */

import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { EMBEDDING_REVISION } from "./descriptor.ts";
import type { InferenceLibrary } from "./plugin.ts";

export async function loadPinnedLibrary(): Promise<InferenceLibrary> {
  const lib = await import("@huggingface/transformers");
  const { env } = lib;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.remotePathTemplate = `{model}/resolve/${EMBEDDING_REVISION}/`;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = {
      mjs: new URL(ortMjsUrl, self.location.href).href,
      wasm: new URL(ortWasmUrl, self.location.href).href,
    };
    wasm.numThreads = 1;
  }
  return { pipeline: (task, model, options) => lib.pipeline(task, model, options) };
}
