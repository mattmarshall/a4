/**
 * Word length: an example on-device overlay. It tints each word by its
 * length over 12 letters, capped at 1, so long words stand out. It reads only
 * the page text, needs no network, and downloads nothing. `main.ts` serves it;
 * this module is what the tests import.
 */

import { type PluginHandlers, sheetText, spanPlane } from "../../../lib/models/kit/serve.ts";

export const PLANE = "Word length";

/** Each word (a run of letters and digits) and its value: its length over 12, capped at 1. */
export function wordSpans(text: string): { start: number; end: number; value: number }[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), (m) => ({
    start: m.index,
    end: m.index + m[0].length,
    value: Math.min(1, m[0].length / 12),
  }));
}

export const handlers = (): PluginHandlers => ({
  score: (request) => {
    const { text, spec } = sheetText(request.sheet, "Word length");
    return { planes: [{ name: PLANE, label: PLANE, text, ...spanPlane(text, spec, wordSpans(text)) }] };
  },
});
