import { test } from "node:test";
import assert from "node:assert/strict";
import { PAPER_WGSL } from "./shader.ts";
import { lightDirection, packUniforms, UNIFORM_FLOATS, UNIFORM_OFFSETS } from "./uniforms.ts";

/** Size and alignment in bytes of the WGSL types the uniform block may use. */
const WGSL_TYPES: Record<string, { size: number; align: number }> = {
  f32: { size: 4, align: 4 },
  vec2f: { size: 8, align: 8 },
  vec3f: { size: 12, align: 16 },
  vec4f: { size: 16, align: 16 },
  mat4x4f: { size: 64, align: 16 },
};

/** Byte offsets of each member of `struct <name>` in WGSL source, by the WGSL layout rules. */
function structOffsets(source: string, name: string): { offsets: Map<string, number>; size: number } {
  const body = new RegExp(`struct ${name} \\{([^}]*)\\}`).exec(source)?.[1];
  assert.ok(body, `struct ${name} in the WGSL`);
  const offsets = new Map<string, number>();
  let offset = 0;
  let structAlign = 1;
  for (const line of body.split("\n")) {
    const m = /^\s*(\w+)\s*:\s*(\w+)\s*,/.exec(line.replace(/\/\/.*$/, ""));
    if (!m) continue;
    const [, member, type] = m;
    const layout = type ? WGSL_TYPES[type] : undefined;
    assert.ok(member && layout, `a known WGSL type for ${line.trim()}`);
    offset = Math.ceil(offset / layout.align) * layout.align;
    offsets.set(member, offset);
    offset += layout.size;
    structAlign = Math.max(structAlign, layout.align);
  }
  return { offsets, size: Math.ceil(offset / structAlign) * structAlign };
}

test("the WGSL Uniforms struct has exactly the offsets packUniforms writes", () => {
  const { offsets, size } = structOffsets(PAPER_WGSL, "Uniforms");
  assert.deepEqual(
    Object.fromEntries(offsets),
    Object.fromEntries(Object.entries(UNIFORM_OFFSETS).map(([k, floats]) => [k, floats * 4])),
  );
  assert.ok(UNIFORM_FLOATS * 4 >= size, `the buffer holds the struct (${size} bytes)`);
});

test("packUniforms puts each value at its member's offset", () => {
  const viewProj = new Float32Array(16).map((_, i) => i + 1);
  const data = packUniforms({
    viewProj,
    eye: [1, 2, 3],
    light: [0, 1, 0],
    shadow: 0.22,
    desk: [0.1, 0.2, 0.3],
    paper: { w: 148, h: 210 },
  });
  assert.equal(data.length, UNIFORM_FLOATS);
  assert.deepEqual([...data.subarray(0, 16)], [...viewProj]);
  assert.deepEqual([...data.subarray(UNIFORM_OFFSETS.eye, UNIFORM_OFFSETS.eye + 4)], [1, 2, 3, 1]);
  assert.deepEqual([...data.subarray(UNIFORM_OFFSETS.lightDir, UNIFORM_OFFSETS.lightDir + 4)], [0, 1, 0, 0]);
  assert.deepEqual(
    [...data.subarray(UNIFORM_OFFSETS.desk, UNIFORM_OFFSETS.desk + 4)],
    [Math.fround(0.1), Math.fround(0.2), Math.fround(0.3), Math.fround(0.22)],
  );
  assert.deepEqual([...data.subarray(UNIFORM_OFFSETS.paper, UNIFORM_OFFSETS.paper + 2)], [148, 210]);
});

test("the light direction is a unit vector toward the light", () => {
  const overhead = lightDirection(0, 90);
  assert.ok(Math.abs(overhead[1] - 1) < 1e-12);
  const [x, y, z] = lightDirection(215, 52);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-12);
  assert.ok(y > 0, "the light is above the desk");
  assert.ok(x < 0 && z < 0, "an azimuth of 215° lights from behind and to the left");
});
