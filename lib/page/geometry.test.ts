import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellAt,
  cellRect,
  fitScale,
  PAPER_H,
  PAPER_W,
  PIXEL_RATIO_CAP,
  pixelRatio,
  PX_PER_MM_ACTUAL,
  rowTop,
  textureDensity,
} from "./geometry.ts";
import { PRESETS } from "./spec.ts";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("cells and paper points convert both ways", () => {
  for (const spec of Object.values(PRESETS)) {
    for (const [row, col] of [
      [0, 0],
      [spec.rows - 1, spec.cols - 1],
      [7, 3],
    ] as const) {
      const r = cellRect(spec, row, col);
      assert.ok(close(r.y, rowTop(spec, row)), spec.id);
      assert.deepEqual(cellAt(r.x + r.w / 2, r.y + r.h / 2, spec), { row, col }, `${spec.id} ${row},${col}`);
    }
  }
});

test("points in the margins are no cell; rows past the page continue below it", () => {
  const t = PRESETS.terminal;
  assert.equal(cellAt(1, 1, t), null);
  assert.equal(cellAt(PAPER_W - 1, PAPER_H / 2, t), null);
  assert.equal(cellAt(PAPER_W / 2, PAPER_H - 1, t), null);
  assert.ok(close(rowTop(t, t.rows), t.marginY + t.rows * t.cellH));
});

test("fit: actual size until laid out, then the smaller of width and height", () => {
  assert.equal(fitScale({ width: 0 }), PX_PER_MM_ACTUAL);
  // A wide box limits by height; a narrow box by width.
  assert.ok(close(fitScale({ width: 2000, height: 594 }, { min: 0 }), 2));
  assert.ok(close(fitScale({ width: 420, height: 5000 }, { min: 0 }), 2));
  // Never above actual size.
  assert.equal(fitScale({ width: 10_000, height: 10_000 }), PX_PER_MM_ACTUAL);
});

test("fit: two sheets share the width, less the gap", () => {
  const twoUp = fitScale({ width: 2 * 210 * 2 + 28, height: 10_000 }, { pages: 2, gap: 28, min: 0 });
  assert.ok(close(twoUp, 2));
});

test("fit: never below the floor, and the flat sheet's floor is 1 px per mm", () => {
  assert.equal(fitScale({ width: 50 }), 1);
  assert.equal(fitScale({ width: 50, height: 50 }, { min: 1.2 }), 1.2);
});

test("pixel ratio is capped, and missing means 1", () => {
  assert.equal(pixelRatio(undefined, PIXEL_RATIO_CAP.gpu), 1);
  assert.equal(pixelRatio(3, PIXEL_RATIO_CAP.gpu), 2);
  assert.equal(pixelRatio(3, PIXEL_RATIO_CAP.flat), 3);
  assert.equal(pixelRatio(1.5, PIXEL_RATIO_CAP.flat), 1.5);
});

test("texture density follows the canvas height, between 5 and 10 px per mm", () => {
  assert.equal(textureDensity(100), 5);
  assert.equal(textureDensity(2000), 9);
  assert.equal(textureDensity(10_000), 10);
});
