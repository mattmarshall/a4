/**
 * Assessment: the page's verdict and findings, from its metrics and signals.
 * Findings are data; the UI writes the English (components/analysis-copy.ts).
 */

import type { AnalysisConfig } from "./config.ts";
import type { Metrics } from "./metrics.ts";
import { signals, type Signals } from "./signals.ts";

/** The page's overall reading. Labels and summaries live in the UI's copy. */
export type VerdictId = "empty" | "overflowing" | "noisy" | "busy" | "light" | "balanced";

export type Severity = "critical" | "warning" | "info";

/**
 * What the analysis found: each finding's id, severity, and the numbers its
 * copy quotes. Shares are fractions (0.25 is 25%).
 */
export type Finding =
  | { readonly id: "empty"; readonly severity: "info" }
  | { readonly id: "overflow"; readonly severity: "critical"; readonly rows: number }
  /** A warning when syntax is noisy; an info note when it is merely high. */
  | { readonly id: "syntax"; readonly severity: "warning" | "info"; readonly share: number }
  | {
      readonly id: "repetition";
      readonly severity: "warning";
      readonly term: string;
      readonly count: number;
      readonly share: number;
    }
  | { readonly id: "duplicates"; readonly severity: "warning"; readonly lines: number }
  | { readonly id: "crowding"; readonly severity: "warning"; readonly share: number }
  | { readonly id: "indentation"; readonly severity: "warning"; readonly share: number; readonly maxIndent: number }
  | { readonly id: "narrative"; readonly severity: "warning"; readonly share: number }
  | { readonly id: "wrapped"; readonly severity: "info"; readonly lines: number; readonly cols: number }
  | { readonly id: "room"; readonly severity: "info"; readonly tokens: number }
  | { readonly id: "clean"; readonly severity: "info" };

export type FindingId = Finding["id"];

export interface Assessment {
  /** How each judged metric reads; the verdict, findings, and bars all use it. */
  readonly signals: Signals;
  readonly verdict: VerdictId;
  readonly findings: readonly Finding[];
}

/** The first verdict that applies, in the order density-analysis "Verdict" gives. */
export function verdictFor(m: Metrics, s: Signals, config: AnalysisConfig): VerdictId {
  if (m.ink === 0) return "empty";
  if (m.overflow > 0) return "overflowing";
  if (s.syntax === "bad" || s.repetition === "bad" || s.duplicates === "bad") return "noisy";
  // A short page is Light even when its few rows are dense; crowding only
  // makes a page Busy once there is enough of it to be hard to scan.
  if (m.fill < config.verdict.lightFill) return "light";
  if (s.crowding === "bad" || s.indentation === "bad") return "busy";
  return "balanced";
}

export function findingsFor(m: Metrics, verdict: VerdictId, s: Signals, config: AnalysisConfig): Finding[] {
  const out: Finding[] = [];

  if (verdict === "empty") return [{ id: "empty", severity: "info" }];

  if (m.overflow > 0) out.push({ id: "overflow", severity: "critical", rows: m.overflow });

  if (s.syntax === "bad") out.push({ id: "syntax", severity: "warning", share: m.syntax });
  else if (s.syntax === "warn") out.push({ id: "syntax", severity: "info", share: m.syntax });

  const top = m.repeatedTerms[0];
  if (s.repetition === "bad" && top) {
    out.push({ id: "repetition", severity: "warning", term: top.term, count: top.count, share: m.repetition });
  }

  if (s.duplicates === "bad") out.push({ id: "duplicates", severity: "warning", lines: m.duplicateLines });

  if (s.crowding === "bad") out.push({ id: "crowding", severity: "warning", share: m.crowding });

  if (s.indentation === "bad") {
    out.push({ id: "indentation", severity: "warning", share: m.indentation, maxIndent: m.maxIndent });
  }

  if (s.narrative === "bad" && m.narrative !== null) {
    out.push({ id: "narrative", severity: "warning", share: m.narrative });
  }

  if (m.wrappedLines > 0) out.push({ id: "wrapped", severity: "info", lines: m.wrappedLines, cols: m.cols });

  if (m.overflow === 0 && m.fill < config.verdict.lightFill) {
    out.push({ id: "room", severity: "info", tokens: Math.max(0, m.tokenCeiling - m.tokens) });
  }

  // "Reads clean" only when no signal needs attention (a syntax note does).
  const quiet = Object.values(s).every((tone) => tone === "ok" || tone === "na");
  if (quiet && out.every((f) => f.severity === "info") && (verdict === "balanced" || verdict === "light")) {
    out.unshift({ id: "clean", severity: "info" });
  }

  return out;
}

export function assess(m: Metrics, config: AnalysisConfig): Assessment {
  const s = signals(m, config);
  const verdict = verdictFor(m, s, config);
  return { signals: s, verdict, findings: findingsFor(m, verdict, s, config) };
}
