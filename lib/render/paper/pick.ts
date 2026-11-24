/**
 * Picking on the deformed sheet: ray → nearest triangle → paper (x, y) mm →
 * grid cell → text offset. Exact on curved paper because the deformation and
 * the grid are both ours.
 */

import { PAPER_H, PAPER_W } from "../../page/index.ts";
import type { PaperMesh, Vec3 } from "./deform.ts";

export interface PaperHit {
  /** Paper coordinates in mm. */
  x: number;
  y: number;
  /** Ray distance. */
  t: number;
}

/**
 * Nearest intersection of a ray with the deformed mesh. Returns null when the
 * ray misses the sheet or the nearest surface hit is the back of the paper.
 * `positions` holds each vertex's world position first, every `stride` floats
 * (3 for `deformMesh`, `VERTEX_FLOATS` for `deformAttributes`).
 */
export function raycast(
  mesh: PaperMesh,
  positions: Float32Array,
  origin: Vec3,
  dir: Vec3,
  stride = 3,
): PaperHit | null {
  const { indices, uvs } = mesh;
  let best = Infinity;
  let hit: { tri: number; u: number; v: number; front: boolean } | null = null;
  for (let k = 0; k < indices.length; k += 3) {
    const ia = indices[k] * stride;
    const ib = indices[k + 1] * stride;
    const ic = indices[k + 2] * stride;
    const e1x = positions[ib] - positions[ia];
    const e1y = positions[ib + 1] - positions[ia + 1];
    const e1z = positions[ib + 2] - positions[ia + 2];
    const e2x = positions[ic] - positions[ia];
    const e2y = positions[ic + 1] - positions[ia + 1];
    const e2z = positions[ic + 2] - positions[ia + 2];
    // Möller–Trumbore
    const px = dir[1] * e2z - dir[2] * e2y;
    const py = dir[2] * e2x - dir[0] * e2z;
    const pz = dir[0] * e2y - dir[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) continue;
    const inv = 1 / det;
    const tx = origin[0] - positions[ia];
    const ty = origin[1] - positions[ia + 1];
    const tz = origin[2] - positions[ia + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t <= 0 || t >= best) continue;
    // Printed-side normal is e1 × e2 for buildMesh's winding (+Y on flat paper).
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const front = nx * dir[0] + ny * dir[1] + nz * dir[2] < 0;
    best = t;
    hit = { tri: k, u, v, front };
  }
  if (!hit?.front) return null;
  const a = indices[hit.tri] * 2;
  const b = indices[hit.tri + 1] * 2;
  const c = indices[hit.tri + 2] * 2;
  const w = 1 - hit.u - hit.v;
  const pu = uvs[a] * w + uvs[b] * hit.u + uvs[c] * hit.v;
  const pv = uvs[a + 1] * w + uvs[b + 1] * hit.u + uvs[c + 1] * hit.v;
  return { x: pu * PAPER_W, y: pv * PAPER_H, t: best };
}

// Offset ↔ cell mapping lives with the grid codec, so the renderers and the
// tensor views share one implementation.
export { cellToOffset as caretOffset, offsetToCell as caretCell } from "../../tensor/cells.ts";
