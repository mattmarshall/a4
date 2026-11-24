/**
 * The painter's colors by role, from the shared palette. Layers take a
 * `PaintTheme`, so a test or a future theme can pass its own.
 */

import type { LineKind, SegmentStyle } from "../../analysis/index.ts";
import { PALETTE } from "../palette.ts";
import { heatFill } from "./heat.ts";

/** How one character is painted under a lens. Unset fields mean ink, no background, weight 400. */
export interface CellStyle {
  readonly color?: string;
  readonly background?: string;
  readonly weight?: number;
}

export interface PaintTheme {
  readonly paper: string;
  readonly ink: string;
  readonly ruler: string;
  readonly crit: string;
  readonly selection: string;
  readonly grid: string;
  readonly overflowWash: string;
  readonly overflowHatch: string;
  readonly gauge: { readonly over: string; readonly full: string; readonly normal: string };
  /** Every segment style's paint. */
  readonly segments: Readonly<Record<SegmentStyle, CellStyle>>;
  /** The Structure lens's band behind each kind of line. */
  readonly bands: Readonly<Record<Exclude<LineKind, "blank">, string>>;
  /** A model lens's fill for a cell value in [0, 1], or null for none. */
  readonly plane: (value: number) => string | null;
}

const { lens, page } = PALETTE;

export const PAINT_THEME: PaintTheme = {
  paper: PALETTE.paper,
  ink: PALETTE.ink,
  ruler: PALETTE.ruler,
  crit: PALETTE.crit,
  selection: PALETTE.selection,
  grid: page.grid,
  overflowWash: page.overflowWash,
  overflowHatch: page.overflowHatch,
  gauge: { over: page.gaugeOver, full: page.gaugeFull, normal: page.gauge },
  segments: {
    dim: { color: lens.dim },
    syntax: { color: lens.syntax, background: lens.syntaxWash, weight: 600 },
    "heat-1": { background: lens.heat[0] },
    "heat-2": { background: lens.heat[1] },
    "heat-3": { background: lens.heat[2] },
    "heat-4": { background: lens.heat[3], color: lens.heatInk },
    "token-a": { background: lens.tokenA },
    "token-b": { background: lens.tokenB },
    prose: { color: lens.prose },
    structured: { color: lens.structured },
    heading: { color: lens.heading, weight: 600 },
  },
  bands: { prose: lens.proseBand, structured: lens.structuredBand, heading: lens.headingBand },
  plane: heatFill,
};
