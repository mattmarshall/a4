/**
 * Text offsets ↔ grid cells. Rows come from `layoutRows`, so these agree with
 * the editor, both renderers, and the grid codec.
 */

import type { VisualRow } from "../page/index.ts";

export interface Cell {
  row: number;
  col: number;
}

/** A run of cells within one row: `cols` cells starting at (row, col). */
export interface CellRun {
  row: number;
  col: number;
  cols: number;
}

/**
 * Text offset for a cell: before its character, or the row's end when the
 * cell is past it. Rows past the text map to the end of the text.
 */
export function cellToOffset(rows: readonly VisualRow[], textLength: number, row: number, col: number): number {
  const r = rows[row];
  if (!r) return textLength;
  return r.start + Math.min(col, r.end - r.start);
}

/**
 * Cell of a text offset. An offset at a wrap boundary belongs to the next row,
 * where the caret is drawn. Returns null when the offset is outside the text.
 */
export function offsetToCell(rows: readonly VisualRow[], offset: number): Cell | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (offset < r.start || offset > r.end) continue;
    const next = rows[i + 1];
    if (offset === r.end && next && next.line === r.line && next.continuation) continue;
    return { row: i, col: offset - r.start };
  }
  return null;
}

/** The cells a half-open text span [start, end) covers, one run per row. */
export function spanToCells(rows: readonly VisualRow[], start: number, end: number): CellRun[] {
  const runs: CellRun[] = [];
  if (end <= start) return runs;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const a = Math.max(start, r.start);
    const b = Math.min(end, r.end);
    if (b > a) runs.push({ row: i, col: a - r.start, cols: b - a });
  }
  return runs;
}
