import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutRows, normalizeText, pageFit, rowsUsed } from "./layout.ts";

test("normalizes tabs to two spaces and CRLF/CR to LF", () => {
  assert.equal(normalizeText("a\tb\r\nc"), "a  b\nc");
  assert.equal(normalizeText("x\ry"), "x\ny");
});

test("a 170-character line wraps into rows of 80, 80, and 10", () => {
  const rows = layoutRows("x".repeat(170), 80);
  assert.deepEqual(
    rows.map((r) => r.end - r.start),
    [80, 80, 10],
  );
  assert.deepEqual(
    rows.map((r) => r.continuation),
    [false, true, true],
  );
});

test("an exactly-80-character line fills one row; the 81st character wraps", () => {
  assert.equal(layoutRows("y".repeat(80), 80).length, 1);
  const rows = layoutRows(`${"y".repeat(80)},`, 80);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].end - rows[1].start, 1);
});

test("rows used stops at the last row with ink", () => {
  const rows = layoutRows("one\n\ntwo\n\n\n", 80);
  assert.equal(rows.length, 6);
  assert.equal(rowsUsed(rows), 3);
  assert.equal(rowsUsed(layoutRows("   \n  ", 80)), 0);
});

test("row ink counts non-whitespace characters", () => {
  const rows = layoutRows(`${"#".repeat(80)}\n\n  ab  `, 80);
  assert.deepEqual(
    rows.map((r) => r.ink),
    [80, 0, 2],
  );
});

const TERMINAL_PAGE = { cols: 80, rows: 60 };
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

test("pageFit: exactly 60 rows fits", () => {
  assert.deepEqual(pageFit(lines(60), TERMINAL_PAGE), { rowsUsed: 60, pageRows: 60, fits: true, overBy: 0 });
});

test("pageFit: 63 rows is over by 3", () => {
  assert.deepEqual(pageFit(lines(63), TERMINAL_PAGE), { rowsUsed: 63, pageRows: 60, fits: false, overBy: 3 });
});

test("pageFit: trailing blank lines don't count", () => {
  const fit = pageFit(`${lines(58)}\n\n\n\n\n`, TERMINAL_PAGE);
  assert.equal(fit.rowsUsed, 58);
  assert.equal(fit.fits, true);
});
