import { test } from "node:test";
import assert from "node:assert/strict";
import { sealedNotice } from "./desk-copy.ts";

test("after a seal, the notice gives the verdict and the letter's label", () => {
  assert.equal(sealedNotice("accepted", "2026-11-28-0930-auth"), "Sealed: accepted “2026-11-28-0930-auth”.");
  assert.equal(sealedNotice("returned", "2026-11-28-0930-auth"), "Sealed: returned “2026-11-28-0930-auth”.");
  assert.equal(sealedNotice("accepted", null), "Sealed: accepted “the letter”.");
  assert.equal(sealedNotice("returned", null), "Sealed: returned “the letter”.");
});
