/**
 * Metrics: how a page spends its cells, as plain numbers (and term counts),
 * so a painter, a report, or a CI check can take them without the rest.
 */

import {
  capacity,
  countInk,
  rowsUsed as countRowsUsed,
  tokenCeiling,
  type PageSpec,
  type VisualRow,
} from "../page/index.ts";
import type { LineKind } from "./classify.ts";
import { countSyntax, LETTER_OR_DIGIT } from "./syntax.ts";
import { termStats, type TermCount } from "./terms.ts";
import { estimateTokens } from "./tokens.ts";

/** Where the text sits on the page: what the painter needs. */
export interface Layout {
  /** The text's visual rows at the page's width. */
  readonly rows: readonly VisualRow[];
  /** One kind per logical line. */
  readonly lineKinds: readonly LineKind[];
}

export interface Metrics {
  readonly cols: number;
  readonly pageRows: number;
  readonly capacity: number;
  readonly tokenCeiling: number;
  readonly chars: number;
  readonly ink: number;
  readonly rowsTotal: number;
  readonly rowsUsed: number;
  readonly fill: number;
  readonly overflow: number;
  readonly coverage: number;
  readonly crowding: number;
  readonly syntaxChars: number;
  readonly syntax: number;
  readonly repetition: number;
  /** Terms seen more than once, most frequent first. */
  readonly repeatedTerms: readonly TermCount[];
  /** Every term, most frequent first. */
  readonly termCounts: readonly TermCount[];
  readonly duplicateLines: number;
  readonly indentChars: number;
  readonly indentation: number;
  readonly maxIndent: number;
  readonly wrappedLines: number;
  readonly proseLines: number;
  readonly structuredLines: number;
  readonly headingLines: number;
  /** Prose / (prose + structured); null when there are neither. */
  readonly narrative: number | null;
  readonly tokens: number;
  readonly charsPerToken: number | null;
}

export function measure(layout: Layout, text: string, spec: PageSpec): Metrics {
  const cols = spec.cols;
  const pageRows = spec.rows;
  const cap = capacity(spec);
  const { rows, lineKinds } = layout;
  const used = countRowsUsed(rows);

  const ink = countInk(text);
  const syntaxChars = countSyntax(text);
  const { termCounts, repetition } = termStats(text);
  const repeatedTerms = termCounts.filter((t) => t.count > 1);

  const seen = new Map<string, number>();
  let duplicateLines = 0;
  let indentChars = 0;
  let maxIndent = 0;
  let wrappedLines = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (line.length > cols) wrappedLines++;
    if (trimmed === "") continue;
    const indent = line.length - line.trimStart().length;
    indentChars += indent;
    maxIndent = Math.max(maxIndent, indent);
    if (LETTER_OR_DIGIT.test(trimmed)) {
      const n = (seen.get(trimmed) ?? 0) + 1;
      seen.set(trimmed, n);
      if (n > 1) duplicateLines++;
    }
  }

  const proseLines = lineKinds.filter((k) => k === "prose").length;
  const structuredLines = lineKinds.filter((k) => k === "structured").length;
  const headingLines = lineKinds.filter((k) => k === "heading").length;
  const narrativeBase = proseLines + structuredLines;

  const usedCells = used * cols;
  const tokens = estimateTokens(text);

  return {
    cols,
    pageRows,
    capacity: cap,
    tokenCeiling: tokenCeiling(spec),
    chars: text.length,
    ink,
    rowsTotal: rows.length,
    rowsUsed: used,
    fill: used / pageRows,
    overflow: Math.max(0, used - pageRows),
    coverage: ink / cap,
    crowding: usedCells === 0 ? 0 : ink / usedCells,
    syntaxChars,
    syntax: ink === 0 ? 0 : syntaxChars / ink,
    repetition,
    repeatedTerms,
    termCounts,
    duplicateLines,
    indentChars,
    indentation: usedCells === 0 ? 0 : indentChars / usedCells,
    maxIndent,
    wrappedLines,
    proseLines,
    structuredLines,
    headingLines,
    narrative: narrativeBase === 0 ? null : proseLines / narrativeBase,
    tokens,
    charsPerToken: tokens === 0 ? null : text.length / tokens,
  };
}
