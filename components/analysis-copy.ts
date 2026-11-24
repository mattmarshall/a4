/**
 * The English copy for the analysis: verdict labels and summaries, and each
 * finding's title and detail. The analysis itself (lib/analysis) returns
 * only ids and numbers, so a CLI or another language can write its own.
 *
 * Relative imports, so Node's test runner can load this file
 * (components/analysis-copy.test.ts).
 */

import type { Finding, VerdictId } from "../lib/analysis/index.ts";
import { assertNever } from "../lib/page/index.ts";

export const VERDICT_LABEL: Readonly<Record<VerdictId, string>> = {
  empty: "Empty",
  overflowing: "Overflowing",
  noisy: "Noisy",
  busy: "Busy",
  light: "Light",
  balanced: "Balanced",
};

export const VERDICT_SUMMARY: Readonly<Record<VerdictId, string>> = {
  empty: "Nothing on the page yet.",
  overflowing: "Doesn’t fit. This is more than one page of context.",
  noisy: "Too much scaffolding or repetition for the meaning it carries.",
  busy: "Fits, but crowded. Hard to scan at a glance.",
  light: "A short page with plenty of room.",
  balanced: "Fits the page and reads clean.",
};

/** The color a verdict chip takes (its `data-tone` in the CSS). */
export type VerdictTone = "ok" | "warn" | "crit" | "muted";

export const VERDICT_TONE: Readonly<Record<VerdictId, VerdictTone>> = {
  empty: "muted",
  overflowing: "crit",
  noisy: "warn",
  busy: "warn",
  light: "ok",
  balanced: "ok",
};

/** Number formatting for the copy. */
export interface CopyFormat {
  /** A fraction as a percentage: 0.25 → "25%". */
  pct(share: number): string;
  /** A count: 1200 → "1,200". */
  count(n: number): string;
}

export const ENGLISH: CopyFormat = {
  pct: (share) => `${Math.round(share * 100)}%`,
  count: (n) => n.toLocaleString("en-US"),
};

const KIB = 1024;
const MIB = 1024 * KIB;

/**
 * A size limit, in binary units as the limits are defined: 1,048,576 → "1 MiB",
 * 104,857,600 → "100 MiB"; anything under a whole MiB in KB (512 KiB → "512 KB").
 */
export function formatByteLimit(bytes: number): string {
  if (bytes >= MIB && bytes % MIB === 0) return `${ENGLISH.count(bytes / MIB)} MiB`;
  return `${ENGLISH.count(Math.round(bytes / KIB))} KB`;
}

export interface FindingCopy {
  title: string;
  detail: string;
}

export function describeFinding(finding: Finding, format: CopyFormat = ENGLISH): FindingCopy {
  const { pct } = format;
  switch (finding.id) {
    case "empty":
      return {
        title: "Blank page",
        detail: "Start with one line that says what this page is for and who will read it.",
      };
    case "overflow":
      return {
        title: `${finding.rows} ${finding.rows === 1 ? "row" : "rows"} over the page`,
        detail: "Cut what the agent does not need, or split this into two pages that each serve one purpose.",
      };
    case "syntax":
      return {
        title: `${pct(finding.share)} of the ink is syntax`,
        detail:
          finding.severity === "warning"
            ? "Quotes, braces, colons, and markup are scaffolding, not meaning. Say it in sentences, or use a compact table for genuinely tabular data."
            : "Acceptable, but check that every bit of formatting carries meaning.",
      };
    case "repetition":
      return {
        title: `“${finding.term}” appears ${finding.count}×`,
        detail: `${pct(finding.share)} of word ink is repeats. State shared values once, then list only the exceptions.`,
      };
    case "duplicates":
      return {
        title: `${finding.lines} duplicated lines`,
        detail: "Collapse identical lines into one statement with a count or a range.",
      };
    case "crowding":
      return {
        title: `Rows are ${pct(finding.share)} inked`,
        detail: "Break the text into short paragraphs separated by blank lines so it can be scanned.",
      };
    case "indentation":
      return {
        title: `Indentation uses ${pct(finding.share)} of the used area`,
        detail: `Deepest indent is ${finding.maxIndent} columns. Flatten the nesting and state relationships in words instead of whitespace.`,
      };
    case "narrative":
      return {
        title: `Only ${pct(finding.share)} of lines read as sentences`,
        detail: "Fields tell the agent what; sentences tell it why. Connect facts with “because”, “so”, and “unless”.",
      };
    case "wrapped":
      return {
        title: `${finding.lines} ${finding.lines === 1 ? "line wraps" : "lines wrap"} past column ${finding.cols}`,
        detail: "Break long lines where the thought breaks; wrapped rows are harder to scan.",
      };
    case "room":
      return {
        title: `Room for ≈${format.count(finding.tokens)} more tokens`,
        detail: "A light page is fine. Don’t pad it; add only what changes what the agent will do.",
      };
    case "clean":
      return {
        title: "Reads clean",
        detail: "Fits the page, with little scaffolding and little repetition.",
      };
    default:
      return assertNever(finding);
  }
}
