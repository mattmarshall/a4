/** The paper: a cleared canvas with the sheet filled in (the overflow zone below it stays clear). */

import { PAPER_H } from "../../page/index.ts";
import type { PaintFrame } from "./frame.ts";
import type { PageModel } from "./model.ts";
import type { Paint2D } from "./paint2d.ts";
import type { PaintTheme } from "./theme.ts";

export function paintPaper(ctx: Paint2D, _model: PageModel, theme: PaintTheme, f: PaintFrame): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, f.width, f.height);
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, f.width, Math.round(PAPER_H * f.k));
}
