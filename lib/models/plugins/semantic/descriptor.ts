/**
 * The Semantic repetition plugin's descriptor: its card and the names of its
 * plane, scores, and findings. Static, so listing it loads no model code; the
 * worker and the UI share these names.
 */

import { create } from "@bufbuild/protobuf";
import { ModelCardSchema, Operation, View } from "../../../gen/a4/v1/model_pb.js";
import type { PluginDescriptor } from "../../descriptor.ts";
import { pluginIdOf } from "../../plugin-id.ts";

/** The embedding model, pinned to one Hugging Face commit. */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";

/**
 * Bytes downloaded on first use: the 8-bit model and tokenizer files from
 * Hugging Face, plus the ONNX runtime served from this app.
 */
export const DOWNLOAD_BYTES = {
  model: 22_972_370 + 711_661 + 366 + 650,
  runtime: 14_264_838 + 24_381,
};

/** Similarity at which a unit counts as restating another. */
export const RESTATE_SIMILARITY = 0.85;
/**
 * Where the scale starts: below this a unit's cells hold 0 and its pairs
 * aren't listed. Unrelated sentences score far lower (under 0.2 in
 * calibration), so they stay clear.
 */
export const SIMILARITY_FLOOR = 0.6;

/** The plane it paints, the scores it reports, and its kind of finding. */
const NAMES = {
  plane: "semantic-repetition",
  scores: { units: "units", restating: "restating" },
  findings: { similar: "similar" },
} as const;

const SEMANTIC_REPETITION_CARD = create(ModelCardSchema, {
  id: "semantic-repetition",
  name: "Semantic repetition",
  version: "1",
  description: "Finds sentences and fields that say the same thing in different words.",
  operations: [Operation.SCORE],
  views: [View.TEXT],
  placement: { case: "browser", value: {} },
  downloadBytes: BigInt(DOWNLOAD_BYTES.model + DOWNLOAD_BYTES.runtime),
  model: "all-MiniLM-L6-v2 (8-bit)",
  score: {
    planes: [
      {
        name: NAMES.plane,
        label: "Semantic repetition",
        quantity: "similarity",
        min: SIMILARITY_FLOOR,
        max: 1,
        description: "Darker means closer in meaning.",
        legend: [{ value: RESTATE_SIMILARITY, label: "counts as restating" }],
      },
    ],
    scores: [
      { name: NAMES.scores.units, label: "sentences and fields" },
      { name: NAMES.scores.restating, label: "restate another" },
    ],
    findings: [{ kind: NAMES.findings.similar, label: "Closest pairs, most similar first" }],
  },
});

const SEMANTIC_REPETITION_ID = pluginIdOf(SEMANTIC_REPETITION_CARD);

export const SEMANTIC_REPETITION = {
  id: SEMANTIC_REPETITION_ID,
  card: SEMANTIC_REPETITION_CARD,
  downloads: true,
  names: NAMES,
} as const satisfies PluginDescriptor;
