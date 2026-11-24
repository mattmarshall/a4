/**
 * Paint a page into a 2D canvas: the 3D sheet's texture, or in flat rendering
 * the visible sheet under a transparent textarea. Each layer is a function of
 * (context, model, theme, frame); they paint in this order.
 */

import { paintBands, paintPlane } from "./bands.ts";
import { paintFrame, type PaintSettings } from "./frame.ts";
import { paintGlyphs } from "./glyphs.ts";
import type { PageModel } from "./model.ts";
import { paintOverflowLabel, paintOverflowZone } from "./overflow.ts";
import type { PaintSurface } from "./paint2d.ts";
import { paintPaper } from "./paper.ts";
import { paintGrid, paintInkGauge, paintRulers } from "./rules.ts";
import { paintSegments } from "./segments.ts";
import { paintCaret, paintSelection } from "./selection.ts";
import { PAINT_THEME, type PaintTheme } from "./theme.ts";

const LAYERS = [
  paintPaper,
  paintOverflowZone,
  paintGrid,
  paintBands,
  paintPlane,
  paintSelection,
  paintSegments,
  paintGlyphs,
  paintCaret,
  paintRulers,
  paintInkGauge,
  paintOverflowLabel,
] as const;

/** Size `canvas` for the page and paint every layer. Returns the painted height in mm. */
export function paintPage(
  canvas: PaintSurface,
  model: PageModel,
  settings: PaintSettings,
  theme: PaintTheme = PAINT_THEME,
): { heightMm: number } {
  const frame = paintFrame(model, settings);
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { heightMm: frame.heightMm };
  for (const layer of LAYERS) layer(ctx, model, theme, frame);
  return { heightMm: frame.heightMm };
}
