/**
 * Paper deformations: isometries of the A4 sheet (no stretching).
 *
 * Paper coordinates are millimeters: x across (0–210), y down the page
 * (0–297). World coordinates put the desk at height 0, X right, Y up, Z toward
 * the viewer, with the sheet centered on the origin.
 *
 * This is the only copy of the deformation: when the pose changes, the
 * renderer deforms every vertex here (`deformAttributes`) and uploads the
 * result, and picking uses the same positions. The shader only transforms.
 */

import { PAPER_H, PAPER_W } from "../../page/index.ts";

/** Letter-fold hinges (thirds) and their crease radii in mm. */
export const HINGE_TOP = 99;
export const HINGE_BOTTOM = 198;
const CREASE_TOP = 3;
const CREASE_BOTTOM = 1.5;

/** Corner curl: cylinder radius, direction toward the bottom-right corner, depth at amount 1. */
const CURL_RADIUS = 16;
const curlLen = Math.hypot(1, 1.25);
export const CURL_DIR: readonly [number, number] = [1 / curlLen, 1.25 / curlLen];
const CURL_MAX_DEPTH = 125;

export interface Pose {
  /** Bottom third folded up: 0 flat … 1 folded over. */
  foldBottom: number;
  /** Top third folded down: 0 flat … 1 folded over. */
  foldTop: number;
  /** Bottom-right corner curl: 0 flat … 1 curled. */
  curl: number;
}

export const FLAT: Pose = { foldBottom: 0, foldTop: 0, curl: 0 };

export type Vec3 = [number, number, number];

/** Point on the curl line (it is perpendicular to CURL_DIR). */
export function curlLinePoint(amount: number): [number, number] {
  const d = Math.max(0, Math.min(1, amount)) * CURL_MAX_DEPTH;
  return [PAPER_W - CURL_DIR[0] * d, PAPER_H - CURL_DIR[1] * d];
}

/**
 * Bend a point at distance `d` past a hinge (height `h` above its panel)
 * around a rounded crease of radius `r` by angle `alpha`. Returns the new
 * (along, height) and whether the point lies on the crease arc.
 */
function bend(d: number, h: number, alpha: number, r: number): [number, number, boolean] {
  const arcLen = r * alpha;
  const a = Math.min(d, arcLen);
  const phi = r > 0 ? a / r : 0;
  const tail = Math.max(0, d - arcLen);
  const along = r * Math.sin(phi) + tail * Math.cos(alpha) - h * Math.sin(phi);
  const height = r * (1 - Math.cos(phi)) + tail * Math.sin(alpha) + h * Math.cos(phi);
  return [along, height, d < arcLen && alpha > 1e-3];
}

export interface Deformed {
  world: Vec3;
  /** 0 on flat paper, toward 1 on creases (used for shading). */
  crease: number;
}

/** Deform paper point (x, y) mm under `pose` into world space. */
export function deform(x: number, y: number, pose: Pose): Deformed {
  let px = x;
  let py = y;
  let h = 0;
  let crease = 0;

  if (pose.curl > 0) {
    const [lx, ly] = curlLinePoint(pose.curl);
    const [nx, ny] = CURL_DIR;
    const s = (px - lx) * nx + (py - ly) * ny;
    if (s > 0) {
      const R = CURL_RADIUS;
      let s2: number;
      if (s <= Math.PI * R) {
        s2 = R * Math.sin(s / R);
        h = R * (1 - Math.cos(s / R));
        crease = 0.35;
      } else {
        s2 = -(s - Math.PI * R);
        h = 2 * R;
      }
      px += nx * (s2 - s);
      py += ny * (s2 - s);
    }
  }

  if (pose.foldBottom > 0 && py > HINGE_BOTTOM) {
    const [along, height, onCrease] = bend(py - HINGE_BOTTOM, h, pose.foldBottom * Math.PI, CREASE_BOTTOM);
    py = HINGE_BOTTOM + along;
    h = height;
    if (onCrease) crease = 1;
  }
  if (pose.foldTop > 0 && py < HINGE_TOP) {
    const [along, height, onCrease] = bend(HINGE_TOP - py, h, pose.foldTop * Math.PI, CREASE_TOP);
    py = HINGE_TOP - along;
    h = height;
    if (onCrease) crease = 1;
  }

  return { world: [px - PAPER_W / 2, h, py - PAPER_H / 2], crease };
}

/** Curl and fold are exclusive: raising one resets the other. */
export function withPose(current: Pose, change: Partial<Pose>): Pose {
  const next = { ...current, ...change };
  if ((change.foldBottom ?? 0) > 0 || (change.foldTop ?? 0) > 0) next.curl = 0;
  if ((change.curl ?? 0) > 0) {
    next.foldBottom = 0;
    next.foldTop = 0;
  }
  return next;
}

export interface PaperMesh {
  /** Segments across and down. */
  nx: number;
  ny: number;
  /** (u, v) per vertex in [0, 1]. */
  uvs: Float32Array;
  /** Triangle indices; triangles wind so the printed side faces +Y when flat. */
  indices: Uint32Array;
}

export function buildMesh(nx = 72, ny = 150): PaperMesh {
  const uvs = new Float32Array((nx + 1) * (ny + 1) * 2);
  let k = 0;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      uvs[k++] = i / nx;
      uvs[k++] = j / ny;
    }
  }
  const indices = new Uint32Array(nx * ny * 6);
  k = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      // (a, c, b) and (b, c, d): normal = (c − a) × (b − a) = +Y for flat paper.
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  return { nx, ny, uvs, indices };
}

/** World positions of every mesh vertex under `pose`. */
export function deformMesh(mesh: PaperMesh, pose: Pose): Float32Array {
  const out = new Float32Array((mesh.uvs.length / 2) * 3);
  for (let i = 0, j = 0; i < mesh.uvs.length; i += 2, j += 3) {
    const { world } = deform(mesh.uvs[i] * PAPER_W, mesh.uvs[i + 1] * PAPER_H, pose);
    out[j] = world[0];
    out[j + 1] = world[1];
    out[j + 2] = world[2];
  }
  return out;
}

/** Floats per vertex in `deformAttributes`: position (3), normal (3), crease (1). */
export const VERTEX_FLOATS = 7;

/** Step in uv for the finite differences that give each vertex's normal. */
const NORMAL_STEP = 0.0015;

/**
 * Every vertex of `mesh` under `pose`, interleaved for the GPU: world
 * position, unit normal of the printed side (+Y on flat paper), and crease
 * factor. Normals come from central differences of the deformation, so they
 * follow the paper wherever it bends.
 */
export function deformAttributes(mesh: PaperMesh, pose: Pose): Float32Array {
  const count = mesh.uvs.length / 2;
  const out = new Float32Array(count * VERTEX_FLOATS);
  const e = NORMAL_STEP;
  const at = (u: number, v: number) => deform(u * PAPER_W, v * PAPER_H, pose).world;
  for (let i = 0; i < count; i++) {
    const u = mesh.uvs[i * 2] ?? 0;
    const v = mesh.uvs[i * 2 + 1] ?? 0;
    const { world, crease } = deform(u * PAPER_W, v * PAPER_H, pose);
    const u1 = at(u + e, v);
    const u0 = at(u - e, v);
    const v1 = at(u, v + e);
    const v0 = at(u, v - e);
    const du: Vec3 = [u1[0] - u0[0], u1[1] - u0[1], u1[2] - u0[2]];
    const dv: Vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
    // dv × du faces the printed side.
    const nx = dv[1] * du[2] - dv[2] * du[1];
    const ny = dv[2] * du[0] - dv[0] * du[2];
    const nz = dv[0] * du[1] - dv[1] * du[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    const o = i * VERTEX_FLOATS;
    out[o] = world[0];
    out[o + 1] = world[1];
    out[o + 2] = world[2];
    out[o + 3] = nx / len;
    out[o + 4] = ny / len;
    out[o + 5] = nz / len;
    out[o + 6] = crease;
  }
  return out;
}
