/**
 * The quantized A4 page.
 *
 * Geometry is defined once, in millimeters, and reused for screen rendering
 * (scaled by a px-per-mm factor), metrics, and print (1 mm = 1 mm).
 * Columns and rows are derived: the whole number of cells that fit inside the
 * preset's minimum margins. The resulting grid is centered on the sheet.
 */

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/** CSS pixels per millimeter at 96 dpi ("actual size"). */
export const PX_PER_MM_ACTUAL = 96 / 25.4;

/** IBM Plex Mono's advance width is 600/1000 em. */
export const GLYPH_ADVANCE_EM = 0.6;

/** The presets, in menu order. Every other preset table is keyed by these. */
export const PRESET_ORDER = ["terminal", "pica", "elite", "dense"] as const;

export type PresetId = (typeof PRESET_ORDER)[number];

export interface PageSpec {
  id: PresetId;
  name: string;
  blurb: string;
  /** Cell width in mm (one character advance). */
  cellW: number;
  /** Cell height in mm (one line pitch). */
  cellH: number;
  cols: number;
  rows: number;
  /** Left/right margin in mm after centering the grid. */
  marginX: number;
  /** Top/bottom margin in mm after centering the grid. */
  marginY: number;
}

const INCH = 25.4;

function derive(
  id: PresetId,
  name: string,
  blurb: string,
  cellW: number,
  cellH: number,
  minMarginX: number,
  minMarginY: number,
): PageSpec {
  // A small epsilon keeps exact fits (e.g. 178 / 2.225 = 80) from flooring to 79.
  const cols = Math.floor((A4_WIDTH_MM - 2 * minMarginX) / cellW + 1e-9);
  const rows = Math.floor((A4_HEIGHT_MM - 2 * minMarginY) / cellH + 1e-9);
  return {
    id,
    name,
    blurb,
    cellW,
    cellH,
    cols,
    rows,
    marginX: (A4_WIDTH_MM - cols * cellW) / 2,
    marginY: (A4_HEIGHT_MM - rows * cellH) / 2,
  };
}

export const PRESETS = {
  terminal: derive(
    "terminal",
    "Terminal",
    "80 × 60, the canonical A4 context page (≈10.5 pt mono)",
    2.225,
    4.45,
    16,
    15,
  ),
  pica: derive("pica", "Pica", "Typewriter 10 cpi × 6 lpi, 1 in margins", INCH / 10, INCH / 6, INCH, INCH),
  elite: derive("elite", "Elite", "Typewriter 12 cpi × 6 lpi, 1 in margins", INCH / 12, INCH / 6, INCH, INCH),
  dense: derive("dense", "Dense", "100 × 80 fine print (≈8.5 pt mono)", 1.8, 3.5, 15, 8.5),
} as const satisfies Readonly<Record<PresetId, PageSpec>>;

export const DEFAULT_PRESET: PresetId = "terminal";

export function isPresetId(value: unknown): value is PresetId {
  // Own keys only: "toString" or "constructor" are not presets.
  return typeof value === "string" && Object.hasOwn(PRESETS, value);
}

export function capacity(spec: PageSpec): number {
  return spec.cols * spec.rows;
}

/** Estimated token ceiling: one token per four cells, rounded down. */
export function tokenCeiling(spec: PageSpec): number {
  return Math.floor(capacity(spec) / 4);
}

/** Font size in mm that makes one glyph advance exactly one cell. */
export function fontSizeMm(spec: PageSpec): number {
  return spec.cellW / GLYPH_ADVANCE_EM;
}

/** Point size equivalent, for display. */
export function fontSizePt(spec: PageSpec): number {
  return (fontSizeMm(spec) / INCH) * 72;
}
