/**
 * Paper geometry: the A4 sheet in millimeters, the cell grid on it, and the
 * conversions every view shares (the flat sheet, 3D picking, print, and the
 * Workbench zoom). Millimeters are the unit throughout: screens scale them by
 * a px-per-mm factor, and print uses them as they are.
 */

/** A4 paper width, in mm. */
export const PAPER_W = 210;
/** A4 paper height, in mm. */
export const PAPER_H = 297;

export const MM_PER_INCH = 25.4;

/** CSS pixels per millimeter at 96 dpi ("actual size"). */
export const PX_PER_MM_ACTUAL = 96 / MM_PER_INCH;

/** IBM Plex Mono's advance width is 600/1000 em. */
export const GLYPH_ADVANCE_EM = 0.6;

/** A grid of equal cells, centered on the sheet. Sizes are in mm. */
export interface CellGrid {
  /** Cell width (one character advance). */
  readonly cellW: number;
  /** Cell height (one line pitch). */
  readonly cellH: number;
  readonly cols: number;
  readonly rows: number;
  /** Left and right margin, after centering the grid. */
  readonly marginX: number;
  /** Top and bottom margin, after centering the grid. */
  readonly marginY: number;
}

/** Font size in mm that makes one glyph advance exactly one cell. */
export function fontSizeMm(grid: Pick<CellGrid, "cellW">): number {
  return grid.cellW / GLYPH_ADVANCE_EM;
}

/** Point size equivalent, for display. */
export function fontSizePt(grid: Pick<CellGrid, "cellW">): number {
  return (fontSizeMm(grid) / MM_PER_INCH) * 72;
}

/** Top of grid row `row`, in mm from the paper's top. Rows past the page continue below it. */
export function rowTop(grid: CellGrid, row: number): number {
  return grid.marginY + row * grid.cellH;
}

/** The rectangle of cell (row, col), in mm from the paper's top-left corner. */
export function cellRect(grid: CellGrid, row: number, col: number): { x: number; y: number; w: number; h: number } {
  return { x: grid.marginX + col * grid.cellW, y: rowTop(grid, row), w: grid.cellW, h: grid.cellH };
}

/** The grid cell under paper point (x, y) mm, or null in the margins. */
export function cellAt(x: number, y: number, grid: CellGrid): { row: number; col: number } | null {
  const col = Math.floor((x - grid.marginX) / grid.cellW);
  const row = Math.floor((y - grid.marginY) / grid.cellH);
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return null;
  return { row, col };
}

export interface FitOptions {
  /** Sheets side by side. */
  pages?: number;
  /** CSS px between the sheets. */
  gap?: number;
  /** The smallest scale returned, in CSS px per mm. */
  min?: number;
}

/**
 * CSS px per mm that fits `pages` sheets side by side in `box` (CSS px):
 * never above actual size, never below `min`. Without a height, only the width
 * limits the scale; with no width yet (not laid out), it's actual size.
 */
export function fitScale(box: { width: number; height?: number }, options: FitOptions = {}): number {
  const { pages = 1, gap = 0, min = 1 } = options;
  if (!box.width) return PX_PER_MM_ACTUAL;
  const byWidth = (box.width - gap * (pages - 1)) / (PAPER_W * pages);
  const byHeight = box.height === undefined ? Number.POSITIVE_INFINITY : box.height / PAPER_H;
  return Math.max(min, Math.min(PX_PER_MM_ACTUAL, byWidth, byHeight));
}

/**
 * The largest device pixel ratio each canvas uses: past it, a bigger backing
 * store costs memory without a visible gain. The GPU canvas redraws every
 * frame, so it stops lower than the flat sheet.
 */
export const PIXEL_RATIO_CAP = { gpu: 2, flat: 3 } as const;

/** The device pixel ratio a canvas should use, under `cap`. */
export function pixelRatio(devicePixelRatio: number | undefined, cap: number): number {
  return Math.min(cap, devicePixelRatio || 1);
}

/**
 * Pixels per mm for the 3D sheet's texture, from the canvas's height in device
 * pixels: a little sharper than the sheet appears, between 5 and 10.
 */
export function textureDensity(heightPx: number): number {
  return Math.min(10, Math.max(5, Math.ceil((heightPx / PAPER_H) * 1.3)));
}
