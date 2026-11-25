/**
 * The page: A4 and its presets (spec), the text-to-rows layout, the
 * cell-unit contract (chars), and the paper geometry every view shares.
 * Depends on nothing else in lib/.
 */

export { assertNever } from "./assert-never.ts";
export { countInk } from "./chars.ts";
export {
  cellAt,
  fitScale,
  fontSizeMm,
  fontSizePt,
  PAPER_H,
  PAPER_W,
  PIXEL_RATIO_CAP,
  pixelRatio,
  PX_PER_MM_ACTUAL,
  rowTop,
  textureDensity,
  type FitOptions,
} from "./geometry.ts";
export {
  layoutRows,
  normalizeText,
  pageFit,
  rowsUsed,
  TAB_SPACES,
  type PageFit,
  type VisualRow,
} from "./layout.ts";
export {
  capacity,
  DEFAULT_PRESET,
  isLensId,
  isPresetId,
  LENS_IDS,
  PRESET_IDS,
  PRESETS,
  tokenCeiling,
  type LensId,
  type PageSpec,
  type PresetId,
} from "./spec.ts";
