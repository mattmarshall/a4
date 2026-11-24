import { test } from "node:test";
import assert from "node:assert/strict";
import { fontSizeMm, PAPER_H, PAPER_W } from "./geometry.ts";
import { capacity, DEFAULT_PRESET, isPresetId, PRESETS, tokenCeiling } from "./spec.ts";

test("Terminal is the default 80 x 60 page with 4,800 cells", () => {
  const t = PRESETS[DEFAULT_PRESET];
  assert.equal(t.id, "terminal");
  assert.equal(t.cols, 80);
  assert.equal(t.rows, 60);
  assert.equal(capacity(t), 4800);
  assert.ok(Math.abs(t.marginX - 16) < 1e-9);
  assert.ok(Math.abs(t.marginY - 15) < 1e-9);
});

test("presets derive whole-cell grids inside their margins", () => {
  assert.deepEqual([PRESETS.pica.cols, PRESETS.pica.rows], [62, 58]);
  assert.equal(capacity(PRESETS.pica), 3596);
  assert.deepEqual([PRESETS.elite.cols, PRESETS.elite.rows], [75, 58]);
  assert.deepEqual([PRESETS.dense.cols, PRESETS.dense.rows], [100, 80]);
  assert.equal(capacity(PRESETS.dense), 8000);
});

test("every grid is centered and fits on the sheet", () => {
  for (const p of Object.values(PRESETS)) {
    assert.ok(p.marginX > 0 && p.marginY > 0, p.id);
    const w = p.cols * p.cellW + 2 * p.marginX;
    const h = p.rows * p.cellH + 2 * p.marginY;
    assert.ok(Math.abs(w - PAPER_W) < 1e-9, `${p.id} width`);
    assert.ok(Math.abs(h - PAPER_H) < 1e-9, `${p.id} height`);
  }
});

test("token ceiling is a quarter of the cells, rounded down", () => {
  assert.equal(tokenCeiling(PRESETS.terminal), 1200);
  assert.equal(tokenCeiling(PRESETS.pica), 899);
});

test("font size makes a 0.6 em glyph exactly one cell wide", () => {
  for (const p of Object.values(PRESETS)) {
    assert.ok(Math.abs(fontSizeMm(p) * 0.6 - p.cellW) < 1e-12);
  }
});

test("only the four presets are preset ids, not inherited object keys", () => {
  for (const id of ["terminal", "pica", "elite", "dense"]) assert.ok(isPresetId(id), id);
  for (const bad of ["toString", "constructor", "__proto__", "hasOwnProperty", "", "Terminal", 4]) {
    assert.equal(isPresetId(bad), false, String(bad));
  }
});
