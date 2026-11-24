/** Syntax characters: scaffolding (brackets, quotes, colons) rather than words. */

export const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/;
/** Sentence punctuation that does not count as syntax, incl. typographic forms. */
const PROSE_PUNCTUATION = new Set([".", ",", "?", "!", "'", "(", ")", "’", "‘", "“", "”", "—", "–", "…"]);

/** True when text[i] is a syntax character (scaffolding rather than words). */
export function isSyntaxAt(text: string, i: number): boolean {
  const ch = text[i];
  if (ch === undefined || WHITESPACE.test(ch) || LETTER_OR_DIGIT.test(ch)) return false;
  if (PROSE_PUNCTUATION.has(ch)) return false;
  if (ch === "-") {
    const prev = text[i - 1];
    const next = text[i + 1];
    if (prev && next && LETTER_OR_DIGIT.test(prev) && LETTER_OR_DIGIT.test(next)) return false;
  }
  return true;
}

export function countSyntax(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (isSyntaxAt(text, i)) n++;
  return n;
}
