/**
 * The sheet tensor codec: page text ↔ a [rows, cols] grid of UTF-16 code
 * units, laid out exactly like the editor (`layoutRows`). Lossless for any
 * JavaScript string; normalize text first (`normalizeText`) to match what the
 * editor stores.
 *
 * Shape: cols is the preset's column count; rows is max(preset rows, rows
 * used), so a page that fits always has the preset's shape. Cells past a
 * row's length hold 0; row lengths and continuation flags carry the layout,
 * so NUL characters and newlines need no sentinels.
 */

import { create } from "@bufbuild/protobuf";
import { GridSchema, type Grid } from "../gen/a4/v1/sheet_pb.js";
import { layoutRows } from "../page/index.ts";

export interface GridShape {
  cols: number;
  rows: number;
}

/** Encode text into a grid for a page of `shape.cols` × `shape.rows` cells. */
export function encodeGrid(text: string, shape: GridShape): Grid {
  const { cols } = shape;
  if (!Number.isInteger(cols) || cols < 1) throw new RangeError(`cols must be a positive integer, got ${cols}`);
  const laid = layoutRows(text, cols);
  const rowsUsed = laid.length;
  const rows = Math.max(shape.rows, rowsUsed);
  const cells = new Array<number>(rows * cols).fill(0);
  const rowLengths = new Array<number>(rows).fill(0);
  const continuation = new Array<boolean>(rows).fill(false);
  laid.forEach((r, i) => {
    const base = i * cols;
    for (let k = r.start; k < r.end; k++) cells[base + k - r.start] = text.charCodeAt(k);
    rowLengths[i] = r.end - r.start;
    continuation[i] = r.continuation;
  });
  return create(GridSchema, { rows, cols, rowsUsed, cells, rowLengths, continuation });
}

/** Check a grid's shape fields agree; throws RangeError when they don't. */
export function checkGridShape(grid: Grid): void {
  const { rows, cols, rowsUsed } = grid;
  if (cols < 1) throw new RangeError("grid has no columns");
  if (rowsUsed < 1 || rowsUsed > rows) throw new RangeError(`rows_used ${rowsUsed} is outside 1..${rows}`);
  if (grid.cells.length !== rows * cols)
    throw new RangeError(`grid has ${grid.cells.length} cells, expected ${rows * cols}`);
  if (grid.rowLengths.length !== rows)
    throw new RangeError(`grid has ${grid.rowLengths.length} row lengths, expected ${rows}`);
  if (grid.continuation.length !== rows)
    throw new RangeError(`grid has ${grid.continuation.length} continuation flags, expected ${rows}`);
  grid.rowLengths.forEach((n, i) => {
    if (n > cols) throw new RangeError(`row ${i} length ${n} exceeds ${cols} columns`);
  });
}

/** Decode a grid back to its text. The exact inverse of `encodeGrid`. */
export function decodeGrid(grid: Grid): string {
  checkGridShape(grid);
  const { cols, rowsUsed } = grid;
  const parts: string[] = [];
  for (let r = 0; r < rowsUsed; r++) {
    if (r > 0 && !grid.continuation[r]) parts.push("\n");
    const base = r * cols;
    const len = grid.rowLengths[r];
    let row = "";
    for (let c = 0; c < len; c++) row += String.fromCharCode(grid.cells[base + c]);
    parts.push(row);
  }
  return parts.join("");
}

/**
 * The first row where two grids differ (shape, length, continuation, or
 * cells), or -1 when they are identical.
 */
export function firstDifferingRow(a: Grid, b: Grid): number {
  const rows = Math.max(a.rows, b.rows);
  if (a.cols !== b.cols) return 0;
  for (let r = 0; r < rows; r++) {
    if (r >= a.rows || r >= b.rows) return r;
    if (a.rowLengths[r] !== b.rowLengths[r] || a.continuation[r] !== b.continuation[r]) return r;
    const base = r * a.cols;
    for (let c = 0; c < a.cols; c++) if (a.cells[base + c] !== b.cells[base + c]) return r;
  }
  if (a.rowsUsed !== b.rowsUsed) return Math.min(a.rowsUsed, b.rowsUsed);
  return -1;
}
