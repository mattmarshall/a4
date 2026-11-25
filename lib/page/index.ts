/**
 * The page: its presets and paper sizes down the fold ladder (spec), the text-to-rows layout, the
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
  PAPER_IDS,
  PAPER_SIZES,
  PIXEL_RATIO_CAP,
  pixelRatio,
  PX_PER_MM_ACTUAL,
  rowTop,
  textureDensity,
  type FitOptions,
  type PaperId,
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
  DEFAULT_PAPER,
  DEFAULT_PRESET,
  isLensId,
  isPaperId,
  isPresetId,
  LENS_IDS,
  pageSpec,
  PRESET_IDS,
  PRESETS,
  sizeOfName,
  tokenCeiling,
  type LensId,
  type PageSpec,
  type PresetId,
} from "./spec.ts";
