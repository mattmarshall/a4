import { test } from "node:test";
import assert from "node:assert/strict";
import { equals } from "@bufbuild/protobuf";
import { AnalysisReportSchema, Severity, Tone, Verdict } from "../gen/a4/v1/analysis_pb.js";
import { PRESET_IDS, PRESETS } from "../page/index.ts";
import { analyze } from "./analyze.ts";
import { decodeReport, encodeReport, toReport } from "./report.ts";
import { ANALYSIS_TEXTS } from "./testing/texts.ts";

test("every sample report survives a binary round trip unchanged", () => {
  for (const [name, text] of Object.entries(ANALYSIS_TEXTS)) {
    for (const preset of PRESET_IDS) {
      const report = toReport(analyze(text, PRESETS[preset]), PRESETS[preset]);
      const back = decodeReport(encodeReport(report));
      assert.ok(equals(AnalysisReportSchema, report, back), `${name}@${preset}`);
    }
  }
});

test("the report carries the analysis: numbers, signals, verdict, and findings in order", () => {
  for (const [name, text] of Object.entries(ANALYSIS_TEXTS)) {
    const spec = PRESETS.terminal;
    const a = analyze(text, spec);
    const r = toReport(a, spec);
    assert.equal(r.preset, "terminal");
    assert.equal(r.metrics?.rowsUsed, a.metrics.rowsUsed, name);
    assert.equal(r.metrics?.syntax, a.metrics.syntax, name);
    assert.equal(r.metrics?.tokens, a.metrics.tokens, name);
    assert.deepEqual(
      r.metrics?.repeatedTerms.map((t) => [t.term, t.count]),
      a.metrics.repeatedTerms.map((t) => [t.term, t.count]),
    );
    assert.equal(Verdict[r.verdict].toLowerCase(), a.assessment.verdict, name);
    assert.deepEqual(
      r.findings.map((f) => f.finding.case),
      a.assessment.findings.map((f) => f.id),
      name,
    );
    assert.deepEqual(
      r.findings.map((f) => Severity[f.severity].toLowerCase()),
      a.assessment.findings.map((f) => f.severity),
      name,
    );
  }
});

test("no value stays absent rather than 0, and not applicable has its own tone", () => {
  const empty = toReport(analyze("", PRESETS.terminal), PRESETS.terminal);
  assert.equal(empty.metrics?.narrative, undefined);
  assert.equal(empty.metrics?.charsPerToken, undefined);
  assert.equal(empty.signals?.narrative, Tone.NOT_APPLICABLE);
  assert.equal(empty.verdict, Verdict.EMPTY);

  const back = decodeReport(encodeReport(empty));
  assert.equal(back.metrics?.narrative, undefined);
});

test("the report never carries the page's text", () => {
  const secret = "The launch code is swordfish-7421, keep it between us and nobody else please.";
  const bytes = encodeReport(toReport(analyze(secret, PRESETS.terminal), PRESETS.terminal));
  assert.ok(!new TextDecoder().decode(bytes).includes("launch code is"));
});
