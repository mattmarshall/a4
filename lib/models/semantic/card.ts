/** The Semantic repetition plugin's card: static, so listing it loads no model code. */

import { create } from "@bufbuild/protobuf";
import { ModelCardSchema, Operation, Placement, View } from "../../gen/a4/v1/model_pb.js";

export const SEMANTIC_REPETITION_ID = "semantic-repetition";

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

export const SEMANTIC_REPETITION_CARD = create(ModelCardSchema, {
  id: SEMANTIC_REPETITION_ID,
  name: "Semantic repetition",
  version: "1",
  description: "Finds sentences and fields that say the same thing in different words.",
  operations: [Operation.SCORE],
  views: [View.TEXT],
  placement: Placement.BROWSER,
  sendsTextOffDevice: false,
  downloadBytes: BigInt(DOWNLOAD_BYTES.model + DOWNLOAD_BYTES.runtime),
  model: "all-MiniLM-L6-v2 (8-bit)",
});
