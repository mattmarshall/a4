/**
 * The quantized page: the presets, the paper sizes, and their grids.
 *
 * Columns and rows are derived: the whole number of cells that fit inside the
 * preset's minimum margins. The resulting grid is centered on the sheet (see
 * geometry.ts for the paper and the mm ↔ cell conversions). The preset is the
 * typeface; the paper is the size. Down the fold ladder (A4, A5, A6) cells
 * keep their size, so text reads at the same point size, and the margins
 * shrink with the paper.
 */

import { MM_PER_INCH as INCH, PAPER_IDS, PAPER_SIZES, type CellGrid, type PaperId } from "./geometry.ts";

/** The presets, in menu order. Every other preset table is keyed by these. */
export const PRESET_IDS = ["terminal", "pica", "elite", "dense"] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface PageSpec extends CellGrid {
  readonly id: PresetId;
  readonly paper: PaperId;
  readonly name: string;
  readonly blurb: string;
}

interface PresetDef {
  readonly name: string;
  readonly blurb: string;
  readonly cellW: number;
  readonly cellH: number;
  /** Minimum margins on A4, in mm; smaller papers scale them by their width. */
  readonly minMarginX: number;
  readonly minMarginY: number;
}

const DEFS: Readonly<Record<PresetId, PresetDef>> = {
  terminal: {
    name: "Terminal",
    blurb: "80 × 60, the canonical A4 context page (≈10.5 pt mono)",
    cellW: 2.225,
    cellH: 4.45,
    minMarginX: 16,
    minMarginY: 15,
  },
  pica: {
    name: "Pica",
    blurb: "Typewriter 10 cpi × 6 lpi, 1 in margins",
    cellW: INCH / 10,
    cellH: INCH / 6,
    minMarginX: INCH,
    minMarginY: INCH,
  },
  elite: {
    name: "Elite",
    blurb: "Typewriter 12 cpi × 6 lpi, 1 in margins",
    cellW: INCH / 12,
    cellH: INCH / 6,
    minMarginX: INCH,
    minMarginY: INCH,
  },
  dense: {
    name: "Dense",
    blurb: "100 × 80 fine print (≈8.5 pt mono)",
    cellW: 1.8,
    cellH: 3.5,
    minMarginX: 15,
    minMarginY: 8.5,
  },
};

function derive(id: PresetId, paper: PaperId): PageSpec {
  const { name, blurb, cellW, cellH } = DEFS[id];
  const { w: paperW, h: paperH } = PAPER_SIZES[paper];
  // Each fold scales the margins with the paper (A5 by 148/210, A6 by 1/2).
  const scale = paperW / PAPER_SIZES.a4.w;
  const minMarginX = DEFS[id].minMarginX * scale;
  const minMarginY = DEFS[id].minMarginY * scale;
  // A small epsilon keeps exact fits (e.g. 178 / 2.225 = 80) from flooring to 79.
  const cols = Math.floor((paperW - 2 * minMarginX) / cellW + 1e-9);
  const rows = Math.floor((paperH - 2 * minMarginY) / cellH + 1e-9);
  return {
    id,
    paper,
    name,
    blurb,
    paperW,
    paperH,
    cellW,
    cellH,
    cols,
    rows,
    marginX: (paperW - cols * cellW) / 2,
    marginY: (paperH - rows * cellH) / 2,
  };
}

const SPECS = new Map<string, PageSpec>();

/** The page spec for a preset on a paper size. The same object every time, so specs compare by identity. */
export function pageSpec(id: PresetId, paper: PaperId): PageSpec {
  const key = `${id}/${paper}`;
  let spec = SPECS.get(key);
  if (!spec) {
    spec = derive(id, paper);
    SPECS.set(key, spec);
  }
  return spec;
}

/** The presets on A4: the canonical pages, and the preset menu's entries. */
export const PRESETS = {
  terminal: pageSpec("terminal", "a4"),
  pica: pageSpec("pica", "a4"),
  elite: pageSpec("elite", "a4"),
  dense: pageSpec("dense", "a4"),
} as const satisfies Readonly<Record<PresetId, PageSpec>>;

export const DEFAULT_PAPER: PaperId = "a4";

export function isPaperId(value: unknown): value is PaperId {
  return typeof value === "string" && (PAPER_IDS as readonly string[]).includes(value);
}

const SIZED_NAME = /\.(a5|a6)$/i;

/**
 * A page's size, from its name: a name that ends in `.a5` or `.a6` before its
 * `.md` or `.mdc` extension (in any case) is that size, and every other name
 * is A4. Folder paths and library page names follow the same rule.
 */
export function sizeOfName(name: string): PaperId {
  const stem = name.replace(/\.mdc?$/i, "");
  const size = SIZED_NAME.exec(stem)?.[1]?.toLowerCase();
  if (size === "a5" || size === "a6") return size;
  return "a4";
}

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
