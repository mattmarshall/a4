import assert from "node:assert/strict";
import { test } from "node:test";
import { PRESETS, layoutRows } from "../page/index.ts";
import { cellToOffset, offsetToCell, spanToCells } from "./cells.ts";
import { decodeGrid, encodeGrid } from "./codec.ts";

const T = PRESETS.terminal; // 80 × 60

/** Deterministic PRNG (mulberry32) so property tests are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pieces chosen to hit the edge cases: newline runs, spaces, NUL, a lone
// surrogate, an astral pair, accented letters, and runs that land exactly on
// a column multiple.
const PIECES = ["a", "b", " ", "  ", "\n", "\n\n", "\0", "\uD800", "😀", "é", "{", "x".repeat(5), "y".repeat(80)];

function randomText(next: () => number): string {
  const n = Math.floor(next() * 60);
  let s = "";
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(next() * PIECES.length)];
  return s;
}

const rowText = (g: ReturnType<typeof encodeGrid>, r: number) =>
  String.fromCharCode(...g.cells.slice(r * g.cols, r * g.cols + g.rowLengths[r]));

test("property: decode(encode(text)) is the original text, for many shapes", () => {
  const next = rng(0xa4);
  for (let i = 0; i < 2000; i++) {
    const text = randomText(next);
    for (const shape of [
      { cols: 80, rows: 60 },
      { cols: 5, rows: 3 },
      { cols: 1, rows: 1 },
    ]) {
      assert.equal(
        decodeGrid(encodeGrid(text, shape)),
        text,
        `round trip failed for ${JSON.stringify(text)} at ${shape.cols} cols`,
      );
    }
  }
});

test("property: rows, lengths, and continuation match layoutRows; padding is zero", () => {
  const next = rng(7);
  for (let i = 0; i < 1000; i++) {
    const text = randomText(next);
    const cols = 1 + Math.floor(next() * 12);
    const shape = { cols, rows: 4 };
    const g = encodeGrid(text, shape);
    const laid = layoutRows(text, cols);
    assert.equal(g.rowsUsed, laid.length);
    assert.equal(g.rows, Math.max(shape.rows, laid.length));
    assert.equal(g.cells.length, g.rows * cols);
    laid.forEach((r, k) => {
      assert.equal(g.rowLengths[k], r.end - r.start);
      assert.equal(g.continuation[k], r.continuation);
      assert.equal(rowText(g, k), text.slice(r.start, r.end));
    });
    for (let r = 0; r < g.rows; r++) {
      for (let c = g.rowLengths[r]; c < cols; c++) assert.equal(g.cells[r * cols + c], 0);
      if (r >= g.rowsUsed) assert.equal(g.continuation[r], false);
    }
  }
});

// --- sheet-tensor spec scenarios -------------------------------------------

test("grid encoding: a short page", () => {
  const g = encodeGrid("ab\ncd", T);
  assert.deepEqual(g.cells.slice(0, 80), [97, 98, ...new Array(78).fill(0)]);
  assert.deepEqual(g.cells.slice(80, 160), [99, 100, ...new Array(78).fill(0)]);
});

test("grid encoding: a wrapped line", () => {
  const line = "w".repeat(80) + "z".repeat(5);
  const g = encodeGrid(line, T);
  assert.equal(rowText(g, 0), "w".repeat(80));
  assert.equal(rowText(g, 1), "zzzzz");
});

test("grid shape: a page that fits is 60 × 80", () => {
  const text = Array.from({ length: 12 }, (_, i) => `row ${i}`).join("\n");
  const g = encodeGrid(text, T);
  assert.equal(g.rows, 60);
  assert.equal(g.cols, 80);
  assert.equal(g.rowsUsed, 12);
});

test("grid shape: an overflowing page keeps all 67 rows", () => {
  const text = Array.from({ length: 67 }, (_, i) => `row ${i}`).join("\n");
  const g = encodeGrid(text, T);
  assert.equal(g.rows, 67);
  assert.equal(g.cols, 80);
  assert.equal(g.rowsUsed, 67);
});

test("row metadata: continuation flags", () => {
  const g = encodeGrid("c".repeat(100) + "\nx", T);
  assert.deepEqual(g.rowLengths.slice(0, 3), [80, 20, 1]);
  assert.deepEqual(g.continuation.slice(0, 3), [false, true, false]);
  assert.equal(g.rowLengths[3], 0);
});

test("row metadata: a line of exactly one row", () => {
  const g = encodeGrid("e".repeat(80) + "\ny", T);
  assert.equal(g.rowLengths[0], 80);
  assert.equal(rowText(g, 1), "y");
  assert.deepEqual(g.continuation.slice(0, 2), [false, false]);
});

test("lossless round trip: edge cases", () => {
  for (const text of [
    "",
    "\n",
    "\n\n\n",
    "a ",
    "trailing   \n  lead",
    "\0mid\0",
    "\uD800",
    "😀😀",
    "x".repeat(160),
    "x".repeat(160) + "\n",
  ]) {
    assert.equal(decodeGrid(encodeGrid(text, T)), text);
  }
});

test("lossless round trip: empty page", () => {
  const g = encodeGrid("", T);
  assert.equal(g.rowsUsed, 1);
  assert.equal(g.rowLengths[0], 0);
  assert.equal(decodeGrid(g), "");
});

test("offsets and cells: offset to cell", () => {
  const rows = layoutRows("q".repeat(100) + "\nnext", 80);
  assert.deepEqual(offsetToCell(rows, 82), { row: 1, col: 2 });
  // A cell past a row's end maps to that row's end.
  assert.equal(cellToOffset(rows, 105, 1, 40), 100);
});

test("offsets and cells: span across rows", () => {
  const rows = layoutRows("q".repeat(100) + "\nnext", 80);
  assert.deepEqual(spanToCells(rows, 78, 83), [
    { row: 0, col: 78, cols: 2 },
    { row: 1, col: 0, cols: 3 },
  ]);
});

test("decode rejects a malformed grid", () => {
  const g = encodeGrid("abc", T);
  g.cells.pop();
  assert.throws(() => decodeGrid(g), RangeError);
});
