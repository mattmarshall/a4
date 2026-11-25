import { test } from "node:test";
import assert from "node:assert/strict";
import { fontSizeMm, PAPER_IDS, PAPER_SIZES } from "./geometry.ts";
import {
  capacity,
  DEFAULT_PRESET,
  isPaperId,
  isPresetId,
  pageSpec,
  PRESET_IDS,
  PRESETS,
  sizeOfName,
  tokenCeiling,
} from "./spec.ts";

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

test("every grid is centered and fits on its sheet, on every paper", () => {
  for (const id of PRESET_IDS) {
    for (const paper of PAPER_IDS) {
      const p = pageSpec(id, paper);
      assert.ok(p.marginX > 0 && p.marginY > 0, `${id} ${paper}`);
      const w = p.cols * p.cellW + 2 * p.marginX;
      const h = p.rows * p.cellH + 2 * p.marginY;
      assert.ok(Math.abs(w - PAPER_SIZES[paper].w) < 1e-9, `${id} ${paper} width`);
      assert.ok(Math.abs(h - PAPER_SIZES[paper].h) < 1e-9, `${id} ${paper} height`);
    }
  }
});

test("the fold ladder: Terminal is 80 x 60 on A4, 56 x 42 on A5, and 40 x 29 on A6", () => {
  const a5 = pageSpec("terminal", "a5");
  const a6 = pageSpec("terminal", "a6");
  assert.deepEqual([a5.cols, a5.rows, capacity(a5), tokenCeiling(a5)], [56, 42, 2352, 588]);
  assert.deepEqual([a6.cols, a6.rows, capacity(a6), tokenCeiling(a6)], [40, 29, 1160, 290]);
  // Cells keep their size down the ladder: text reads at the same point size.
  assert.equal(a5.cellW, PRESETS.terminal.cellW);
  assert.equal(a6.cellH, PRESETS.terminal.cellH);
  assert.deepEqual([a5.paperW, a5.paperH, a6.paperW, a6.paperH], [148, 210, 105, 148]);
});

test("every preset down the ladder matches the design's table", () => {
  const grids = (paper: "a4" | "a5" | "a6") =>
    PRESET_IDS.map((id) => [id, pageSpec(id, paper).cols, pageSpec(id, paper).rows]);
  assert.deepEqual(grids("a4"), [
    ["terminal", 80, 60],
    ["pica", 62, 58],
    ["elite", 75, 58],
    ["dense", 100, 80],
  ]);
  assert.deepEqual(grids("a5"), [
    ["terminal", 56, 42],
    ["pica", 44, 41],
    ["elite", 53, 41],
    ["dense", 70, 56],
  ]);
  assert.deepEqual(grids("a6"), [
    ["terminal", 40, 29],
    ["pica", 31, 28],
    ["elite", 37, 28],
    ["dense", 50, 39],
  ]);
});

test("the A4 presets are the A4 page specs, and specs compare by identity", () => {
  for (const id of PRESET_IDS) assert.equal(PRESETS[id], pageSpec(id, "a4"), id);
  assert.equal(pageSpec("pica", "a5"), pageSpec("pica", "a5"));
  assert.equal(PRESETS.terminal.paper, "a4");
});

test("a page's size comes from its name", () => {
  for (const [name, size] of [
    ["card.a5.md", "a5"],
    ["CARD.A5.MD", "a5"],
    ["note.a6.mdc", "a6"],
    ["Deploy note.a6", "a6"],
    [".agents/letters/2026-11-25-0930-auth.a5.md", "a5"],
    ["CLAUDE.md", "a4"],
    ["a5.md", "a4"],
    ["x.a4.md", "a4"],
    ["x.a7.md", "a4"],
    ["notes.a5.txt", "a4"],
  ] as const) {
    assert.equal(sizeOfName(name), size, name);
  }
});

test("only a4, a5, and a6 are paper ids", () => {
  for (const id of ["a4", "a5", "a6"]) assert.ok(isPaperId(id), id);
  for (const bad of ["A4", "a3", "", "toString", 5]) assert.equal(isPaperId(bad), false, String(bad));
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
