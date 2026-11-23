/**
 * WGSL for the paper view. `deform` mirrors `lib/paper/deform.ts` exactly;
 * keep the two in step (the TypeScript copy is what the tests and picking use).
 */

import {
  CREASE_BOTTOM,
  CREASE_TOP,
  CURL_DIR,
  CURL_MAX_DEPTH,
  CURL_RADIUS,
  HINGE_BOTTOM,
  HINGE_TOP,
  PAPER_H,
  PAPER_W,
} from "./deform.ts";

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

export const PAPER_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj: mat4x4f,
  eye: vec4f,
  lightDir: vec4f,   // xyz: direction toward the light
  pose: vec4f,       // foldBottom, foldTop, curl, shadow strength
  desk: vec4f,       // desk rgb, unused
};

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var pageTex: texture_2d<f32>;
@group(0) @binding(2) var pageSampler: sampler;

const PI = 3.14159265358979;
const PAPER = vec2f(${f(PAPER_W)}, ${f(PAPER_H)});
const HINGE_TOP = ${f(HINGE_TOP)};
const HINGE_BOTTOM = ${f(HINGE_BOTTOM)};
const CREASE_TOP = ${f(CREASE_TOP)};
const CREASE_BOTTOM = ${f(CREASE_BOTTOM)};
const CURL_RADIUS = ${f(CURL_RADIUS)};
const CURL_DIR = vec2f(${CURL_DIR[0]}, ${CURL_DIR[1]});
const CURL_MAX_DEPTH = ${f(CURL_MAX_DEPTH)};

// (along, height, onCrease) after bending around a rounded crease.
fn bend(d: f32, h: f32, alpha: f32, r: f32) -> vec3f {
  let arcLen = r * alpha;
  let a = min(d, arcLen);
  let phi = a / r;
  let tail = max(0.0, d - arcLen);
  let along = r * sin(phi) + tail * cos(alpha) - h * sin(phi);
  let height = r * (1.0 - cos(phi)) + tail * sin(alpha) + h * cos(phi);
  return vec3f(along, height, select(0.0, 1.0, d < arcLen && alpha > 0.001));
}

// World position (xyz) and crease factor (w) for paper uv.
fn deform(uv: vec2f) -> vec4f {
  var p = uv * PAPER;
  var h = 0.0;
  var crease = 0.0;
  let curl = U.pose.z;
  if (curl > 0.0) {
    let line = PAPER - CURL_DIR * (clamp(curl, 0.0, 1.0) * CURL_MAX_DEPTH);
    let s = dot(p - line, CURL_DIR);
    if (s > 0.0) {
      var s2 = 0.0;
      if (s <= PI * CURL_RADIUS) {
        s2 = CURL_RADIUS * sin(s / CURL_RADIUS);
        h = CURL_RADIUS * (1.0 - cos(s / CURL_RADIUS));
        crease = 0.35;
      } else {
        s2 = -(s - PI * CURL_RADIUS);
        h = 2.0 * CURL_RADIUS;
      }
      p = p + CURL_DIR * (s2 - s);
    }
  }
  if (U.pose.x > 0.0 && p.y > HINGE_BOTTOM) {
    let b = bend(p.y - HINGE_BOTTOM, h, U.pose.x * PI, CREASE_BOTTOM);
    p.y = HINGE_BOTTOM + b.x;
    h = b.y;
    crease = max(crease, b.z);
  }
  if (U.pose.y > 0.0 && p.y < HINGE_TOP) {
    let b = bend(HINGE_TOP - p.y, h, U.pose.y * PI, CREASE_TOP);
    p.y = HINGE_TOP - b.x;
    h = b.y;
    crease = max(crease, b.z);
  }
  return vec4f(p.x - PAPER.x * 0.5, h, p.y - PAPER.y * 0.5, crease);
}

struct PaperOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) world: vec3f,
  @location(3) crease: f32,
};

@vertex
fn vsPaper(@location(0) uv: vec2f) -> PaperOut {
  let d = deform(uv);
  let e = vec2f(0.0015, 0.0);
  let du = deform(uv + e.xy).xyz - deform(uv - e.xy).xyz;
  let dv = deform(uv + e.yx).xyz - deform(uv - e.yx).xyz;
  var out: PaperOut;
  out.position = U.viewProj * vec4f(d.xyz, 1.0);
  out.uv = uv;
  out.normal = normalize(cross(dv, du)); // printed side; +Y when flat
  out.world = d.xyz;
  out.crease = d.w;
  return out;
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let t = fract(p);
  let s = t * t * (3.0 - 2.0 * t);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), s.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), s.x), s.y);
}

@fragment
fn fsPaper(in: PaperOut) -> @location(0) vec4f {
  let page = textureSample(pageTex, pageSampler, in.uv).rgb;
  let view = normalize(U.eye.xyz - in.world);
  var n = normalize(in.normal);
  let front = dot(n, view) > 0.0;
  if (!front) { n = -n; }
  let mm = in.uv * PAPER;
  let grain = noise(mm * 0.9) * 0.5 + noise(mm * 3.7) * 0.3 + noise(vec2f(mm.x * 0.35, mm.y * 5.0)) * 0.2;
  n = normalize(n + vec3f(noise(mm * 2.3) - 0.5, 0.0, noise(mm * 2.3 + 17.0) - 0.5) * 0.035);
  let l = normalize(U.lightDir.xyz);
  let diffuse = max(dot(n, l), 0.0);
  let halfway = normalize(l + view);
  let specular = pow(max(dot(n, halfway), 0.0), 40.0) * 0.05;
  var albedo = select(vec3f(0.925, 0.915, 0.885), page, front);
  albedo = albedo * (0.965 + grain * 0.06);
  let ao = 1.0 - in.crease * 0.22;
  let lit = albedo * (0.42 + 0.62 * diffuse) * ao + vec3f(specular);
  return vec4f(lit, 1.0);
}

struct ShadowOut {
  @builtin(position) position: vec4f,
};

@vertex
fn vsShadow(@location(0) uv: vec2f) -> ShadowOut {
  let d = deform(uv).xyz;
  let l = normalize(U.lightDir.xyz);
  // Project onto the desk (y = 0) along the light.
  let onDesk = d - l * (d.y / max(l.y, 0.05));
  var out: ShadowOut;
  out.position = U.viewProj * vec4f(onDesk.x, 0.0, onDesk.z, 1.0);
  return out;
}

@fragment
fn fsShadow() -> @location(0) vec4f {
  // Blended with "min", so overlapping folds darken the desk only once.
  return vec4f(U.desk.rgb * (1.0 - U.pose.w), 1.0);
}
`;
