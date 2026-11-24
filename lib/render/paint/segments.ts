/** Lens backgrounds: each character's cell filled with its segment style's background. */

import type { PaintFrame } from "./frame.ts";
import type { PageModel } from "./model.ts";
import type { Paint2D } from "./paint2d.ts";
import type { PaintTheme } from "./theme.ts";

export function paintSegments(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  const { rows, styles } = model;
  for (let i = 0; i < f.rowsShown; i++) {
    const r = rows[i];
    if (!r) continue;
    for (let j = r.start; j < r.end; j++) {
      const style = styles[j];
      const bg = style ? theme.segments[style].background : undefined;
      if (!bg) continue;
      ctx.fillStyle = bg;
      ctx.fillRect(f.left + (j - r.start) * f.cw, f.top + i * f.ch, f.cw, f.ch);
    }
  }
}
