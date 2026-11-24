/**
 * Overflow: in flat rendering, a hatched zone holds the rows past the page;
 * on every rendering, a label says how many rows are over.
 */

import type { PaintFrame } from "./frame.ts";
import type { PageModel } from "./model.ts";
import type { Paint2D } from "./paint2d.ts";
import type { PaintTheme } from "./theme.ts";

/** The hatched zone from the page's last row down, when overflow rows are painted. */
export function paintOverflowZone(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  const { spec } = model;
  if (!f.overflow || model.rows.length <= spec.rows) return;
  const { width, height, k } = f;
  const zoneTop = f.top + spec.rows * f.ch;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, zoneTop, width, height - zoneTop);
  ctx.clip();
  ctx.fillStyle = theme.overflowWash;
  ctx.fillRect(0, zoneTop, width, height - zoneTop);
  ctx.strokeStyle = theme.overflowHatch;
  ctx.lineWidth = 1.5 * k;
  for (let x = -height; x < width; x += 3 * k) {
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x + (height - zoneTop), zoneTop);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = theme.crit;
  ctx.fillRect(0, zoneTop, width, Math.max(1, 0.4 * k));
}

/** "▼ N rows over the page": above the zone when it's painted, else in the bottom margin. */
export function paintOverflowLabel(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  const { spec, overflow } = model;
  if (overflow <= 0) return;
  const { k, top, ch } = f;
  ctx.fillStyle = theme.crit;
  ctx.font = `600 ${2.6 * k}px ${f.fontFamily}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const label = `▼ ${overflow} ${overflow === 1 ? "row" : "rows"} over the page`;
  const y = f.overflow ? top + spec.rows * ch - 1.6 * k : top + spec.rows * ch + (spec.marginY * k) / 2;
  ctx.fillText(label, f.left + spec.cols * f.cw, y);
}
