/**
 * The desk's judgment of one page: whether it fits, its analysis, and its
 * report, on the Terminal page of its paper (A4, A5, or A6), as the sheet
 * shows it.
 */

import { analyze, type Analysis, type VerdictId } from "../analysis/index.ts";
import { toReport, type AnalysisReport } from "../analysis/report.ts";
import { pageFit, pageSpec, type PageFit, type PageSpec, type PaperId, PRESETS } from "../page/index.ts";
import { toSheet } from "../persist/folder/faithful.ts";

/** The page the desk judges on: the 80 × 60 Terminal preset, on A4. */
export const DESK_PAGE: PageSpec = PRESETS.terminal;

/** The desk's page on `paper`: Terminal on A4 (80 × 60), A5 (56 × 42), or A6 (40 × 29). */
export function deskPage(paper: PaperId): PageSpec {
  return pageSpec("terminal", paper);
}

export interface Judgment {
  readonly fit: PageFit;
  readonly analysis: Analysis;
  /** The analysis as `a4.v1.AnalysisReport`, without the page's text. */
  readonly report: AnalysisReport;
}

/** Judge sheet text (two-space tabs, LF line endings) on the desk's page of `paper`. */
export function judge(sheetText: string, paper: PaperId = "a4"): Judgment {
  const page = deskPage(paper);
  const analysis = analyze(sheetText, page);
  return { fit: pageFit(sheetText, page), analysis, report: toReport(analysis, page) };
}

/** Judge a file's raw text as the folder view shows it on the sheet of `paper`. */
export function judgeFile(raw: string, paper: PaperId = "a4"): Judgment {
  return judge(toSheet(raw), paper);
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
