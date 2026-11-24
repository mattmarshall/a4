/**
 * Line classification: prose, structured, heading, or blank. Shared with the
 * Semantic repetition units (lib/models/semantic/units.ts).
 */

import { countInk } from "../page/index.ts";
import type { AnalysisConfig } from "./config.ts";
import { countSyntax } from "./syntax.ts";

export type LineKind = "prose" | "structured" | "heading" | "blank";

const LIST_MARKER = /^\s*(?:[-*•+]|\d+[.)])\s+/;
const KEY_VALUE = /^\s*["']?[\p{L}\p{N}_.-]+["']?\s*[:=]\s*(?:\S|$)/u;
const WORD = /\p{L}[\p{L}\p{N}'’-]*/gu;

function wordCount(s: string): number {
  return s.match(WORD)?.length ?? 0;
}

/** A Markdown heading, or a short all-caps line that fits one row of the page. */
function isHeading(line: string, config: AnalysisConfig["classify"], cols: number): boolean {
  const t = line.trim();
  if (/^#{1,6}\s/.test(t)) return true;
  const letters = t.match(/\p{L}/gu) ?? [];
  if (letters.length >= 2 && t.length <= cols && t === t.toUpperCase() && /\p{Lu}/u.test(t)) {
    return wordCount(t) <= config.headingMaxWords;
  }
  return false;
}

/** Classify each line; `cols` is the page width a heading must fit. */
export function classifyLines(lines: readonly string[], config: AnalysisConfig["classify"], cols: number): LineKind[] {
  const kinds: LineKind[] = [];
  let previous: LineKind = "blank";
  for (const line of lines) {
    let kind: LineKind;
    if (line.trim() === "") {
      kind = "blank";
    } else if (isHeading(line, config, cols)) {
      kind = "heading";
    } else {
      const body = line.replace(LIST_MARKER, "");
      const ink = countInk(body);
      const syntaxShare = ink === 0 ? 1 : countSyntax(body) / ink;
      const firstChar = body.trimStart()[0] ?? "";
      const opensStructure = "{[<|".includes(firstChar);
      const words = wordCount(body);
      const clean = syntaxShare <= config.proseMaxSyntax && !opensStructure;
      if (clean && words >= config.proseMinWords) {
        kind = "prose";
      } else if (clean && words >= 1 && previous === "prose" && !LIST_MARKER.test(line) && !KEY_VALUE.test(line)) {
        // Short tail of a wrapped paragraph.
        kind = "prose";
      } else {
        kind = "structured";
      }
    }
    kinds.push(kind);
    previous = kind;
  }
  return kinds;
}
