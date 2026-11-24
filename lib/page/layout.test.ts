import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutRows, normalizeText, rowsUsed } from "./layout.ts";

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
