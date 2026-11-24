/**
 * The Fit to page plugin's descriptor: its card and its instruction names.
 * Static, so listing it loads no SDK code.
 */

import { create } from "@bufbuild/protobuf";
import { ModelCardSchema, Operation, View } from "../../../gen/a4/v1/model_pb.js";
import type { PluginDescriptor } from "../../descriptor.ts";
import { pluginIdOf } from "../../plugin-id.ts";

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
  placement: { case: "remote", value: { destinationHost: FIT_HOST } },
  model: FIT_MODEL,
  transform: { instructions: ["fit"], maxAttempts: 3 },
  credentials: [{ kind: "anthropic-api-key", label: "Anthropic API key" }],
});

export const FIT_TO_PAGE_ID = pluginIdOf(FIT_TO_PAGE_CARD);

export const FIT_TO_PAGE = {
  id: FIT_TO_PAGE_ID,
  card: FIT_TO_PAGE_CARD,
  downloads: false,
  names: { instructions: { fit: "fit" }, credentials: { apiKey: "anthropic-api-key" } },
} as const satisfies PluginDescriptor;
