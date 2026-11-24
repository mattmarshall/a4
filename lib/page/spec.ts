/**
 * The quantized A4 page: the presets and their grids.
 *
 * Columns and rows are derived: the whole number of cells that fit inside the
 * preset's minimum margins. The resulting grid is centered on the sheet (see
 * geometry.ts for the paper and the mm ↔ cell conversions).
 */

import { MM_PER_INCH as INCH, PAPER_H, PAPER_W, type CellGrid } from "./geometry.ts";

/** The presets, in menu order. Every other preset table is keyed by these. */
export const PRESET_IDS = ["terminal", "pica", "elite", "dense"] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface PageSpec extends CellGrid {
  readonly id: PresetId;
  readonly name: string;
  readonly blurb: string;
}

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
  const cols = Math.floor((PAPER_W - 2 * minMarginX) / cellW + 1e-9);
  const rows = Math.floor((PAPER_H - 2 * minMarginY) / cellH + 1e-9);
  return {
    id,
    name,
    blurb,
    cellW,
    cellH,
    cols,
    rows,
    marginX: (PAPER_W - cols * cellW) / 2,
    marginY: (PAPER_H - rows * cellH) / 2,
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

/**
 * The lenses, in the order the top bar shows them: how the sheet colors its
 * cells. Their names and painting are in lib/analysis/lenses.ts; the ids are
 * here so settings and the element can name a lens without the analysis.
 */
export const LENS_IDS = ["ink", "syntax", "repetition", "structure", "tokens"] as const;

export type LensId = (typeof LENS_IDS)[number];

export function isLensId(value: unknown): value is LensId {
  return typeof value === "string" && (LENS_IDS as readonly string[]).includes(value);
}

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
