/**
 * The selection and the caret, painted only on the 3D texture: in flat
 * rendering the native textarea draws its own.
 */

import { offsetToCell } from "../../tensor/cells.ts";
import type { PaintFrame } from "./frame.ts";
import type { PageModel } from "./model.ts";
import type { Paint2D } from "./paint2d.ts";
import type { PaintTheme } from "./theme.ts";

/** The selected cells of each painted row. */
export function paintSelection(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  const { start, end, focused } = f.selection;
  if (f.chrome !== "texture" || !focused || end <= start) return;
  ctx.fillStyle = theme.selection;
  for (let i = 0; i < f.rowsShown; i++) {
    const r = model.rows[i];
    if (!r) continue;
    const a = Math.max(start, r.start);
    const b = Math.min(end, r.end);
    if (b > a) ctx.fillRect(f.left + (a - r.start) * f.cw, f.top + i * f.ch, (b - a) * f.cw, f.ch);
  }
}

/** A thin bar at the caret, when it's on the page. */
export function paintCaret(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  const { start, end, focused } = f.selection;
  if (f.chrome !== "texture" || !focused || start !== end) return;
  const cell = offsetToCell(model.rows, start);
  if (!cell || cell.row >= model.spec.rows) return;
  const { k, cw, ch } = f;
  ctx.fillStyle = theme.ink;
  ctx.fillRect(f.left + cell.col * cw - k * 0.12, f.top + cell.row * ch + ch * 0.1, Math.max(1, k * 0.28), ch * 0.8);
}
