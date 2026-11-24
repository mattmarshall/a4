import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, errorCodeFromName, isModelError, ModelError, toModelError } from "./errors.ts";

test("isModelError narrows, by code when given", () => {
  const error: unknown = new ModelError(ErrorCode.AUTH, "No key.");
  assert.ok(isModelError(error));
  assert.ok(isModelError(error, ErrorCode.AUTH));
  assert.equal(isModelError(error, ErrorCode.CANCELED), false);
  assert.equal(isModelError(new Error("x")), false);
});

test("old code names map to the enum, with both spellings of canceled", () => {
  assert.equal(errorCodeFromName("cancelled"), ErrorCode.CANCELED);
  assert.equal(errorCodeFromName("canceled"), ErrorCode.CANCELED);
  assert.equal(errorCodeFromName("consent-required"), ErrorCode.CONSENT_REQUIRED);
  assert.equal(errorCodeFromName("toString"), ErrorCode.PLUGIN);
  assert.equal(errorCodeFromName("anything else"), ErrorCode.PLUGIN);
});

test("toModelError keeps model errors, and maps aborts and named codes", () => {
  const kept = new ModelError(ErrorCode.NETWORK, "Offline.");
  assert.equal(toModelError(kept), kept);
  assert.equal(toModelError(new DOMException("stop", "AbortError")).code, ErrorCode.CANCELED);
  assert.equal(toModelError(Object.assign(new Error("old"), { code: "cancelled" })).code, ErrorCode.CANCELED);
  assert.equal(toModelError(new Error("boom")).code, ErrorCode.PLUGIN);
});
