/**
 * Golden record of `analyze()`: every metric, signal, verdict, and finding
 * for each sample page and analysis test text, on every preset. Recorded
 * before refactor-lib-layout split the analysis, so the split can prove it
 * changed no number.
 *
 * refactor-lib-layout made the heading width follow the page (`spec.cols`)
 * instead of 80 columns. No recorded text has an all-caps line whose length
 * falls between a preset's width and 80, so the record is unchanged; the
 * last test pins the new rule.
 *
 * fix-review-leftovers reworded two Welcome lines ("inspector" for
 * "sidebar", "Page → New" for "Use New"). That moved only the welcome@*
 * character, ink, term, and repetition numbers; every verdict, and every
 * other text, is unchanged.
 *
 * Regenerate (only for an intended change, listed in the test):
 *   A4_WRITE_GOLDEN=1 node --test lib/analysis/golden.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { analyze, type Analysis } from "./index.ts";
import { classifyLines } from "./classify.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { PRESET_IDS, PRESETS } from "../page/index.ts";
import { ANALYSIS_TEXTS } from "./testing/texts.ts";

const GOLDEN = new URL("./testing/golden.json", import.meta.url);

const KIND_LETTER = { prose: "p", structured: "s", heading: "h", blank: "b" } as const;

/** What a text yields on any preset: term statistics don't depend on the grid. */
function textRecord({ metrics: m }: Analysis) {
  return {
    chars: m.chars,
    ink: m.ink,
    syntaxChars: m.syntaxChars,
    syntax: m.syntax,
    repetition: m.repetition,
    repeatedTerms: m.repeatedTerms.map((t) => `${t.term}:${t.count}`),
    termCounts: m.termCounts.map((t) => `${t.term}:${t.count}`).sort(),
    duplicateLines: m.duplicateLines,
    indentChars: m.indentChars,
    maxIndent: m.maxIndent,
    tokens: m.tokens,
    charsPerToken: m.charsPerToken,
  };
}

/** What a text yields on one preset. */
function pageRecord({ layout, metrics: m, assessment }: Analysis) {
  return {
    cols: m.cols,
    pageRows: m.pageRows,
    capacity: m.capacity,
    tokenCeiling: m.tokenCeiling,
    rowsTotal: m.rowsTotal,
    rowsUsed: m.rowsUsed,
    fill: m.fill,
    overflow: m.overflow,
    coverage: m.coverage,
    crowding: m.crowding,
    indentation: m.indentation,
    wrappedLines: m.wrappedLines,
    lineKinds: layout.lineKinds.map((k) => KIND_LETTER[k]).join(""),
    proseLines: m.proseLines,
    structuredLines: m.structuredLines,
    headingLines: m.headingLines,
    narrative: m.narrative,
    signals: assessment.signals,
    verdict: assessment.verdict,
    findings: assessment.findings,
  };
}

function record() {
  const texts: Record<string, unknown> = {};
  const pages: Record<string, unknown> = {};
  for (const [name, text] of Object.entries(ANALYSIS_TEXTS)) {
    for (const preset of PRESET_IDS) {
      const a = analyze(text, PRESETS[preset]);
      texts[name] ??= textRecord(a);
      pages[`${name}@${preset}`] = pageRecord(a);
    }
  }
  return { texts, pages };
}

test("analyze() output matches the golden record for every text on every preset", () => {
  const actual = record();
  if (process.env.A4_WRITE_GOLDEN) writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 1)}\n`);
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
  assert.deepEqual(actual, golden);
});

test("an all-caps heading must fit the page's width, so headings differ by preset", () => {
  const kind = (line: string, preset: keyof typeof PRESETS) =>
    classifyLines([line], DEFAULT_CONFIG.classify, PRESETS[preset].cols)[0];
  const seventy = "H".repeat(70);
  const ninety = "H".repeat(90);
  // Terminal is unchanged: 80 columns, as before.
  assert.equal(kind(seventy, "terminal"), "heading");
  assert.equal(kind(ninety, "terminal"), "structured");
  // Pica (62 columns) no longer takes a 70-column heading; Dense (100) now takes a 90-column one.
  assert.equal(kind(seventy, "pica"), "structured");
  assert.equal(kind(seventy, "elite"), "heading");
  assert.equal(kind(ninety, "dense"), "heading");
});
