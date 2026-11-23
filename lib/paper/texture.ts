/**
 * Paint the page into a 2D canvas from A4's own model (grid geometry, visual
 * rows, lens segments), for use as the 3D sheet's texture. Characters are
 * placed per cell, so grid positions match the DOM sheet exactly even where
 * glyph rasterization differs.
 */

import type { Analysis } from "../analyze.ts";
import { segmentsFor, type LensId } from "../lenses.ts";
import { fontSizeMm, type PageSpec } from "../page-spec.ts";
import { PAPER_H, PAPER_W } from "./deform.ts";
import { caretCell } from "./pick.ts";

interface CellStyle {
  color?: string;
  background?: string;
  weight?: number;
}

/** Mirrors the lens classes in app/globals.css. */
const CLASS_STYLE: Record<string, CellStyle> = {
  "lens-dim": { color: "#8f8a80" },
  "lens-syn": { color: "#c2410c", background: "rgba(194, 65, 12, 0.08)", weight: 600 },
  "lens-heat-1": { background: "rgba(253, 230, 138, 0.7)" },
  "lens-heat-2": { background: "rgba(253, 186, 116, 0.75)" },
  "lens-heat-3": { background: "rgba(251, 146, 60, 0.75)" },
  "lens-heat-4": { background: "rgba(239, 68, 68, 0.6)", color: "#3b0a07" },
  "lens-tok-a": { background: "rgba(191, 219, 254, 0.8)" },
  "lens-tok-b": { background: "rgba(253, 230, 138, 0.8)" },
  "lens-kind-prose": { color: "#1f5a39" },
  "lens-kind-structured": { color: "#8a3d06" },
  "lens-kind-heading": { color: "#2d4a75", weight: 600 },
};

const BAND: Record<string, string> = {
  prose: "rgba(47, 122, 79, 0.09)",
  structured: "rgba(180, 83, 9, 0.13)",
  heading: "rgba(59, 91, 140, 0.12)",
};

const INK = "#1d1c1a";
const PAPER = "#fdfcf8";
const RULER = "#b3ada0";

export interface PaintOptions {
  text: string;
  spec: PageSpec;
  analysis: Analysis;
  lens: LensId;
  /** CSS font-family list for the page font. */
  fontFamily: string;
  pxPerMm: number;
  selection: { start: number; end: number; focused: boolean };
}

export function textureSize(pxPerMm: number): { width: number; height: number } {
  return { width: Math.round(PAPER_W * pxPerMm), height: Math.round(PAPER_H * pxPerMm) };
}

export function paintPage(canvas: HTMLCanvasElement | OffscreenCanvas, o: PaintOptions): void {
  const { spec, analysis, text, pxPerMm: k } = o;
  const { width, height } = textureSize(k);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const cw = spec.cellW * k;
  const ch = spec.cellH * k;
  const left = spec.marginX * k;
  const top = spec.marginY * k;
  const visibleRows = Math.min(spec.rows, analysis.rows.length);

  // Per-character style from the active lens.
  const styleAt: (CellStyle | undefined)[] = new Array(text.length);
  let offset = 0;
  for (const seg of segmentsFor(o.lens, text, analysis)) {
    const style = seg.cls ? CLASS_STYLE[seg.cls] : undefined;
    for (let i = 0; i < seg.text.length; i++) styleAt[offset + i] = style;
    offset += seg.text.length;
  }

  // Structure lens row bands.
  if (o.lens === "structure") {
    for (let i = 0; i < visibleRows; i++) {
      const band = BAND[analysis.lineKinds[analysis.rows[i].line] ?? ""];
      if (!band) continue;
      ctx.fillStyle = band;
      ctx.fillRect(left, top + i * ch, spec.cols * cw, ch);
    }
  }

  // Selection.
  const { start, end, focused } = o.selection;
  if (focused && end > start) {
    ctx.fillStyle = "rgba(59, 130, 246, 0.28)";
    for (let i = 0; i < visibleRows; i++) {
      const r = analysis.rows[i];
      const a = Math.max(start, r.start);
      const b = Math.min(end, r.end);
      if (b > a) ctx.fillRect(left + (a - r.start) * cw, top + i * ch, (b - a) * cw, ch);
    }
  }

  // Cell backgrounds, then glyphs (one cell at a time).
  for (let i = 0; i < visibleRows; i++) {
    const r = analysis.rows[i];
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
  for (let i = 0; i < visibleRows; i++) {
    const r = analysis.rows[i];
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

  // Caret.
  if (focused && start === end) {
    const cell = caretCell(analysis.rows, start);
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
  for (let i = 0; i < visibleRows; i++) {
    const row = analysis.rows[i];
    if (row.ink === 0) continue;
    const frac = Math.min(1, row.ink / spec.cols);
    ctx.fillStyle = frac >= 0.85 ? "rgba(29, 28, 26, 0.55)" : "rgba(29, 28, 26, 0.3)";
    ctx.fillRect(gaugeX, top + i * ch + ch * 0.29, gaugeW * frac, ch * 0.42);
  }

  // Overflow note in the bottom margin.
  if (analysis.overflow > 0) {
    ctx.fillStyle = "#b42318";
    ctx.font = `600 ${2.6 * k}px ${o.fontFamily}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`▼ ${analysis.overflow} rows over the page`, left + spec.cols * cw, top + spec.rows * ch + (spec.marginY * k) / 2);
  }
}
