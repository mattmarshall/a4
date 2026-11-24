/**
 * The density analysis: layout, metrics, signals, verdict, findings, the
 * lenses, and compressibility. Depends only on lib/page. Tools import the
 * report proto from ./report.ts directly, which keeps it out of the UI's
 * first load.
 */

export { analyze, pageLayout, type Analysis } from "./analyze.ts";
export type { Assessment, Finding, Severity, VerdictId } from "./assess.ts";
export { classifyLines, type LineKind } from "./classify.ts";
export { compressibility } from "./compress.ts";
export { DEFAULT_CONFIG, type AnalysisConfig } from "./config.ts";
export { KIND_LABEL, LENSES, segmentsFor, type Segment, type SegmentStyle } from "./lenses.ts";
export type { Layout, Metrics } from "./metrics.ts";
export type { Signals, Tone } from "./signals.ts";
export { isSyntaxAt } from "./syntax.ts";
export type { TermCount } from "./terms.ts";
