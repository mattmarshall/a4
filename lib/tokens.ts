/**
 * On-device token estimate.
 *
 * A deliberately small heuristic that approximates BPE tokenizers (such as
 * cl100k / o200k) closely enough to compare two representations of the same
 * context. It is always presented as an estimate ("≈").
 *
 * Pre-tokenization mirrors common BPE splitting: a single leading space joins
 * the following word, number, or symbol run. Each piece then costs:
 *   - letters: 1 token up to 9 letters, then ceil(len / 7)
 *   - non-Latin letters (CJK etc.): 1 token per character
 *   - digits: ceil(len / 3)
 *   - symbol runs: ceil(len / 2)   (e.g. `":` or `},` are usually one token)
 *   - indentation / space runs: ceil(len / 4)
 *   - newline runs: 1
 */

export interface TokenPiece {
  start: number;
  end: number;
}

const PIECE = /\n+| +(?= \S)|[ ]?\p{L}+|[ ]?\p{N}+|[ ]?[^\s\p{L}\p{N}]+| +|\s/gu;

const NON_LATIN = /[^\u0000-ɏ]/u;

function costOf(piece: string): number {
  const first = piece[0];
  if (first === "\n") return 1;
  const body = first === " " && piece.length > 1 ? piece.slice(1) : piece;
  if (/^ +$/.test(piece)) return Math.ceil(piece.length / 4);
  if (/^\p{L}+$/u.test(body)) {
    if (NON_LATIN.test(body)) return Array.from(body).length;
    return body.length <= 9 ? 1 : Math.ceil(body.length / 7);
  }
  if (/^\p{N}+$/u.test(body)) return Math.ceil(body.length / 3);
  if (/^\s$/.test(piece)) return 1;
  return Math.ceil(Array.from(body).length / 2);
}

/** Split text into estimated token pieces, with offsets into `text`. */
export function tokenPieces(text: string): TokenPiece[] {
  const pieces: TokenPiece[] = [];
  for (const m of text.matchAll(PIECE)) {
    const start = m.index ?? 0;
    const str = m[0];
    const cost = costOf(str);
    if (cost <= 1) {
      pieces.push({ start, end: start + str.length });
      continue;
    }
    // Spread multi-token pieces evenly so the Tokens lens can show them.
    const size = Math.ceil(str.length / cost);
    for (let i = 0; i < str.length; i += size) {
      pieces.push({ start: start + i, end: start + Math.min(str.length, i + size) });
    }
  }
  return pieces;
}

/** Estimated token count for `text`. */
export function estimateTokens(text: string): number {
  let total = 0;
  for (const m of text.matchAll(PIECE)) total += costOf(m[0]);
  return total;
}
