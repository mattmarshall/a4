/**
 * Column-major 4×4 matrices (WebGPU/WGSL layout, clip z in [0, 1]) and the
 * orbit camera used by the paper view.
 */

import type { Vec3 } from "./deform.ts";

type Mat4 = Float32Array;

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function invert(m: Mat4): Mat4 {
  const inv = new Float32Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) throw new Error("Singular matrix");
  const id = 1 / det;
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * id;
  inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * id;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * id;
  inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * id;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * id;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * id;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * id;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * id;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * id;
  inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * id;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * id;
  inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * id;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * id;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * id;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * id;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * id;
  return inv;
}

function transformPoint(m: Mat4, p: Vec3): [number, number, number, number] {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export interface CameraOptions {
  /** Degrees from straight down (0) toward the viewer. */
  tilt: number;
  /** Degrees of rotation around the vertical axis. */
  yaw: number;
  aspect: number;
  /**
   * Zoom as CSS pixels per millimeter at the sheet (an untilted sheet then
   * appears 210 × pxPerMm CSS px wide). Needs `cssHeight`. Omit to fit.
   */
  pxPerMm?: number | null;
  /** The canvas's CSS height in pixels (for `pxPerMm`). */
  cssHeight?: number;
  /** The sheet's width and height in mm, to fit it. */
  paper: { readonly w: number; readonly h: number };
}

export interface Camera {
  viewProj: Mat4;
  invViewProj: Mat4;
  eye: Vec3;
}

const FOV_Y = (30 * Math.PI) / 180;

export function camera({ tilt, yaw, aspect, pxPerMm, cssHeight, paper }: CameraOptions): Camera {
  const t = (tilt * Math.PI) / 180;
  const w = (yaw * Math.PI) / 180;
  const margin = 18;
  const fitH = (paper.h / 2 + margin) / Math.tan(FOV_Y / 2);
  const fitW = (paper.w / 2 + margin) / (Math.tan(FOV_Y / 2) * aspect);
  const dist = pxPerMm && cssHeight ? cssHeight / (2 * Math.tan(FOV_Y / 2) * pxPerMm) : Math.max(fitH, fitW);
  const eye: Vec3 = [dist * Math.sin(t) * Math.sin(w), dist * Math.cos(t), dist * Math.sin(t) * Math.cos(w)];
  const target: Vec3 = [0, 0, 0];
  const f = normalize(sub(target, eye));
  const right: Vec3 = [Math.cos(w), 0, -Math.sin(w)];
  const up = normalize(cross(right, f));
  const r = normalize(cross(f, up));
  // View matrix rows: r, up, −f (column-major storage).
  const view = new Float32Array([
    r[0],
    up[0],
    -f[0],
    0,
    r[1],
    up[1],
    -f[1],
    0,
    r[2],
    up[2],
    -f[2],
    0,
    -dot(r, eye),
    -dot(up, eye),
    dot(f, eye),
    1,
  ]);
  const viewProj = multiply(perspective(FOV_Y, aspect, 10, dist * 4), view);
  return { viewProj, invViewProj: invert(viewProj), eye };
}

/** World-space ray through normalized device coordinates (x, y in [−1, 1], +y up). */
export function rayFromNdc(cam: Camera, ndcX: number, ndcY: number): { origin: Vec3; dir: Vec3 } {
  const near = transformPoint(cam.invViewProj, [ndcX, ndcY, 0]);
  const far = transformPoint(cam.invViewProj, [ndcX, ndcY, 1]);
  const n: Vec3 = [near[0] / near[3], near[1] / near[3], near[2] / near[3]];
  const f: Vec3 = [far[0] / far[3], far[1] / far[3], far[2] / far[3]];
  return { origin: n, dir: normalize(sub(f, n)) };
}

/** Project a world point to NDC (x, y in [−1, 1], +y up). */
export function projectToNdc(cam: Camera, p: Vec3): [number, number] {
  const c = transformPoint(cam.viewProj, p);
  return [c[0] / c[3], c[1] / c[3]];
}
