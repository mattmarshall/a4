import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze } from "../lib/analysis/index.ts";
import { PRESET_IDS, PRESETS } from "../lib/page/index.ts";
import { ANALYSIS_TEXTS } from "../lib/analysis/testing/texts.ts";
import { describeFinding, formatByteLimit, VERDICT_LABEL, VERDICT_SUMMARY } from "./analysis-copy.ts";

/**
 * The copy every sample page and analysis test text produced when findings
 * were still English inside the analysis. Findings are data now; the copy
 * written from them must stay word for word the same.
 */
const SNAPSHOT: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./analysis-copy.snapshot.json", import.meta.url), "utf8"),
);

test("the analysis copy is unchanged for every sample page and test text on every preset", () => {
  const actual: Record<string, unknown> = {};
  for (const [name, text] of Object.entries(ANALYSIS_TEXTS)) {
    for (const preset of PRESET_IDS) {
      const a = analyze(text, PRESETS[preset]);
      actual[`${name}@${preset}`] = {
        verdict: VERDICT_LABEL[a.assessment.verdict],
        summary: VERDICT_SUMMARY[a.assessment.verdict],
        findings: a.assessment.findings.map((f) => ({ severity: f.severity, ...describeFinding(f) })),
      };
    }
  }
  assert.deepEqual(actual, SNAPSHOT);
});

test("size limits read in binary units", () => {
  assert.equal(formatByteLimit(1_048_576), "1 MiB");
  assert.equal(formatByteLimit(104_857_600), "100 MiB");
  assert.equal(formatByteLimit(512 * 1024), "512 KB");
});
