/**
 * Lenses: presentation-only views of the page text. Each lens turns the text
 * into contiguous segments (covering every character exactly once), each with
 * a `SegmentStyle` the painter draws.
 */

import { assertNever, LENS_IDS, type LensId } from "../page/index.ts";
import type { LineKind } from "./classify.ts";
import type { Layout } from "./metrics.ts";
import { isSyntaxAt } from "./syntax.ts";
import { normalizeTerm, TERM, termStats } from "./terms.ts";
import { tokenPieces } from "./tokens.ts";

const LENS_COPY: Record<LensId, { readonly name: string; readonly hint: string }> = {
  ink: { name: "Ink", hint: "The page as written" },
  syntax: { name: "Syntax", hint: "Scaffolding characters in red; words dimmed" },
  repetition: { name: "Repetition", hint: "Repeated terms glow hotter the more they repeat" },
  structure: { name: "Structure", hint: "Lines tinted as prose, fields, or headings" },
  tokens: { name: "Tokens", hint: "Alternating shades show estimated token boundaries" },
};

/** The lenses in top-bar order, with their names and hints. */
export const LENSES: readonly { readonly id: LensId; readonly name: string; readonly hint: string }[] = LENS_IDS.map(
  (id) => ({ id, ...LENS_COPY[id] }),
);

/** How hot a repeated term is: 0 (not repeated) to 4 (repeated the most). */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** How the painter draws a segment. Unstyled text is drawn as ink. */
export type SegmentStyle =
  | "dim"
  | "syntax"
  | `heat-${Exclude<HeatLevel, 0>}`
  | "token-a"
  | "token-b"
  | Exclude<LineKind, "blank">;

export interface Segment {
  text: string;
  style?: SegmentStyle;
}

function push(out: Segment[], text: string, style?: SegmentStyle) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.style === style) last.text += text;
  else out.push(style === undefined ? { text } : { text, style });
}

/** Syntax is marked, other ink is dimmed, and whitespace stays plain. */
function syntaxStyle(text: string, i: number, ch: string): Segment["style"] {
  if (isSyntaxAt(text, i)) return "syntax";
  return /\s/.test(ch) ? undefined : "dim";
}

function syntaxSegments(text: string): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    push(out, ch, syntaxStyle(text, i, ch));
  }
  return out;
}

const HEAT_LEVELS = [0, 1, 2, 3, 4] as const satisfies readonly HeatLevel[];

/** Heat level 1–4 for a term seen `count` times, relative to the page maximum; 0 when not repeated. */
export function heatLevel(count: number, maxCount: number): HeatLevel {
  if (count < 2) return 0;
  if (maxCount <= 2) return 1;
  const ratio = (count - 1) / (maxCount - 1);
  return HEAT_LEVELS[Math.min(4, Math.max(1, Math.ceil(ratio * 4)))] ?? 4;
}

function repetitionSegments(text: string): Segment[] {
  const out: Segment[] = [];
  const { termCounts } = termStats(text);
  // Most frequent first: the top count, if it repeats, is the page maximum.
  const top = termCounts[0]?.count ?? 0;
  const maxCount = top > 1 ? top : 0;
  const counts = new Map(termCounts.map((t) => [t.term, t.count]));
  let cursor = 0;
  for (const m of text.matchAll(TERM)) {
    const start = m.index ?? 0;
    const term = normalizeTerm(m[0]);
    const count = term ? (counts.get(term) ?? 0) : 0;
    const level = heatLevel(count, maxCount);
    if (level === 0) continue;
    push(out, text.slice(cursor, start), "dim");
    push(out, m[0], `heat-${level}`);
    cursor = start + m[0].length;
  }
  push(out, text.slice(cursor), "dim");
  return out;
}

export const KIND_LABEL: Record<Exclude<LineKind, "blank">, string> = {
  prose: "Prose: sentences that carry relationships",
  structured: "Fields and fragments: keys, values, code, tables",
  heading: "Headings",
};

function structureSegments(text: string, layout: Layout): Segment[] {
  const out: Segment[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const kind = layout.lineKinds[i] ?? "blank";
    push(out, line, kind === "blank" ? undefined : kind);
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
    out.push(piece.includes("\n") ? { text: piece } : { text: piece, style: i % 2 ? "token-b" : "token-a" });
    cursor = p.end;
  });
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

/**
 * The lens's segments for `text`. Takes the layout (an `Analysis` is one), not
 * the whole analysis, so a painter can call it without the metrics.
 */
export function segmentsFor(lens: LensId, text: string, source: { readonly layout: Layout }): Segment[] {
  switch (lens) {
    case "ink":
      return [{ text }];
    case "syntax":
      return syntaxSegments(text);
    case "repetition":
      return repetitionSegments(text);
    case "structure":
      return structureSegments(text, source.layout);
    case "tokens":
      return tokenSegments(text);
    default:
      return assertNever(lens);
  }
}
