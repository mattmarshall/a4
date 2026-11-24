/**
 * The text: one glyph per cell, so grid positions are exact, in the lens's
 * color and weight.
 */

import type { PaintFrame } from "./frame.ts";
import type { PageModel } from "./model.ts";
import type { Paint2D } from "./paint2d.ts";
import type { PaintTheme } from "./theme.ts";

export function paintGlyphs(ctx: Paint2D, model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  const { text, rows, styles } = model;
  const { fontPx, fontFamily, ch } = f;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `400 ${fontPx}px ${fontFamily}`;
  const m = ctx.measureText("Hg");
  const ascent = m.fontBoundingBoxAscent || fontPx * 1.025;
  const descent = m.fontBoundingBoxDescent || fontPx * 0.275;
  // CSS half-leading: the content area is centered in the line box.
  const baseline = (ch - (ascent + descent)) / 2 + ascent;
  let currentWeight = 400;
  for (let i = 0; i < f.rowsShown; i++) {
    const r = rows[i];
    if (!r) continue;
    const y = f.top + i * ch + baseline;
    for (let j = r.start; j < r.end; j++) {
      const c = text.charAt(j);
      if (c === " ") continue;
      const segment = styles[j];
      const style = segment ? theme.segments[segment] : undefined;
      const weight = style?.weight ?? 400;
      if (weight !== currentWeight) {
        ctx.font = `${weight} ${fontPx}px ${fontFamily}`;
        currentWeight = weight;
      }
      ctx.fillStyle = style?.color ?? theme.ink;
      ctx.fillText(c, f.left + (j - r.start) * f.cw, y);
    }
  }
}
