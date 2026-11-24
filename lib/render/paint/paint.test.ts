import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../../analysis/index.ts";
import { INCIDENT_JSON, INCIDENT_NARRATIVE, WELCOME } from "../../content/index.ts";
import { layoutRows, PAPER_H, PRESETS, type LensId } from "../../page/index.ts";
import { SHEET_STYLE } from "../element/style.ts";
import { PALETTE } from "../palette.ts";
import type { PaintSettings } from "./frame.ts";
import { HEAT_MAX_ALPHA, heatFill } from "./heat.ts";
import { pageModel, type PagePlane } from "./model.ts";
import { paintPage } from "./page.ts";
import type { Paint2D, PaintSurface } from "./paint2d.ts";
import { printRows } from "./print.ts";
import { PAINT_THEME } from "./theme.ts";

const T = PRESETS.terminal;
const K = 4;

interface Op {
  op: "fillRect" | "fillText" | "stroke" | "clip";
  args: (number | string)[];
  fill: string;
  font: string;
}

/** A Paint2D that records every draw with the fill and font in effect. */
function recording(): { surface: PaintSurface; ops: Op[] } {
  const ops: Op[] = [];
  const ctx: Paint2D = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    moveTo() {},
    lineTo() {},
    clip() {
      ops.push({ op: "clip", args: [], fill: String(ctx.fillStyle), font: ctx.font });
    },
    stroke() {
      ops.push({ op: "stroke", args: [], fill: String(ctx.strokeStyle), font: ctx.font });
    },
    fillRect(x, y, w, h) {
      ops.push({ op: "fillRect", args: [x, y, w, h], fill: String(ctx.fillStyle), font: ctx.font });
    },
    fillText(text, x, y) {
      ops.push({ op: "fillText", args: [text, x, y], fill: String(ctx.fillStyle), font: ctx.font });
    },
    measureText() {
      return { fontBoundingBoxAscent: 0, fontBoundingBoxDescent: 0 };
    },
  };
  return { surface: { width: 0, height: 0, getContext: () => ctx }, ops };
}

const SETTINGS: PaintSettings = {
  fontFamily: "mono",
  pxPerMm: K,
  selection: { start: 0, end: 0, focused: false },
  overflow: false,
  grid: false,
  chrome: "texture",
};

function paint(text: string, settings: Partial<PaintSettings> = {}, lens: LensId = "ink", plane?: PagePlane) {
  const { surface, ops } = recording();
  const result = paintPage(surface, pageModel(text, T, lens, plane), { ...SETTINGS, ...settings });
  return { ops, result, surface };
}

const cell = (row: number, col: number) => ({
  x: (T.marginX + col * T.cellW) * K,
  y: (T.marginY + row * T.cellH) * K,
});
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const fills = (ops: Op[], fill: string) => ops.filter((o) => o.op === "fillRect" && o.fill === fill);

test("the model needs no analysis, and agrees with it", () => {
  for (const text of [WELCOME, INCIDENT_JSON, INCIDENT_NARRATIVE, `${WELCOME}\n${WELCOME}`, ""]) {
    const model = pageModel(text, T, "structure");
    const analysis = analyze(text, T);
    assert.deepEqual(model.rows, analysis.layout.rows);
    assert.deepEqual(model.lineKinds, analysis.layout.lineKinds);
    assert.equal(model.overflow, analysis.metrics.overflow);
    assert.equal(model.styles.length, text.length);
  }
});

test("a selection highlights exactly its cells on each row, on the texture only", () => {
  const text = "abcdef\nghijkl";
  const { ops } = paint(text, { selection: { start: 2, end: 9, focused: true } });
  const rects = fills(ops, PAINT_THEME.selection).map((o) => o.args);
  assert.equal(rects.length, 2);
  const [first, second] = rects;
  assert.ok(first && second);
  const c = T.cellW * K;
  assert.ok(
    near(Number(first[0]), cell(0, 2).x) && near(Number(first[1]), cell(0, 2).y) && near(Number(first[2]), 4 * c),
  );
  assert.ok(
    near(Number(second[0]), cell(1, 0).x) && near(Number(second[1]), cell(1, 0).y) && near(Number(second[2]), 2 * c),
  );

  // The textarea draws the selection in flat rendering, and an unfocused sheet shows none.
  assert.equal(
    fills(paint(text, { selection: { start: 2, end: 9, focused: true }, chrome: "flat" }).ops, PAINT_THEME.selection)
      .length,
    0,
  );
  assert.equal(
    fills(paint(text, { selection: { start: 2, end: 9, focused: false } }).ops, PAINT_THEME.selection).length,
    0,
  );
});

test("the caret is a bar at its cell, only when collapsed, focused, and on the page", () => {
  const caret = (text: string, at: number) =>
    fills(paint(text, { selection: { start: at, end: at, focused: true } }).ops, PAINT_THEME.ink).filter(
      (o) => o.op === "fillRect",
    );
  const [bar] = caret("abcdef", 3);
  assert.ok(bar);
  assert.ok(near(Number(bar.args[0]), cell(0, 3).x - K * 0.12));
  assert.equal(caret("abcdef", 3).length, 1);
  const tall = Array.from({ length: 70 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(caret(tall, tall.length).length, 0, "a caret past the page isn't drawn");
  assert.equal(
    fills(paint("abcdef", { selection: { start: 3, end: 3, focused: true }, chrome: "flat" }).ops, PAINT_THEME.ink)
      .length,
    0,
  );
});

test("overflow rows: painted into a hatched zone in flat rendering, left off the texture", () => {
  const text = Array.from({ length: 65 }, (_, i) => `row ${i + 1}`).join("\n");
  const flat = paint(text, { overflow: true, chrome: "flat" });
  assert.ok(flat.result.heightMm > PAPER_H, "the flat sheet grows to hold the extra rows");
  assert.equal(fills(flat.ops, PAINT_THEME.overflowWash).length, 1);
  const zoneTop = cell(T.rows, 0).y;
  assert.ok(fills(flat.ops, PAINT_THEME.overflowWash).every((o) => near(Number(o.args[1]), zoneTop)));
  assert.ok(flat.ops.some((o) => o.op === "fillText" && o.args[0] === "▼ 5 rows over the page"));
  assert.ok(
    flat.ops.some((o) => o.op === "fillText" && Number(o.args[2]) > zoneTop),
    "rows past the page are drawn",
  );

  const texture = paint(text);
  assert.equal(texture.result.heightMm, PAPER_H);
  assert.equal(fills(texture.ops, PAINT_THEME.overflowWash).length, 0);
  assert.ok(texture.ops.some((o) => o.op === "fillText" && o.args[0] === "▼ 5 rows over the page"));
  const lastPageRow = cell(T.rows, 0).y;
  assert.ok(
    !texture.ops.some((o) => o.op === "fillText" && String(o.args[0]).length === 1 && Number(o.args[2]) > lastPageRow),
    "no glyph below the page",
  );
});

test("a plane tints each cell by its value, skipping zeros, over the page's rows", () => {
  const text = "plane";
  const cols = T.cols;
  const rows = Math.max(T.rows, layoutRows(text, cols).length);
  const values = new Float32Array(rows * cols);
  values[0] = 1;
  values[cols + 3] = 0.5;
  values[(T.rows - 1) * cols + cols - 1] = 0.25;
  const { ops } = paint(text, {}, "ink", { values, cols });
  const tinted = ops.filter((o) => o.op === "fillRect" && o.fill.startsWith(`rgba(${PALETTE.model.rgb}`));
  assert.deepEqual(
    tinted.map((o) => o.fill),
    [heatFill(1), heatFill(0.5), heatFill(0.25)],
  );
  const [, second, third] = tinted;
  assert.ok(second && third);
  assert.ok(near(Number(second.args[0]), cell(1, 3).x) && near(Number(second.args[1]), cell(1, 3).y));
  assert.ok(near(Number(third.args[0]), cell(T.rows - 1, cols - 1).x));
});

test("lens styles: syntax characters in their color and weight, words dimmed", () => {
  const { ops } = paint('{"a": 1}', {}, "syntax");
  const drawn = ops.filter((o) => o.op === "fillText" && String(o.args[0]).length === 1);
  const brace = drawn.find((o) => o.args[0] === "{");
  const letter = drawn.find((o) => o.args[0] === "a");
  assert.equal(brace?.fill, PAINT_THEME.segments.syntax.color);
  assert.ok(brace?.font.startsWith("600 "));
  assert.equal(letter?.fill, PAINT_THEME.segments.dim.color);
  assert.ok(letter?.font.startsWith("400 "));
  assert.equal(fills(ops, PAINT_THEME.segments.syntax.background ?? "").length, 5, "syntax cells get a wash");
});

test("the Structure lens bands each line by its kind", () => {
  const text = "# Heading\n\nA sentence that carries a relationship between two things.\nkey: value";
  const { ops } = paint(text, {}, "structure");
  assert.equal(fills(ops, PAINT_THEME.bands.heading).length, 1);
  assert.equal(fills(ops, PAINT_THEME.bands.prose).length, 1);
  assert.equal(fills(ops, PAINT_THEME.bands.structured).length, 1);
});

test("the painter and the shadow CSS share the palette's colors", () => {
  assert.equal(PAINT_THEME.paper, PALETTE.paper);
  assert.equal(PAINT_THEME.ink, PALETTE.ink);
  assert.equal(PAINT_THEME.selection, PALETTE.selection);
  for (const color of [PALETTE.paper, PALETTE.ink, PALETTE.selection, PALETTE.faint]) {
    assert.ok(SHEET_STYLE.includes(color), `the shadow CSS uses ${color}`);
  }
});

test("print rows: page rows only, positioned on the grid", () => {
  const text = `${"x".repeat(170)}\n${Array.from({ length: 70 }, (_, i) => `line ${i}`).join("\n")}`;
  const out = printRows(layoutRows(text, T.cols), text, T);
  assert.equal(out.length, T.rows);
  assert.deepEqual(
    out.slice(0, 3).map((r) => r.text.length),
    [80, 80, 10],
  );
  assert.ok(Math.abs((out[1]?.topMm ?? 0) - (T.marginY + T.cellH)) < 1e-9);
});

test("model lens tint: none at 0, proportional, strongest at 1, clamped", () => {
  assert.equal(heatFill(0), null);
  assert.equal(heatFill(-1), null);
  assert.equal(heatFill(Number.NaN), null);
  const alpha = (fill: string | null) => Number(fill?.match(/, ([\d.]+)\)$/)?.[1]);
  assert.equal(alpha(heatFill(1)), HEAT_MAX_ALPHA);
  assert.equal(alpha(heatFill(2)), HEAT_MAX_ALPHA);
  assert.ok(Math.abs(alpha(heatFill(0.5)) - HEAT_MAX_ALPHA / 2) < 1e-4);
});
