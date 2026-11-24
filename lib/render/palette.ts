/**
 * The sheet's colors, in one place. The painter's theme (paint/theme.ts), the
 * element's shadow CSS (element/style.ts), and the model-lens swatches all
 * read them, so the canvas and the CSS can't drift. (refactor-styles also
 * writes them into the app's CSS custom properties.)
 */

export const PALETTE = {
  paper: "#fdfcf8",
  ink: "#1d1c1a",
  /** Placeholder text. */
  faint: "#a29d92",
  /** Rulers and row numbers. */
  ruler: "#b3ada0",
  /** Overflow: the line under the last row and the "rows over" label. */
  crit: "#b42318",
  /** Selected text, in the textarea (flat) and on the painted page (3D). */
  selection: "rgba(59, 130, 246, 0.28)",
  page: {
    grid: "rgba(59, 91, 140, 0.14)",
    overflowWash: "rgba(180, 35, 24, 0.06)",
    overflowHatch: "rgba(180, 35, 24, 0.12)",
    /** The margin ink gauge: a row over the page, a nearly full row, any other row. */
    gaugeOver: "rgba(180, 35, 24, 0.7)",
    gaugeFull: "rgba(29, 28, 26, 0.55)",
    gauge: "rgba(29, 28, 26, 0.3)",
  },
  lens: {
    /** Words the Syntax and Repetition lenses push back. */
    dim: "#8f8a80",
    syntax: "#c2410c",
    syntaxWash: "rgba(194, 65, 12, 0.08)",
    /** Repetition heat, coolest to hottest, and the ink on the hottest. */
    heat: [
      "rgba(253, 230, 138, 0.7)",
      "rgba(253, 186, 116, 0.75)",
      "rgba(251, 146, 60, 0.75)",
      "rgba(239, 68, 68, 0.6)",
    ],
    heatInk: "#3b0a07",
    tokenA: "rgba(191, 219, 254, 0.8)",
    tokenB: "rgba(253, 230, 138, 0.8)",
    /** Structure: each kind of line's ink and band. */
    prose: "#1f5a39",
    structured: "#8a3d06",
    heading: "#2d4a75",
    proseBand: "rgba(47, 122, 79, 0.09)",
    structuredBand: "rgba(180, 83, 9, 0.13)",
    headingBand: "rgba(59, 91, 140, 0.12)",
  },
  /** Model lenses: one violet whose opacity follows a cell's value. */
  model: { rgb: "109, 40, 217", maxAlpha: 0.5 },
} as const;
