import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../analysis/index.ts";
import { PRESETS } from "../page/index.ts";
import { INCIDENT_JSON, INCIDENT_NARRATIVE, TEMPLATES, WELCOME } from "./index.ts";

const T = PRESETS.terminal;

test("welcome page fits the Terminal page without wrapping", () => {
  const a = analyze(WELCOME, T);
  assert.equal(a.metrics.overflow, 0);
  assert.equal(a.metrics.wrappedLines, 0);
  assert.notEqual(a.assessment.verdict, "overflowing");
});

test("every template fits, states its purpose up front, and is not noisy", () => {
  assert.equal(TEMPLATES.length, 5);
  for (const t of TEMPLATES) {
    const a = analyze(t.text, T);
    assert.equal(a.metrics.overflow, 0, `${t.id} overflow`);
    assert.equal(a.metrics.wrappedLines, 0, `${t.id} wraps`);
    assert.ok(!["noisy", "busy", "overflowing"].includes(a.assessment.verdict), `${t.id}: ${a.assessment.verdict}`);
    const head = t.text.split("\n").slice(0, 4).join("\n");
    assert.match(head, /Purpose:/, `${t.id} purpose line`);
  }
});

test("incident JSON is noisy or overflowing; the narrative is neither", () => {
  const json = analyze(INCIDENT_JSON, T);
  const narrative = analyze(INCIDENT_NARRATIVE, T);
  assert.ok(["noisy", "overflowing"].includes(json.assessment.verdict), json.assessment.verdict);
  assert.ok(!["noisy", "overflowing"].includes(narrative.assessment.verdict), narrative.assessment.verdict);
  assert.ok(narrative.metrics.syntax < json.metrics.syntax);
  assert.ok(narrative.metrics.tokens < json.metrics.tokens);
  assert.doesNotThrow(() => JSON.parse(INCIDENT_JSON));
});

test("the narrative carries the JSON's key facts", () => {
  for (const fact of [
    "INC-2291",
    "CHG-8812",
    "13:55",
    "14:02",
    "15:47",
    "98%",
    "1,840",
    "41",
    "AI-1",
    "AI-4",
    "eu-west-1",
  ]) {
    assert.ok(INCIDENT_NARRATIVE.includes(fact), fact);
  }
});
