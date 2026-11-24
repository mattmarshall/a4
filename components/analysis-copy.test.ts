import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../lib/analyze.ts";
import { PRESET_ORDER, PRESETS } from "../lib/page-spec.ts";
import { ANALYSIS_TEXTS } from "../lib/testing/analysis-texts.ts";
import { describeFinding, VERDICT_LABEL, VERDICT_SUMMARY } from "./analysis-copy.ts";

/**
 * The copy every sample page and analysis test text produced when findings
 * were still English inside lib/analyze.ts. Findings are data now; the copy
 * written from them must stay word for word the same.
 */
const SNAPSHOT: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./analysis-copy.snapshot.json", import.meta.url), "utf8"),
);

test("the analysis copy is unchanged for every sample page and test text on every preset", () => {
  const actual: Record<string, unknown> = {};
  for (const [name, text] of Object.entries(ANALYSIS_TEXTS)) {
    for (const preset of PRESET_ORDER) {
      const a = analyze(text, PRESETS[preset]);
      actual[`${name}@${preset}`] = {
        verdict: VERDICT_LABEL[a.verdict],
        summary: VERDICT_SUMMARY[a.verdict],
        findings: a.findings.map((f) => ({ severity: f.severity, ...describeFinding(f) })),
      };
    }
  }
  assert.deepEqual(actual, SNAPSHOT);
});
