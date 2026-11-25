/**
 * The paper shader's uniform block, packed in TypeScript. The offsets are
 * named here and mirrored by the WGSL `Uniforms` struct in shader.ts; a test
 * parses that struct and checks every offset. The pose isn't here: the paper
 * is deformed on the CPU, so the shader never sees it.
 */

import type { Vec3 } from "./deform.ts";

/** Offsets in floats (4 bytes) of each member of the WGSL `Uniforms` struct. */
export const UNIFORM_OFFSETS = {
  /** mat4x4f: the camera's view-projection matrix. */
  viewProj: 0,
  /** vec4f: the eye position (w = 1). */
  eye: 16,
  /** vec4f: xyz is the direction toward the light. */
  lightDir: 20,
  /** vec4f: the desk's rgb, and in a how much the shadow darkens it. */
  desk: 24,
  /** vec4f: the sheet's width and height in mm (xy). */
  paper: 28,
} as const;

/** The block's size in floats. */
export const UNIFORM_FLOATS = 32;

export interface UniformInput {
  readonly viewProj: Float32Array;
  readonly eye: Vec3;
  /** Unit direction toward the light. */
  readonly light: Vec3;
  /** How much the shadow darkens the desk, 0 to 1. */
  readonly shadow: number;
  readonly desk: readonly [number, number, number];
  /** The sheet's width and height in mm. */
  readonly paper: { readonly w: number; readonly h: number };
}

export function packUniforms(input: UniformInput): Float32Array {
  const data = new Float32Array(UNIFORM_FLOATS);
  data.set(input.viewProj.subarray(0, 16), UNIFORM_OFFSETS.viewProj);
  data.set([...input.eye, 1], UNIFORM_OFFSETS.eye);
  data.set([...input.light, 0], UNIFORM_OFFSETS.lightDir);
  data.set([...input.desk, input.shadow], UNIFORM_OFFSETS.desk);
  data.set([input.paper.w, input.paper.h, 0, 0], UNIFORM_OFFSETS.paper);
  return data;
}

/** Unit direction toward a light at `azimuth` degrees around the desk and `elevation` degrees above it. */
export function lightDirection(azimuth: number, elevation: number): Vec3 {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}
