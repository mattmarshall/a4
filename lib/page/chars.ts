/**
 * The cell-unit contract: the page grid holds one UTF-16 code unit per cell.
 * A line of n code units fills n cells, wrapping after `cols`, whatever the
 * characters are, so text offsets and cells map one to one (the editor, both
 * renderers, the grid codec, and the analysis all count this way). A cell
 * carries ink when it holds a non-whitespace character.
 */

const NON_WHITESPACE = /\S/g;

/** Ink cells in `text`: its non-whitespace characters. */
export function countInk(text: string): number {
  return text.match(NON_WHITESPACE)?.length ?? 0;
}
