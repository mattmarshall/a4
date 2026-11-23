/**
 * Every bundled plugin's card, importable without loading any plugin code.
 * Keep this list in step with `registry.ts`.
 */

import type { ModelCard } from "../gen/a4/v1/model_pb.js";
import { FIT_TO_PAGE_CARD } from "./fit/card.ts";
import { semanticModelCached } from "./semantic/cache.ts";
import { SEMANTIC_REPETITION_CARD, SEMANTIC_REPETITION_ID } from "./semantic/card.ts";

export const BUNDLED_CARDS: readonly ModelCard[] = [SEMANTIC_REPETITION_CARD, FIT_TO_PAGE_CARD];

/**
 * Cheap checks for whether an on-device plugin's model is already downloaded,
 * without starting its worker. The page starts a plugin only when this says
 * yes (so someone who never downloads a model never loads its code).
 */
export const MODEL_DOWNLOADED: Readonly<Record<string, () => Promise<boolean>>> = {
  [SEMANTIC_REPETITION_ID]: semanticModelCached,
};

/** "38.0 MB" (decimal megabytes, as download sizes are usually given). */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
