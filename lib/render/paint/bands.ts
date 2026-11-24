/** Whole-cell tints under the text: the Structure lens's line bands, and a model plane's cells. */

import type { PaintFrame } from "./frame.ts";
import type { PageModel } from "./model.ts";
import type { Paint2D } from "./paint2d.ts";
import type { PaintTheme } from "./theme.ts";

/** The Structure lens: a band behind each prose, structured, or heading row. */
export function paintBands(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  if (model.lens !== "structure") return;
  const { spec, rows, lineKinds } = model;
  for (let i = 0; i < f.rowsShown; i++) {
    const row = rows[i];
    const kind = row ? lineKinds[row.line] : undefined;
    if (kind === undefined || kind === "blank") continue;
    ctx.fillStyle = theme.bands[kind];
    ctx.fillRect(f.left, f.top + i * f.ch, spec.cols * f.cw, f.ch);
  }
}

/**
 * A model plane: each cell tinted by its value. A plane covers the whole grid,
 * not just rows that hold text, so every painted row is tinted (the page,
 * plus overflow rows when they are painted).
 */
export function paintPlane(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  const { plane, spec } = model;
  if (!plane) return;
  const { values, cols } = plane;
  const planeRows = Math.min(
    Math.floor(values.length / cols),
    f.overflow ? Math.max(spec.rows, f.rowsShown) : spec.rows,
  );
  for (let i = 0; i < planeRows; i++) {
    for (let c = 0; c < Math.min(cols, spec.cols); c++) {
      const fill = theme.plane(values[i * cols + c] ?? 0);
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(f.left + c * f.cw, f.top + i * f.ch, f.cw, f.ch);
    }
  }
}
