/**
 * Whether the Semantic repetition model is already downloaded, answered from
 * Cache Storage without starting the worker or loading the inference library.
 * Shared by the worker and the page.
 */

import { EMBEDDING_MODEL, EMBEDDING_REVISION } from "./descriptor.ts";

/** The Cache Storage name the inference library uses. */
export const MODEL_CACHE_NAME = "transformers-cache";
export const MODEL_FILE_URL = `https://huggingface.co/${EMBEDDING_MODEL}/resolve/${EMBEDDING_REVISION}/onnx/model_quantized.onnx`;

export async function semanticModelCached(): Promise<boolean> {
  try {
    if (typeof caches === "undefined" || !(await caches.has(MODEL_CACHE_NAME))) return false;
    const cache = await caches.open(MODEL_CACHE_NAME);
    return (await cache.match(MODEL_FILE_URL)) !== undefined;
  } catch {
    return false;
  }
}
