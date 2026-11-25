/**
 * WGSL for the paper view. The paper is deformed on the CPU (deform.ts,
 * `deformAttributes`): each vertex arrives with its world position, the
 * printed side's normal, and its crease factor, so the vertex stages only
 * transform. The `Uniforms` struct mirrors `UNIFORM_OFFSETS` in uniforms.ts
 * (a test checks every offset).
 */

export const PAPER_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj: mat4x4f,
  eye: vec4f,
  lightDir: vec4f,   // xyz: direction toward the light
  desk: vec4f,       // rgb: the desk; a: how much the shadow darkens it
  paper: vec4f,      // xy: the sheet's width and height in mm
};

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var pageTex: texture_2d<f32>;
@group(0) @binding(2) var pageSampler: sampler;

struct PaperIn {
  @location(0) uv: vec2f,
  @location(1) position: vec3f,
  @location(2) normal: vec3f,   // printed side; +Y when flat
  @location(3) crease: f32,
};

struct PaperOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) world: vec3f,
  @location(3) crease: f32,
};

@vertex
fn vsPaper(in: PaperIn) -> PaperOut {
  var out: PaperOut;
  out.position = U.viewProj * vec4f(in.position, 1.0);
  out.uv = in.uv;
  out.normal = in.normal;
  out.world = in.position;
  out.crease = in.crease;
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
  let mm = in.uv * U.paper.xy;
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
fn vsShadow(in: PaperIn) -> ShadowOut {
  let l = normalize(U.lightDir.xyz);
  // Project onto the desk (y = 0) along the light.
  let onDesk = in.position - l * (in.position.y / max(l.y, 0.05));
  var out: ShadowOut;
  out.position = U.viewProj * vec4f(onDesk.x, 0.0, onDesk.z, 1.0);
  return out;
}

@fragment
fn fsShadow() -> @location(0) vec4f {
  // Blended with "min", so overlapping folds darken the desk only once.
  return vec4f(U.desk.rgb * (1.0 - U.desk.a), 1.0);
}
`;
