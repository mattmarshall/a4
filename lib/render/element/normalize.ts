/**
 * Keeping tabs and carriage returns out of the page, one edit at a time.
 *
 * The editor first cancels an insertion that carries them and inserts the
 * cleaned text itself (one native undo step). When the browser inserts them
 * anyway (an insertion that can't be canceled), `normalizeEdit` finds the
 * range the edit changed and returns its cleaned replacement, so only that
 * range is rewritten and the caret keeps its place in the text.
 *
 * DOM-free, so Node tests it.
 */

import { normalizeText } from "../../page/index.ts";

/** Whether inserted text needs cleaning. */
export function needsNormalizing(text: string): boolean {
  return /[\t\r]/.test(text);
}

export interface NormalizedEdit {
  /** The range of `after` to replace. */
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  /** Where the caret goes in the cleaned text. */
  readonly caret: number;
}

/**
 * The cleaned replacement for the range of `after` that differs from
 * `before`, or null when that range needs no cleaning. `caret` is the caret
 * in `after`.
 */
export function normalizeEdit(before: string, after: string, caret: number): NormalizedEdit | null {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let suffix = 0;
  while (
    suffix < max - start &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++;
  }
  let end = after.length - suffix;
  // Keep a CR LF pair together, so it becomes one newline rather than two.
  if (after.charAt(end - 1) === "\r" && after.charAt(end) === "\n") end++;
  if (start > 0 && after.charAt(start) === "\n" && after.charAt(start - 1) === "\r") start--;
  const changed = after.slice(start, end);
  if (!needsNormalizing(changed)) return null;
  const replacement = normalizeText(changed);
  let mapped: number;
  if (caret <= start) mapped = caret;
  else if (caret >= end) mapped = caret + replacement.length - changed.length;
  else mapped = start + normalizeText(after.slice(start, caret)).length;
  return { start, end, replacement, caret: mapped };
}
