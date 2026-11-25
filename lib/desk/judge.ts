/**
 * The desk's judgment of one page: whether it fits, its analysis, and its
 * report, on the canonical Terminal page, as the sheet shows it.
 */

import { analyze, type Analysis, type VerdictId } from "../analysis/index.ts";
import { toReport, type AnalysisReport } from "../analysis/report.ts";
import { pageFit, PRESETS, type PageFit, type PageSpec } from "../page/index.ts";
import { toSheet } from "../persist/folder/faithful.ts";

/** The page the desk judges on: the 80 × 60 Terminal preset. */
export const DESK_PAGE: PageSpec = PRESETS.terminal;

export interface Judgment {
  readonly fit: PageFit;
  readonly analysis: Analysis;
  /** The analysis as `a4.v1.AnalysisReport`, without the page's text. */
  readonly report: AnalysisReport;
}

/** Judge sheet text: text as the sheet holds it (two-space tabs, LF line endings). */
export function judge(sheetText: string): Judgment {
  const analysis = analyze(sheetText, DESK_PAGE);
  return { fit: pageFit(sheetText, DESK_PAGE), analysis, report: toReport(analysis, DESK_PAGE) };
}

/** Judge a file's raw text as the folder view shows it on the sheet. */
export function judgeFile(raw: string): Judgment {
  return judge(toSheet(raw));
}

export type Outcome = "pass" | "warn" | "fail";

/** Verdicts that fail in strict mode and warn otherwise. */
const STRICT_VERDICTS: ReadonlySet<VerdictId> = new Set<VerdictId>(["noisy", "busy"]);

/**
 * A page fails when it doesn't fit. Noisy and Busy pages warn, or fail with
 * `strict`. Everything else passes.
 */
export function outcomeOf(judgment: Judgment, options: { strict?: boolean } = {}): Outcome {
  if (!judgment.fit.fits) return "fail";
  if (STRICT_VERDICTS.has(judgment.analysis.assessment.verdict)) return options.strict ? "fail" : "warn";
  return "pass";
}
