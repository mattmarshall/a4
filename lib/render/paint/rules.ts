/** The page's furniture: the cell grid, the rulers and row numbers, and the margin ink gauge. */

import type { PaintFrame } from "./frame.ts";
import type { PageModel } from "./model.ts";
import type { Paint2D } from "./paint2d.ts";
import type { PaintTheme } from "./theme.ts";

/** The cell grid over the page's rows, when asked for. */
export function paintGrid(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  if (!f.grid) return;
  const { spec } = model;
  const { left, top, cw, ch } = f;
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = Math.max(1, 0.08 * f.k);
  ctx.beginPath();
  for (let c = 0; c <= spec.cols; c++) {
    ctx.moveTo(left + c * cw, top);
    ctx.lineTo(left + c * cw, top + spec.rows * ch);
  }
  for (let r = 0; r <= spec.rows; r++) {
    ctx.moveTo(left, top + r * ch);
    ctx.lineTo(left + spec.cols * cw, top + r * ch);
  }
  ctx.stroke();
}

/** Column ticks every 5 (numbered every 10) and row numbers 1, 5, 10, …. */
export function paintRulers(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  const { spec } = model;
  const { k, left, top, cw, ch } = f;
  ctx.fillStyle = theme.ruler;
  ctx.font = `400 ${2.1 * k}px ${f.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (let c = 5; c <= spec.cols; c += 5) {
    const x = left + (c - 0.5) * cw;
    const major = c % 10 === 0;
    ctx.fillRect(x - k * 0.13, top - 0.5 * k - (major ? 1.8 : 1) * k, Math.max(1, k * 0.26), (major ? 1.8 : 1) * k);
    if (major) ctx.fillText(String(c), x, top - 0.5 * k - 2.1 * k);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const r of [1, ...Array.from({ length: Math.floor(spec.rows / 5) }, (_, i) => (i + 1) * 5)]) {
    ctx.fillText(String(r), left - 2 * k, top + (r - 0.5) * ch);
  }
}

/** A gauge bar's fill: red past the page, darker when the row is nearly full. */
function gaugeFill(theme: PaintTheme, overPage: boolean, frac: number): string {
  if (overPage) return theme.gauge.over;
  return frac >= 0.85 ? theme.gauge.full : theme.gauge.normal;
}

/** A bar in the right margin per row, as long as the row's ink. */
export function paintInkGauge(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  const { spec, rows } = model;
  const { k, top, ch } = f;
  const gaugeX = f.left + spec.cols * f.cw + 2 * k;
  const gaugeW = Math.min(10, spec.marginX - 4) * k;
  for (let i = 0; i < f.rowsShown; i++) {
    const row = rows[i];
    if (!row || row.ink === 0) continue;
    const frac = Math.min(1, row.ink / spec.cols);
    ctx.fillStyle = gaugeFill(theme, i >= spec.rows, frac);
    ctx.fillRect(gaugeX, top + i * ch + ch * 0.29, gaugeW * frac, ch * 0.42);
  }
}
