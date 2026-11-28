import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_WEBGPU } from "./view-copy.ts";

test("3D without WebGPU says the sheets are shown flat", () => {
  assert.equal(NO_WEBGPU, "3D needs WebGPU, which this browser doesn’t provide, so sheets are shown flat.");
});
