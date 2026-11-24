/**
 * Paint a page from A4's own model (grid geometry, visual rows, lens segments)
 * into a 2D canvas. Used both as the 3D sheet's texture and, in flat
 * rendering, as the visible sheet under a transparent textarea. Characters are
 * placed per cell, so grid positions are exact.
 */

import { segmentsFor, type Analysis, type LineKind, type SegmentStyle } from "../../analysis/index.ts";
import { fontSizeMm, PAPER_H, PAPER_W, rowTop, type LensId, type PageSpec, type VisualRow } from "../../page/index.ts";
import { caretCell } from "./pick.ts";

interface CellStyle {
  color?: string;
  background?: string;
  weight?: number;
}

/** Every segment style's paint. Mirrors the lens colors of the original DOM sheet. */
const SEGMENT_STYLE: Readonly<Record<SegmentStyle, CellStyle>> = {
  dim: { color: "#8f8a80" },
  syntax: { color: "#c2410c", background: "rgba(194, 65, 12, 0.08)", weight: 600 },
  "heat-1": { background: "rgba(253, 230, 138, 0.7)" },
  "heat-2": { background: "rgba(253, 186, 116, 0.75)" },
  "heat-3": { background: "rgba(251, 146, 60, 0.75)" },
  "heat-4": { background: "rgba(239, 68, 68, 0.6)", color: "#3b0a07" },
  "token-a": { background: "rgba(191, 219, 254, 0.8)" },
  "token-b": { background: "rgba(253, 230, 138, 0.8)" },
  prose: { color: "#1f5a39" },
  structured: { color: "#8a3d06" },
  heading: { color: "#2d4a75", weight: 600 },
};

/** The Structure lens's band behind each kind of line. */
const BAND: Readonly<Record<Exclude<LineKind, "blank">, string>> = {
  prose: "rgba(47, 122, 79, 0.09)",
  structured: "rgba(180, 83, 9, 0.13)",
  heading: "rgba(59, 91, 140, 0.12)",
};

const INK = "#1d1c1a";
const PAPER = "#fdfcf8";
const RULER = "#b3ada0";
const CRIT = "#b42318";

export interface PaintOptions {
  text: string;
  spec: PageSpec;
  analysis: Analysis;
  lens: LensId;
  /** CSS font-family list for the page font. */
  fontFamily: string;
  pxPerMm: number;
  selection: { start: number; end: number; focused: boolean };
  /** Paint rows past the page into an overflow zone below the paper (flat rendering). */
  overflow?: boolean;
  /** Draw the cell grid. */
  grid?: boolean;
  /**
   * "texture": the painter draws caret and selection (3D).
   * "flat": a native textarea draws them, so the painter doesn't.
   */
  chrome?: "texture" | "flat";
  /**
   * A model lens: one value in [0, 1] per cell of the page's grid (row-major,
   * `cols` wide). Each cell is tinted in proportion to its value.
   */
  heat?: { values: Float32Array; cols: number } | undefined;
}

// Model-lens tint; shared with the UI's swatches, so it lives in its own module.
export { HEAT_MAX_ALPHA, HEAT_RGB, heatFill } from "./heat.ts";
import { heatFill } from "./heat.ts";

/** Height in mm of the painted surface (taller than A4 when overflow rows are painted). */
export function paintedHeightMm(spec: PageSpec, rowsTotal: number, overflow: boolean): number {
  if (!overflow || rowsTotal <= spec.rows) return PAPER_H;
  return Math.max(PAPER_H, rowTop(spec, rowsTotal) + 10);
}

export function textureSize(pxPerMm: number, heightMm: number = PAPER_H): { width: number; height: number } {
  return { width: Math.round(PAPER_W * pxPerMm), height: Math.round(heightMm * pxPerMm) };
}

/** Rows to print: the page's visual rows (no overflow), as top offsets in mm. */
export function printRows(rows: readonly VisualRow[], text: string, spec: PageSpec): { topMm: number; text: string }[] {
  return rows.slice(0, spec.rows).map((r, i) => ({ topMm: rowTop(spec, i), text: text.slice(r.start, r.end) }));
}

export function paintPage(canvas: HTMLCanvasElement | OffscreenCanvas, o: PaintOptions): { heightMm: number } {
  const { spec, analysis, text, pxPerMm: k } = o;
  const chrome = o.chrome ?? "texture";
  const heightMm = paintedHeightMm(spec, analysis.metrics.rowsTotal, o.overflow ?? false);
  const { width, height } = textureSize(k, heightMm);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return { heightMm };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, Math.round(PAPER_H * k));

  const cw = spec.cellW * k;
  const ch = spec.cellH * k;
  const left = spec.marginX * k;
  const top = spec.marginY * k;
  const rowsShown = o.overflow ? analysis.layout.rows.length : Math.min(spec.rows, analysis.layout.rows.length);

  // Overflow zone (flat rendering): hatched, from the page's last row down.
  if (o.overflow && analysis.metrics.rowsTotal > spec.rows) {
    const zoneTop = top + spec.rows * ch;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, zoneTop, width, height - zoneTop);
    ctx.clip();
    ctx.fillStyle = "rgba(180, 35, 24, 0.06)";
    ctx.fillRect(0, zoneTop, width, height - zoneTop);
    ctx.strokeStyle = "rgba(180, 35, 24, 0.12)";
    ctx.lineWidth = 1.5 * k;
    for (let x = -height; x < width; x += 3 * k) {
      ctx.beginPath();
      ctx.moveTo(x, height);
      ctx.lineTo(x + (height - zoneTop), zoneTop);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = CRIT;
    ctx.fillRect(0, zoneTop, width, Math.max(1, 0.4 * k));
  }

  if (o.grid) {
    ctx.strokeStyle = "rgba(59, 91, 140, 0.14)";
    ctx.lineWidth = Math.max(1, 0.08 * k);
    ctx.beginPath();
    for (let c = 0; c <= spec.cols; c++) {
      ctx.moveTo(left + c * cw, top);
      ctx.lineTo(left + c * cw, top + spec.rows * ch);
    }
    for (let r = 0; r <= spec.rows; r++) {
      ctx.moveTo(left, top + r * ch);
      ctx.lineTo(left + spec.cols * cw, top + r * ch);
    }
    ctx.stroke();
  }

  // Per-character style from the active lens.
  const styleAt: (CellStyle | undefined)[] = new Array(text.length);
  let offset = 0;
  for (const seg of segmentsFor(o.lens, text, analysis)) {
    const style = seg.style ? SEGMENT_STYLE[seg.style] : undefined;
    for (let i = 0; i < seg.text.length; i++) styleAt[offset + i] = style;
    offset += seg.text.length;
  }

  if (o.lens === "structure") {
    for (let i = 0; i < rowsShown; i++) {
      const kind = analysis.layout.lineKinds[analysis.layout.rows[i].line];
      if (kind === undefined || kind === "blank") continue;
      const band = BAND[kind];
      ctx.fillStyle = band;
      ctx.fillRect(left, top + i * ch, spec.cols * cw, ch);
    }
  }

  if (o.heat) {
    const { values, cols } = o.heat;
    // A plane covers the whole grid, not just rows that hold text: tint every
    // painted row (the page, plus overflow rows when they are painted).
    const heatRows = Math.min(
      Math.floor(values.length / cols),
      o.overflow ? Math.max(spec.rows, rowsShown) : spec.rows,
    );
    for (let i = 0; i < heatRows; i++) {
      for (let c = 0; c < Math.min(cols, spec.cols); c++) {
        const fill = heatFill(values[i * cols + c] ?? 0);
        if (!fill) continue;
        ctx.fillStyle = fill;
        ctx.fillRect(left + c * cw, top + i * ch, cw, ch);
      }
    }
  }

  const { start, end, focused } = o.selection;
  if (chrome === "texture" && focused && end > start) {
    ctx.fillStyle = "rgba(59, 130, 246, 0.28)";
    for (let i = 0; i < rowsShown; i++) {
      const r = analysis.layout.rows[i];
      const a = Math.max(start, r.start);
      const b = Math.min(end, r.end);
      if (b > a) ctx.fillRect(left + (a - r.start) * cw, top + i * ch, (b - a) * cw, ch);
    }
  }

  for (let i = 0; i < rowsShown; i++) {
    const r = analysis.layout.rows[i];
    for (let j = r.start; j < r.end; j++) {
      const bg = styleAt[j]?.background;
      if (!bg) continue;
      ctx.fillStyle = bg;
      ctx.fillRect(left + (j - r.start) * cw, top + i * ch, cw, ch);
    }
  }

  const fontPx = fontSizeMm(spec) * k;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `400 ${fontPx}px ${o.fontFamily}`;
  const m = ctx.measureText("Hg");
  const ascent = m.fontBoundingBoxAscent || fontPx * 1.025;
  const descent = m.fontBoundingBoxDescent || fontPx * 0.275;
  // CSS half-leading: the content area is centered in the line box.
  const baseline = (ch - (ascent + descent)) / 2 + ascent;
  let currentWeight = 400;
  for (let i = 0; i < rowsShown; i++) {
    const r = analysis.layout.rows[i];
    const y = top + i * ch + baseline;
    for (let j = r.start; j < r.end; j++) {
      const c = text[j];
      if (c === " ") continue;
      const style = styleAt[j];
      const weight = style?.weight ?? 400;
      if (weight !== currentWeight) {
        ctx.font = `${weight} ${fontPx}px ${o.fontFamily}`;
        currentWeight = weight;
      }
      ctx.fillStyle = style?.color ?? INK;
      ctx.fillText(c, left + (j - r.start) * cw, y);
    }
  }

  if (chrome === "texture" && focused && start === end) {
    const cell = caretCell(analysis.layout.rows, start);
    if (cell && cell.row < spec.rows) {
      ctx.fillStyle = INK;
      ctx.fillRect(left + cell.col * cw - k * 0.12, top + cell.row * ch + ch * 0.1, Math.max(1, k * 0.28), ch * 0.8);
    }
  }

  // Rulers and row numbers.
  ctx.fillStyle = RULER;
  ctx.font = `400 ${2.1 * k}px ${o.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (let c = 5; c <= spec.cols; c += 5) {
    const x = left + (c - 0.5) * cw;
    const major = c % 10 === 0;
    ctx.fillRect(x - k * 0.13, top - 0.5 * k - (major ? 1.8 : 1) * k, Math.max(1, k * 0.26), (major ? 1.8 : 1) * k);
    if (major) ctx.fillText(String(c), x, top - 0.5 * k - 2.1 * k);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const r of [1, ...Array.from({ length: Math.floor(spec.rows / 5) }, (_, i) => (i + 1) * 5)]) {
    ctx.fillText(String(r), left - 2 * k, top + (r - 0.5) * ch);
  }

  // Margin ink gauge.
  const gaugeX = left + spec.cols * cw + 2 * k;
  const gaugeW = Math.min(10, spec.marginX - 4) * k;
  for (let i = 0; i < rowsShown; i++) {
    const row = analysis.layout.rows[i];
    if (row.ink === 0) continue;
    const frac = Math.min(1, row.ink / spec.cols);
    ctx.fillStyle =
      i >= spec.rows ? "rgba(180, 35, 24, 0.7)" : frac >= 0.85 ? "rgba(29, 28, 26, 0.55)" : "rgba(29, 28, 26, 0.3)";
    ctx.fillRect(gaugeX, top + i * ch + ch * 0.29, gaugeW * frac, ch * 0.42);
  }

  if (analysis.metrics.overflow > 0) {
    ctx.fillStyle = CRIT;
    ctx.font = `600 ${2.6 * k}px ${o.fontFamily}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const label = `▼ ${analysis.metrics.overflow} ${analysis.metrics.overflow === 1 ? "row" : "rows"} over the page`;
    const y = o.overflow ? top + spec.rows * ch - 1.6 * k : top + spec.rows * ch + (spec.marginY * k) / 2;
    ctx.fillText(label, left + spec.cols * cw, y);
  }

  return { heightMm };
}
