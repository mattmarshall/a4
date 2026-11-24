/**
 * From unit embeddings to the Semantic repetition plane and summary. Pure, so
 * it is tested with fixed vectors; the worker supplies real embeddings.
 */

import { layoutRows } from "../../page/index.ts";
import { spanToCells } from "../../tensor/cells.ts";
import type { Unit } from "./units.ts";

/** Similarity at which a unit counts as restating another. */
export const RESTATE_SIMILARITY = 0.85;
/**
 * Where the scale starts: below this a unit's cells hold 0 and its pairs
 * aren't listed. Unrelated sentences score far lower (under 0.2 in
 * calibration), so they stay clear.
 */
export const SIMILARITY_FLOOR = 0.6;
/** Most pairs listed in the summary. */
export const MAX_PAIRS = 5;

export interface SimilarPair {
  /** Index of the earlier unit. */
  a: number;
  /** Index of the later unit, the one to consider cutting. */
  b: number;
  similarity: number;
}

export interface SemanticScore {
  /** One value per cell of the text's grid, row-major. */
  values: Float32Array;
  rows: number;
  cols: number;
  /** Each unit's highest similarity to another non-identical unit. */
  best: number[];
  /** Units that restate at least one other (similarity of 0.85 or more). */
  restating: number;
  /** The closest pairs at or above the floor, most similar first. */
  pairs: SimilarPair[];
}

/** A unit's value from its best similarity: clamp((s − 0.60) / 0.40, 0, 1). */
export function cellValue(similarity: number): number {
  return Math.min(1, Math.max(0, (similarity - SIMILARITY_FLOOR) / (1 - SIMILARITY_FLOOR)));
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const sameText = (a: Unit, b: Unit) => a.text.toLowerCase() === b.text.toLowerCase();

/**
 * Score units given L2-normalized embeddings (so cosine is a dot product),
 * on a page of `shape.cols` × `shape.rows` cells.
 */
export function scoreUnits(
  text: string,
  units: Unit[],
  vectors: Float32Array[],
  shape: { cols: number; rows: number },
): SemanticScore {
  const rowsLaid = layoutRows(text, shape.cols);
  const rows = Math.max(shape.rows, rowsLaid.length);
  const values = new Float32Array(rows * shape.cols);
  const best = units.map(() => 0);
  const candidates: SimilarPair[] = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (sameText(units[i], units[j])) continue; // duplicate lines are reported elsewhere
      const s = dot(vectors[i], vectors[j]);
      if (s > best[i]) best[i] = s;
      if (s > best[j]) best[j] = s;
      if (s >= SIMILARITY_FLOOR) candidates.push({ a: i, b: j, similarity: s });
    }
  }
  units.forEach((unit, i) => {
    const v = cellValue(best[i]);
    if (v <= 0) return;
    for (const run of spanToCells(rowsLaid, unit.start, unit.end)) {
      values.fill(v, run.row * shape.cols + run.col, run.row * shape.cols + run.col + run.cols);
    }
  });
  candidates.sort((x, y) => y.similarity - x.similarity);
  return {
    values,
    rows,
    cols: shape.cols,
    best,
    restating: best.filter((s) => s >= RESTATE_SIMILARITY).length,
    pairs: candidates.slice(0, MAX_PAIRS),
  };
}
