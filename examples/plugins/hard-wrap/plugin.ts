/**
 * Hard wrap: an example on-device pen. It rewraps every line longer than 72
 * columns at spaces, keeping the line's indent and list marker, and leaves
 * code blocks alone. It needs no network and downloads nothing. `main.ts`
 * serves it; this module is what the tests import.
 */

import { type PluginHandlers, sheetText } from "../../../lib/models/kit/serve.ts";

const WIDTH = 72;

/** One line wrapped at `width` columns: continuation lines are indented under the text after any list marker. */
function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const lead = /^(\s*(?:[-*+]|\d+[.)])?\s*)/.exec(line)?.[1] ?? "";
  const hang = " ".repeat(lead.length);
  const words = line.slice(lead.length).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = lead;
  for (const word of words) {
    const prefix = out.length === 0 ? lead : hang;
    if (current.length > prefix.length && current.length + 1 + word.length > width) {
      out.push(current);
      current = hang + word;
    } else {
      current = current.length > prefix.length ? `${current} ${word}` : current + word;
    }
  }
  out.push(current);
  return out;
}

/** `text` with every long line outside a code block wrapped at `width` columns. */
export function hardWrap(text: string, width = WIDTH): string {
  let fenced = false;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      out.push(line);
    } else {
      out.push(...(fenced ? [line] : wrapLine(line, width)));
    }
  }
  return out.join("\n");
}

export const handlers = (): PluginHandlers => ({
  async *transform(request) {
    const { text } = sheetText(request.sheet, "Hard wrap");
    yield { event: { case: "progress", value: { characters: 0 } } };
    const wrapped = hardWrap(text);
    yield { event: { case: "progress", value: { characters: wrapped.length } } };
    yield { event: { case: "candidate", value: { text: wrapped, model: "hard-wrap 1.0.0" } } };
  },
});
