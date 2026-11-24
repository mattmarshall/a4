/**
 * Plain-text model of a page: normalization and the visual-row layout that
 * mirrors the sheet's character wrap (a line wraps after exactly `cols`
 * characters, regardless of word boundaries).
 */

import { countInk } from "./chars.ts";

export const TAB_SPACES = "  ";

/** Convert CRLF/CR to LF and tabs to two spaces. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, TAB_SPACES);
}

export interface VisualRow {
  /** Index of the logical line this row belongs to. */
  line: number;
  /** Offset of the row's first character in the full text. */
  start: number;
  /** Offset one past the row's last character (excludes the newline). */
  end: number;
  /** Non-whitespace characters in the row. */
  ink: number;
  /** True when this row continues a line that wrapped. */
  continuation: boolean;
}

/** Rows a logical line of `length` characters occupies at `cols` columns. */
export function rowsForLength(length: number, cols: number): number {
  return Math.max(1, Math.ceil(length / cols));
}

/** Lay the text out into visual rows at `cols` columns. */
export function layoutRows(text: string, cols: number): VisualRow[] {
  const rows: VisualRow[] = [];
  const lines = text.split("\n");
  let offset = 0;
  lines.forEach((line, lineIndex) => {
    const n = rowsForLength(line.length, cols);
    for (let r = 0; r < n; r++) {
      const start = offset + r * cols;
      const end = offset + Math.min(line.length, (r + 1) * cols);
      rows.push({
        line: lineIndex,
        start,
        end,
        ink: countInk(text.slice(start, end)),
        continuation: r > 0,
      });
    }
    offset += line.length + 1;
  });
  return rows;
}

/** Rows through the last row that contains a non-whitespace character. */
export function rowsUsed(rows: readonly VisualRow[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if ((rows[i]?.ink ?? 0) > 0) return i + 1;
  }
  return 0;
}
