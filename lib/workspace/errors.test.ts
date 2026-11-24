import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, ModelError } from "../models/errors.ts";
import { PageNotFoundError } from "../store/types.ts";
import { describeError, runReported } from "./errors.ts";

function domError(name: string, message = "") {
  const error = new Error(message);
  error.name = name;
  return error;
}

test("store, model, and browser errors become plain sentences", () => {
  assert.equal(describeError(new PageNotFoundError("Brief")), "No page named “Brief”.");
  assert.equal(describeError(new ModelError(ErrorCode.NETWORK, "The network failed.")), "The network failed.");
  assert.equal(describeError(domError("QuotaExceededError")), "The browser is out of storage space for this site.");
  assert.equal(describeError(domError("NotAllowedError")), "The browser didn’t allow access.");
  assert.equal(describeError(new Error("Something specific")), "Something specific");
  assert.equal(describeError("plain"), "plain");
});

test("a reported action never rejects, and says what failed", async () => {
  const messages: [string, string | undefined][] = [];
  const notify = (m: string, tone?: "info" | "warn") => messages.push([m, tone]);
  assert.equal(await runReported(async () => 7, notify, "count"), 7);
  assert.equal(
    await runReported(async () => Promise.reject(new PageNotFoundError("Brief")), notify, "restore “Brief”"),
    undefined,
  );
  assert.deepEqual(messages, [["Couldn’t restore “Brief”: No page named “Brief”.", "warn"]]);
});
