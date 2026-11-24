/** The Fit to page plugin's card: static, so listing it loads no SDK code. */

import { create } from "@bufbuild/protobuf";
import { ModelCardSchema, Operation, Placement, View } from "../../gen/a4/v1/model_pb.js";
import { pluginIdOf } from "../plugin-id.ts";

export const FIT_MODEL = "claude-opus-5-5";
export const FIT_HOST = "api.anthropic.com";

export const FIT_TO_PAGE_CARD = create(ModelCardSchema, {
  id: "fit-to-page",
  name: "Fit to page",
  version: "1",
  description:
    "Claude rewrites the page so it fits on one sheet and reads as narrative. The result opens beside the original.",
  operations: [Operation.TRANSFORM],
  views: [View.TEXT],
  placement: Placement.REMOTE,
  sendsTextOffDevice: true,
  destinationHost: FIT_HOST,
  model: FIT_MODEL,
});

export const FIT_TO_PAGE_ID = pluginIdOf(FIT_TO_PAGE_CARD);
