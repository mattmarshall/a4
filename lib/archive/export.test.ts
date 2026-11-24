import { test } from "node:test";
import assert from "node:assert/strict";
import { slugFromText } from "./export.ts";

test("download slugs come from the first non-blank line", () => {
  assert.equal(slugFromText("\n  INCIDENT INC-2291: Checkout latency\nbody"), "incident-inc-2291-checkout-latency");
  assert.equal(slugFromText("   \n\n"), "a4-page");
  assert.equal(slugFromText("§§§"), "a4-page");
  assert.ok(slugFromText("a".repeat(100)).length <= 48);
  assert.equal(slugFromText("Café résumé"), "cafe-resume");
  // Downloads are named from the page name: "<slug>.md".
  assert.equal(`${slugFromText("INCIDENT INC-2291 · Checkout latency")}.md`, "incident-inc-2291-checkout-latency.md");
});
