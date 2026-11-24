/**
 * Lenses: presentation-only views of the page text. Each lens turns the text
 * into contiguous segments (covering every character exactly once) with a
 * style class for the backdrop layer behind the editor.
 */

import { isSyntaxAt, normalizeTerm, TERM, type Analysis, type LineKind } from "./analyze.ts";
import { tokenPieces } from "./tokens.ts";

export type LensId = "ink" | "syntax" | "repetition" | "structure" | "tokens";

export const LENSES: { id: LensId; name: string; hint: string }[] = [
  { id: "ink", name: "Ink", hint: "The page as written" },
  { id: "syntax", name: "Syntax", hint: "Scaffolding characters in red; words dimmed" },
  { id: "repetition", name: "Repetition", hint: "Repeated terms glow hotter the more they repeat" },
  { id: "structure", name: "Structure", hint: "Lines tinted as prose, fields, or headings" },
  { id: "tokens", name: "Tokens", hint: "Alternating shades show estimated token boundaries" },
];

export function isLensId(value: unknown): value is LensId {
  return typeof value === "string" && LENSES.some((l) => l.id === value);
}

export interface Segment {
  text: string;
  cls?: string;
}

function push(out: Segment[], text: string, cls?: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.cls === cls) last.text += text;
  else out.push(cls === undefined ? { text } : { text, cls });
}

function syntaxSegments(text: string): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    push(out, ch, isSyntaxAt(text, i) ? "lens-syn" : /\s/.test(ch) ? undefined : "lens-dim");
  }
  return out;
}

/** Heat level 1–4 for a term seen `count` times, relative to the page maximum. */
export function heatLevel(count: number, maxCount: number): number {
  if (count < 2) return 0;
  if (maxCount <= 2) return 1;
  const ratio = (count - 1) / (maxCount - 1);
  return Math.min(4, Math.max(1, Math.ceil(ratio * 4)));
}

function repetitionSegments(text: string, analysis: Analysis): Segment[] {
  const out: Segment[] = [];
  const maxCount = analysis.repeatedTerms[0]?.count ?? 0;
  let cursor = 0;
  for (const m of text.matchAll(TERM)) {
    const start = m.index ?? 0;
    const term = normalizeTerm(m[0]);
    const count = term ? (analysis.termCounts.get(term) ?? 0) : 0;
    const level = heatLevel(count, maxCount);
    if (level === 0) continue;
    push(out, text.slice(cursor, start), "lens-dim");
    push(out, m[0], `lens-heat-${level}`);
    cursor = start + m[0].length;
  }
  push(out, text.slice(cursor), "lens-dim");
  return out;
}

export const KIND_LABEL: Record<Exclude<LineKind, "blank">, string> = {
  prose: "Prose: sentences that carry relationships",
  structured: "Fields and fragments: keys, values, code, tables",
  heading: "Headings",
};

function structureSegments(text: string, analysis: Analysis): Segment[] {
  const out: Segment[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const kind = analysis.lineKinds[i] ?? "blank";
    push(out, line, kind === "blank" ? undefined : `lens-kind-${kind}`);
    if (i < lines.length - 1) push(out, "\n", undefined);
  });
  return out;
}

function tokenSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  tokenPieces(text).forEach((p, i) => {
    if (p.start > cursor) out.push({ text: text.slice(cursor, p.start) });
    const piece = text.slice(p.start, p.end);
    // Newline-only pieces carry no visible shade.
    out.push(piece.includes("\n") ? { text: piece } : { text: piece, cls: i % 2 ? "lens-tok-b" : "lens-tok-a" });
    cursor = p.end;
  });
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

export function segmentsFor(lens: LensId, text: string, analysis: Analysis): Segment[] {
  switch (lens) {
    case "syntax":
      return syntaxSegments(text);
    case "repetition":
      return repetitionSegments(text, analysis);
    case "structure":
      return structureSegments(text, analysis);
    case "tokens":
      return tokenSegments(text);
    default:
      return [{ text }];
  }
}
