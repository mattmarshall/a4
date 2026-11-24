/**
 * Signals: how each judged metric reads, computed once. The verdict, the
 * findings, and the inspector's bars all read them (density-analysis, "One
 * set of signals").
 */

import type { AnalysisConfig } from "./config.ts";
import type { Metrics } from "./metrics.ts";

/**
 * How a metric reads: fine ("ok"), worth a note ("warn"), a problem ("bad"),
 * or not applicable ("na": no value, or too little text to judge).
 */
export type Tone = "ok" | "warn" | "bad" | "na";

export interface Signals {
  readonly syntax: Tone;
  readonly repetition: Tone;
  readonly duplicates: Tone;
  readonly narrative: Tone;
  readonly crowding: Tone;
  readonly indentation: Tone;
}

function syntaxTone(share: number, config: AnalysisConfig): Tone {
  if (share >= config.verdict.noisySyntax) return "bad";
  return share >= config.findings.noteSyntax ? "warn" : "ok";
}

function narrativeTone(m: Metrics, config: AnalysisConfig): Tone {
  const base = m.proseLines + m.structuredLines;
  if (m.narrative === null || base < config.findings.lowNarrativeMinLines) return "na";
  return m.narrative < config.findings.lowNarrative ? "bad" : "ok";
}

export function signals(m: Metrics, config: AnalysisConfig): Signals {
  const v = config.verdict;
  return {
    syntax: syntaxTone(m.syntax, config),
    repetition: m.repetition >= v.noisyRepetition && m.repeatedTerms.length > 0 ? "bad" : "ok",
    duplicates: m.duplicateLines >= v.noisyDuplicateLines ? "bad" : "ok",
    narrative: narrativeTone(m, config),
    crowding: m.crowding >= v.busyCrowding ? "bad" : "ok",
    indentation: m.indentation >= v.busyIndentation ? "bad" : "ok",
  };
}
