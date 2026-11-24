import { test } from "node:test";
import assert from "node:assert/strict";
import { needsNormalizing, normalizeEdit } from "./normalize.ts";

test("only tabs and carriage returns need cleaning", () => {
  assert.ok(needsNormalizing("x\ty"));
  assert.ok(needsNormalizing("a\r\nb"));
  assert.ok(!needsNormalizing("plain\ntext  with spaces"));
});

test("dropped tabbed text: only the dropped range is rewritten, and the caret follows it", () => {
  assert.deepEqual(normalizeEdit("abc", "abcx\ty", 6), { start: 3, end: 6, replacement: "x  y", caret: 7 });
  // Dropped in the middle: the text after it keeps its place relative to the caret.
  assert.deepEqual(normalizeEdit("ab|cd", "ab\tx|cd", 4), { start: 2, end: 4, replacement: "  x", caret: 5 });
});

test("a caret inside the changed range maps into the cleaned text", () => {
  const edit = normalizeEdit("", "a\tb\tc", 3);
  assert.deepEqual(edit, { start: 0, end: 5, replacement: "a  b  c", caret: 4 });
});

test("a caret before the range stays put", () => {
  assert.equal(normalizeEdit("abc", "abc\t", 1)?.caret, 1);
});

test("CR LF becomes one newline, even when the edit splits the pair", () => {
  assert.deepEqual(normalizeEdit("ab", "a\r\nxb", 4), { start: 1, end: 4, replacement: "\nx", caret: 3 });
  // Only the CR was inserted, before an existing LF.
  assert.deepEqual(normalizeEdit("a\nb", "a\r\nb", 2), { start: 1, end: 3, replacement: "\n", caret: 2 });
  // A lone CR is a newline.
  assert.deepEqual(normalizeEdit("ab", "a\rb", 2), { start: 1, end: 2, replacement: "\n", caret: 2 });
});

test("an edit that adds no tabs or carriage returns needs nothing", () => {
  assert.equal(normalizeEdit("abc", "abcd", 4), null);
  assert.equal(normalizeEdit("abc", "ab", 2), null);
  assert.equal(normalizeEdit("same", "same", 4), null);
});
