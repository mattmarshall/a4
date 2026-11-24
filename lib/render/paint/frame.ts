/**
 * One paint of a page: the settings it was asked for (scale, font, selection,
 * grid, chrome) and the geometry derived from them, computed once and shared
 * by every layer.
 */

import { fontSizeMm, PAPER_H, PAPER_W, rowTop, type PageSpec } from "../../page/index.ts";
import type { PageModel } from "./model.ts";

export interface PaintSettings {
  /** CSS font-family list for the page font. */
  readonly fontFamily: string;
  /** Canvas pixels per millimeter. */
  readonly pxPerMm: number;
  readonly selection: { readonly start: number; readonly end: number; readonly focused: boolean };
  /** Paint rows past the page into an overflow zone below the paper (flat rendering). */
  readonly overflow: boolean;
  /** Draw the cell grid. */
  readonly grid: boolean;
  /**
   * "texture": the painter draws the caret and selection (3D).
   * "flat": a native textarea draws them, so the painter doesn't.
   */
  readonly chrome: "texture" | "flat";
}

export interface PaintFrame extends PaintSettings {
  /** Height in mm of the painted surface. */
  readonly heightMm: number;
  /** The canvas size in pixels. */
  readonly width: number;
  readonly height: number;
  /** Pixels per mm (`pxPerMm`), and one cell's width and height in pixels. */
  readonly k: number;
  readonly cw: number;
  readonly ch: number;
  /** The grid's top-left corner in pixels. */
  readonly left: number;
  readonly top: number;
  /** Rows painted: the page's, plus overflow rows when `overflow` is set. */
  readonly rowsShown: number;
  /** The page font's size in pixels. */
  readonly fontPx: number;
}

/** Height in mm of the painted surface (taller than A4 when overflow rows are painted). */
function paintedHeightMm(spec: PageSpec, rowsTotal: number, overflow: boolean): number {
  if (!overflow || rowsTotal <= spec.rows) return PAPER_H;
  return Math.max(PAPER_H, rowTop(spec, rowsTotal) + 10);
}

function textureSize(pxPerMm: number, heightMm: number = PAPER_H): { width: number; height: number } {
  return { width: Math.round(PAPER_W * pxPerMm), height: Math.round(heightMm * pxPerMm) };
}

export function paintFrame(model: PageModel, settings: PaintSettings): PaintFrame {
  const { spec, rows } = model;
  const k = settings.pxPerMm;
  const heightMm = paintedHeightMm(spec, rows.length, settings.overflow);
  const { width, height } = textureSize(k, heightMm);
  return {
    ...settings,
    heightMm,
    width,
    height,
    k,
    cw: spec.cellW * k,
    ch: spec.cellH * k,
    left: spec.marginX * k,
    top: spec.marginY * k,
    rowsShown: settings.overflow ? rows.length : Math.min(spec.rows, rows.length),
    fontPx: fontSizeMm(spec) * k,
  };
}
