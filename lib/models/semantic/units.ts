/**
 * Units of meaning for semantic repetition: sentences in prose paragraphs,
 * and whole structured or heading lines. Each unit keeps its span in the page
 * text so scores map back to cells.
 */

import { classifyLines, type LineKind } from "../../analyze.ts";

/** Units with fewer non-whitespace characters than this are skipped. */
export const MIN_UNIT_INK = 12;

export interface Unit {
  /** Half-open span of the unit in the page text. */
  start: number;
  end: number;
  /** The unit's text with whitespace collapsed, for embedding. */
  text: string;
  kind: Exclude<LineKind, "blank">;
}

const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;
// A sentence ends at ., !, or ? (and any closing quotes or brackets), followed
// by whitespace or the end of the paragraph.
const SENTENCE_END = /[.!?]["'”’)\]]*(?=\s|$)/g;

const ink = (s: string) => s.replace(/\s+/g, "").length;
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Trim whitespace (and a leading list marker) off a span of `text`. */
function trimSpan(text: string, start: number, end: number): [number, number] {
  const marker = text.slice(start, end).match(LIST_ITEM);
  if (marker) start += marker[0].length;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [start, end];
}

function push(units: Unit[], text: string, start: number, end: number, kind: Unit["kind"]): void {
  [start, end] = trimSpan(text, start, end);
  const slice = text.slice(start, end);
  if (ink(slice) < MIN_UNIT_INK) return;
  units.push({ start, end, text: collapse(slice), kind });
}

/** Split normalized page text into units, in reading order. */
export function extractUnits(text: string): Unit[] {
  const lines = text.split("\n");
  const kinds = classifyLines(lines);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const units: Unit[] = [];

  let i = 0;
  while (i < lines.length) {
    const kind = kinds[i];
    if (kind === "blank") {
      i++;
      continue;
    }
    if (kind !== "prose") {
      push(units, text, starts[i], starts[i] + lines[i].length, kind);
      i++;
      continue;
    }
    // A prose paragraph: consecutive prose lines, with a new paragraph at
    // each list item.
    let j = i + 1;
    while (j < lines.length && kinds[j] === "prose" && !LIST_ITEM.test(lines[j])) j++;
    const pStart = starts[i];
    const pEnd = starts[j - 1] + lines[j - 1].length;
    const paragraph = text.slice(pStart, pEnd);
    let from = 0;
    for (const m of paragraph.matchAll(SENTENCE_END)) {
      const to = m.index + m[0].length;
      push(units, text, pStart + from, pStart + to, "prose");
      from = to;
    }
    if (from < paragraph.length) push(units, text, pStart + from, pEnd, "prose");
    i = j;
  }
  return units;
}
