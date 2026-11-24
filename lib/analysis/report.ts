/**
 * The analysis as an `a4.v1.AnalysisReport` (proto/a4/v1/analysis.proto):
 * metrics, signals, verdict, and findings, ready for a CI lint command or a
 * server. The report never carries the page's text.
 */

import { create, fromBinary, toBinary, type MessageInitShape } from "@bufbuild/protobuf";
import {
  type AnalysisFindingSchema,
  type AnalysisReport,
  AnalysisReportSchema,
  Severity as SeverityProto,
  Tone as ToneProto,
  Verdict as VerdictProto,
} from "../gen/a4/v1/analysis_pb.js";
import { assertNever, type PageSpec } from "../page/index.ts";
import type { Analysis } from "./analyze.ts";
import type { Finding, Severity, VerdictId } from "./assess.ts";
import type { Tone } from "./signals.ts";

export type { AnalysisReport } from "../gen/a4/v1/analysis_pb.js";

const VERDICT: Record<VerdictId, VerdictProto> = {
  empty: VerdictProto.EMPTY,
  overflowing: VerdictProto.OVERFLOWING,
  noisy: VerdictProto.NOISY,
  busy: VerdictProto.BUSY,
  light: VerdictProto.LIGHT,
  balanced: VerdictProto.BALANCED,
};

const SEVERITY: Record<Severity, SeverityProto> = {
  critical: SeverityProto.CRITICAL,
  warning: SeverityProto.WARNING,
  info: SeverityProto.INFO,
};

const TONE: Record<Tone, ToneProto> = {
  ok: ToneProto.OK,
  warn: ToneProto.WARN,
  bad: ToneProto.BAD,
  na: ToneProto.NOT_APPLICABLE,
};

type FindingInit = MessageInitShape<typeof AnalysisFindingSchema>;

function findingInit(f: Finding): FindingInit {
  const severity = SEVERITY[f.severity];
  switch (f.id) {
    case "empty":
      return { severity, finding: { case: "empty", value: {} } };
    case "overflow":
      return { severity, finding: { case: "overflow", value: { rows: f.rows } } };
    case "syntax":
      return { severity, finding: { case: "syntax", value: { share: f.share } } };
    case "repetition":
      return {
        severity,
        finding: { case: "repetition", value: { term: f.term, count: f.count, share: f.share } },
      };
    case "duplicates":
      return { severity, finding: { case: "duplicates", value: { lines: f.lines } } };
    case "crowding":
      return { severity, finding: { case: "crowding", value: { share: f.share } } };
    case "indentation":
      return { severity, finding: { case: "indentation", value: { share: f.share, maxIndent: f.maxIndent } } };
    case "narrative":
      return { severity, finding: { case: "narrative", value: { share: f.share } } };
    case "wrapped":
      return { severity, finding: { case: "wrapped", value: { lines: f.lines, cols: f.cols } } };
    case "room":
      return { severity, finding: { case: "room", value: { tokens: f.tokens } } };
    case "clean":
      return { severity, finding: { case: "clean", value: {} } };
    default:
      return assertNever(f);
  }
}

/** The report for `analysis`, measured on `spec`. */
export function toReport(analysis: Analysis, spec: PageSpec): AnalysisReport {
  const m = analysis.metrics;
  const { signals: s, verdict, findings } = analysis.assessment;
  return create(AnalysisReportSchema, {
    preset: spec.id,
    metrics: {
      cols: m.cols,
      pageRows: m.pageRows,
      capacity: m.capacity,
      tokenCeiling: m.tokenCeiling,
      chars: m.chars,
      ink: m.ink,
      rowsTotal: m.rowsTotal,
      rowsUsed: m.rowsUsed,
      fill: m.fill,
      overflow: m.overflow,
      coverage: m.coverage,
      crowding: m.crowding,
      syntaxChars: m.syntaxChars,
      syntax: m.syntax,
      repetition: m.repetition,
      repeatedTerms: m.repeatedTerms.map((t) => ({ term: t.term, count: t.count })),
      duplicateLines: m.duplicateLines,
      indentChars: m.indentChars,
      indentation: m.indentation,
      maxIndent: m.maxIndent,
      wrappedLines: m.wrappedLines,
      proseLines: m.proseLines,
      structuredLines: m.structuredLines,
      headingLines: m.headingLines,
      ...(m.narrative === null ? {} : { narrative: m.narrative }),
      tokens: m.tokens,
      ...(m.charsPerToken === null ? {} : { charsPerToken: m.charsPerToken }),
    },
    signals: {
      syntax: TONE[s.syntax],
      repetition: TONE[s.repetition],
      duplicates: TONE[s.duplicates],
      narrative: TONE[s.narrative],
      crowding: TONE[s.crowding],
      indentation: TONE[s.indentation],
    },
    verdict: VERDICT[verdict],
    findings: findings.map(findingInit),
  });
}

/** The report's binary encoding. */
export function encodeReport(report: AnalysisReport): Uint8Array {
  return toBinary(AnalysisReportSchema, report);
}

export function decodeReport(bytes: Uint8Array): AnalysisReport {
  return fromBinary(AnalysisReportSchema, bytes);
}
