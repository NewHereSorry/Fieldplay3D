// WGSL sources. The compute shader is a template around the user's field code; the render/display
// shaders are fixed. Uniform structs are declared once in layout.js and printed into the WGSL here.
import { layout } from './layout.js';

export const WORKGROUP = 256;

export const SIM = layout('Uniforms', [
  ['boundsMin', 'vec3f'], ['dt', 'f32'],
  ['boundsMax', 'vec3f'], ['time', 'f32'],
  ['cursor', 'vec3f'], ['frame', 'f32'],
  ['color', 'vec3f'], ['dropProb', 'f32'],
  ['count', 'u32'], ['integrator', 'u32'], ['colorMode', 'u32'], ['seed', 'u32'],
  ['speed', 'f32'], ['minLife', 'f32'], ['maxLife', 'f32'], ['substep', 'u32'],
  ['cursorDown', 'f32'], ['colorScale', 'f32'], ['palette', 'u32'], ['reset', 'u32'],
  ['spawn', 'u32'], ['fadeLife', 'f32'], ['beat', 'f32'], ['phase', 'f32'],
  ['audio', 'vec4f'],
  ['bpm', 'f32'], ['pad0', 'f32'], ['pad1', 'f32'], ['pad2', 'f32'],
]);

export const REN = layout('RenderUniforms', [
  ['viewProj', 'mat4x4f'],
  ['eye', 'vec3f'], ['fog', 'f32'],
  ['viewport', 'vec2f'], ['width', 'f32'], ['intensity', 'f32'],
  ['persp', 'f32'], ['fogRef', 'f32'], ['pad0', 'f32'], ['pad1', 'f32'],
]);

export const DISP = layout('DisplayUniforms', [
  ['bg', 'vec3f'], ['exposure', 'f32'],
  ['fade', 'f32'], ['eps', 'f32'], ['gamma', 'f32'], ['pad', 'f32'],
]);

export const BOX = layout('BoxUniforms', [
  ['viewProj', 'mat4x4f'],
  ['bmin', 'vec3f'], ['alpha', 'f32'],
  ['bmax', 'vec3f'], ['ink', 'f32'],
]);

// ---------------------------------------------------------------------------------------------
// Library available to the user's field code (documented in the help sheet — keep them in sync).
export const LIB = /* wgsl */`
const PI = 3.141592653589793;
const TAU = 6.283185307179586;

fn pcg3d(vIn: vec3u) -> vec3u {
  var v = vIn * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
// Three uniform randoms in [0,1) from three integers.
fn rand3(a: u32, b: u32, c: u32) -> vec3f {
  return vec3f(pcg3d(vec3u(a, b, c))) * (1.0 / 4294967296.0);
}
// Lattice hash: a pseudo-random vec3 in [-1,1]^3 per integer cell of p.
fn hash3(p: vec3f) -> vec3f {
  let h = pcg3d(bitcast<vec3u>(vec3i(floor(p))));
  return vec3f(h) * (2.0 / 4294967296.0) - 1.0;
}
fn hash1(p: vec3f) -> f32 { return hash3(p).x; }

// Gradient noise with its analytic gradient: x = value, yzw = d/dp. Roughly [-1, 1].
fn noised(x: vec3f) -> vec4f {
  let i = floor(x); let w = fract(x);
  let u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  let du = 30.0 * w * w * (w * (w - 2.0) + 1.0);
  let ga = hash3(i + vec3f(0.0, 0.0, 0.0));
  let gb = hash3(i + vec3f(1.0, 0.0, 0.0));
  let gc = hash3(i + vec3f(0.0, 1.0, 0.0));
  let gd = hash3(i + vec3f(1.0, 1.0, 0.0));
  let ge = hash3(i + vec3f(0.0, 0.0, 1.0));
  let gf = hash3(i + vec3f(1.0, 0.0, 1.0));
  let gg = hash3(i + vec3f(0.0, 1.0, 1.0));
  let gh = hash3(i + vec3f(1.0, 1.0, 1.0));
  let va = dot(ga, w - vec3f(0.0, 0.0, 0.0));
  let vb = dot(gb, w - vec3f(1.0, 0.0, 0.0));
  let vc = dot(gc, w - vec3f(0.0, 1.0, 0.0));
  let vd = dot(gd, w - vec3f(1.0, 1.0, 0.0));
  let ve = dot(ge, w - vec3f(0.0, 0.0, 1.0));
  let vf = dot(gf, w - vec3f(1.0, 0.0, 1.0));
  let vg = dot(gg, w - vec3f(0.0, 1.0, 1.0));
  let vh = dot(gh, w - vec3f(1.0, 1.0, 1.0));
  let k1 = vb - va; let k2 = vc - va; let k3 = ve - va;
  let k4 = va - vb - vc + vd; let k5 = va - vc - ve + vg; let k6 = va - vb - ve + vf;
  let k7 = -va + vb + vc - vd + ve - vf - vg + vh;
  let v = va + u.x * k1 + u.y * k2 + u.z * k3 + u.x * u.y * k4 + u.y * u.z * k5 + u.z * u.x * k6 + u.x * u.y * u.z * k7;
  let g = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga)
        + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg) + u.z * u.x * (ga - gb - ge + gf)
        + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
        + du * vec3f(k1 + u.y * k4 + u.z * k6 + u.y * u.z * k7,
                     k2 + u.x * k4 + u.z * k5 + u.x * u.z * k7,
                     k3 + u.y * k5 + u.x * k6 + u.x * u.y * k7);
  return vec4f(v * 1.6, g * 1.6);
}
fn noise(p: vec3f) -> f32 { return noised(p).x; }
fn fbm(p0: vec3f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.02 + vec3f(3.1, 1.7, 5.3); a *= 0.5; }
  return s;
}
// Divergence-free noise: the curl of a vector potential made of three noise fields.
fn curl(p: vec3f) -> vec3f {
  let a = noised(p).yzw;
  let b = noised(p + vec3f(31.416, -47.853, 12.793)).yzw;
  let c = noised(p + vec3f(-233.145, 87.29, -158.55)).yzw;
  return vec3f(c.y - b.z, a.z - c.x, b.x - a.y);
}
fn rotateX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
fn rotateY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn rotateZ(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
fn hsv2rgb(c: vec3f) -> vec3f {
  let k = vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0);
  let p = abs(fract(c.xxx + k) * 6.0 - 3.0);
  return c.z * mix(vec3f(1.0), clamp(p - 1.0, vec3f(0.0), vec3f(1.0)), c.y);
}
fn turbo(t0: f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  let v4 = vec4f(1.0, t, t * t, t * t * t);
  let v2 = v4.zw * v4.z;
  return vec3f(
    dot(v4, vec4f(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2f(-152.94239396, 59.28637943)),
    dot(v4, vec4f(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2f(4.27729857, 2.82956604)),
    dot(v4, vec4f(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2f(-89.90310912, 27.34824973)));
}
fn viridis(t0: f32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  let c0 = vec3f(0.2777273272234177, 0.005407344544966578, 0.3340998053353061);
  let c1 = vec3f(0.1050930431085774, 1.404613529898575, 1.384590162594685);
  let c2 = vec3f(-0.3308618287255563, 0.214847559468213, 0.09509516302823659);
  let c3 = vec3f(-4.634230498983486, -5.799100973351585, -19.33244095627987);
  let c4 = vec3f(6.228269936347081, 14.17993336680509, 56.69055260068105);
  let c5 = vec3f(4.776384997670288, -13.74514537774601, -65.35303263337234);
  let c6 = vec3f(-5.435455855934631, 4.645852612178535, 26.3124352495832);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}
// 0 turbo · 1 fire · 2 ice · 3 hue · 4 viridis · 5 grey
fn palette(t0: f32, k: u32) -> vec3f {
  let t = clamp(t0, 0.0, 1.0);
  switch k {
    case 0u: { return turbo(t); }
    case 1u: { return vec3f(pow(t, 0.5), pow(t, 1.6), pow(t, 4.0)); }
    case 2u: { return vec3f(pow(t, 3.0), pow(t, 1.4), pow(t, 0.6)); }
    case 3u: { return hsv2rgb(vec3f(0.72 - 0.72 * t, 0.9, 1.0)); }
    case 4u: { return viridis(t); }
    default: { return vec3f(t); }
  }
}
`;

const SIM_PREFIX = /* wgsl */`${SIM.wgsl}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;   // xyz, age
@group(0) @binding(2) var<storage, read_write> prev: array<vec4f>;  // xyz at frame start, lifespan
@group(0) @binding(3) var<storage, read_write> col: array<vec4f>;   // rgb, alpha
${LIB}
// ---- your field ----
`;

const SIM_SUFFIX = /* wgsl */`
// ---- end of your field ----

fn field(p: vec3f) -> vec3f { return get_velocity(p) * u.speed; }

fn advance(p: vec3f, k1: vec3f, dt: f32) -> vec3f {
  switch u.integrator {
    case 0u: { return p + k1 * dt; }
    case 1u: { return p + field(p + k1 * (0.5 * dt)) * dt; }
    default: {
      let k2 = field(p + k1 * (0.5 * dt));
      let k3 = field(p + k2 * (0.5 * dt));
      let k4 = field(p + k3 * dt);
      return p + (k1 + 2.0 * (k2 + k3) + k4) * (dt / 6.0);
    }
  }
}

fn shade(p: vec3f, v: vec3f) -> vec3f {
  switch u.colorMode {
    case 0u: { return u.color; }
    case 1u: { return palette(length(v) / u.colorScale, u.palette); }
    case 2u: { return normalize(v + vec3f(1e-12, 0.0, 0.0)) * 0.5 + 0.5; }
    case 3u: { return get_color(p, v); }
    default: { return u.color; }
  }
}

fn spawnPoint(r: vec3f) -> vec3f {
  let c = (u.boundsMin + u.boundsMax) * 0.5;
  let h = (u.boundsMax - u.boundsMin) * 0.5;
  switch u.spawn {
    case 1u: {  // ball
      let z = r.x * 2.0 - 1.0; let a = r.y * TAU; let s = sqrt(1.0 - z * z);
      return c + vec3f(s * cos(a), s * sin(a), z) * h * pow(r.z, 1.0 / 3.0);
    }
    case 2u: {  // shell
      let z = r.x * 2.0 - 1.0; let a = r.y * TAU; let s = sqrt(1.0 - z * z);
      return c + vec3f(s * cos(a), s * sin(a), z) * h * 0.95;
    }
    default: { return mix(u.boundsMin, u.boundsMax, r); }
  }
}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let r = rand3(i, u.seed, 0x9E3779B9u);
  let P = pos[i]; let Q = prev[i];
  var p = P.xyz; var age = P.w; var life = Q.w;
  var q = select(Q.xyz, p, u.substep == 0u);
  var v = vec3f(0.0);
  var respawn = u.reset == 1u;
  if (!respawn) {
    v = field(p);
    let np = advance(p, v, u.dt);
    age += u.dt;
    respawn = age >= life || any(np < u.boundsMin) || any(np > u.boundsMax) || r.x < u.dropProb || !(dot(np, np) < 1e30);
    if (!respawn) { p = np; }
  }
  if (respawn) {
    let r2 = rand3(i ^ 0x5bd1e995u, u.seed, 0x27d4eb2fu);
    p = spawnPoint(r2);
    life = mix(u.minLife, u.maxLife, r.z);
    age = select(0.0, r.y * life, u.reset == 1u);
    q = p;
    v = field(p);
  }
  let ft = life * u.fadeLife;
  let a = clamp(age / ft, 0.0, 1.0) * clamp((life - age) / ft, 0.0, 1.0);
  pos[i] = vec4f(p, age);
  prev[i] = vec4f(q, life);
  col[i] = vec4f(shade(p, v), a);
}
`;

const DEFAULT_COLOR = /* wgsl */`
fn get_color(p: vec3f, v: vec3f) -> vec3f { return u.color; }
`;

export const PREFIX_LINES = SIM_PREFIX.split('\n').length - 1;

// The compute shader around the user's code. Adds a default get_color when the user has none.
export function simSource(userCode) {
  const hasColor = /\bfn\s+get_color\s*\(/.test(userCode);
  return SIM_PREFIX + userCode + '\n' + (hasColor ? '' : DEFAULT_COLOR) + SIM_SUFFIX;
}

// ---------------------------------------------------------------------------------------------
export const RENDER = /* wgsl */`${REN.wgsl}
@group(0) @binding(0) var<uniform> r: RenderUniforms;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> prev: array<vec4f>;
@group(0) @binding(3) var<storage, read> col: array<vec4f>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
  @location(1) q: vec2f,
  @location(2) len: f32,
  @location(3) half: f32,
}

fn tint(i: u32, p: vec3f) -> vec4f {
  let c = col[i];
  let d = distance(p, r.eye);
  let s = c.a * r.intensity * exp(-r.fog * (d / r.fogRef - 1.0));
  return vec4f(clamp(c.rgb, vec3f(0.0), vec3f(1.0)) * s, s);   // rgb = light, a = coverage
}

@vertex fn vsLine(@builtin(vertex_index) vi: u32) -> VOut {
  let i = vi >> 1u;
  let cur = pos[i].xyz;
  let p = select(prev[i].xyz, cur, (vi & 1u) == 1u);
  var o: VOut;
  o.pos = r.viewProj * vec4f(p, 1.0);
  o.color = tint(i, cur);
  return o;
}

@vertex fn vsPoint(@builtin(vertex_index) vi: u32) -> VOut {
  let p = pos[vi].xyz;
  var o: VOut;
  o.pos = r.viewProj * vec4f(p, 1.0);
  o.color = tint(vi, p);
  return o;
}

// A screen-space capsule from the frame-start position to the current one, width in pixels.
@vertex fn vsQuad(@builtin(vertex_index) k: u32, @builtin(instance_index) i: u32) -> VOut {
  let cur = pos[i].xyz;
  let a = r.viewProj * vec4f(prev[i].xyz, 1.0);
  let b = r.viewProj * vec4f(cur, 1.0);
  var o: VOut;
  if (a.w <= 0.0 || b.w <= 0.0) { o.pos = vec4f(0.0, 0.0, 2.0, 1.0); return o; }
  let hv = r.viewport * 0.5;
  let A = a.xy / a.w * hv;
  let B = b.xy / b.w * hv;
  let w = clamp(r.width * select(1.0, r.fogRef / b.w, r.persp > 0.5), 1.0, 96.0);
  let h = w * 0.5;
  let d = B - A;
  let L = length(d);
  let dir = select(vec2f(1.0, 0.0), d / L, L > 1e-5);
  let n = vec2f(-dir.y, dir.x);
  let along = f32(k == 2u || k == 3u || k == 5u);
  let side = select(1.0, -1.0, k == 1u || k == 4u || k == 5u);
  let px = mix(A - dir * h, B + dir * h, along) + n * (side * h);
  o.pos = vec4f(px / hv, 0.5, 1.0);
  o.q = vec2f(mix(-h, L + h, along), side * h);
  o.len = L;
  o.half = h;
  o.color = tint(i, cur);
  return o;
}

@fragment fn fsFlat(in: VOut) -> @location(0) vec4f { return in.color; }

@fragment fn fsQuad(in: VOut) -> @location(0) vec4f {
  let dseg = length(vec2f(max(0.0, max(-in.q.x, in.q.x - in.len)), in.q.y));
  return in.color * clamp(in.half + 0.5 - dseg, 0.0, 1.0);
}
`;

export const DISPLAY = /* wgsl */`${DISP.wgsl}
@group(0) @binding(0) var<uniform> d: DisplayUniforms;
@group(0) @binding(1) var tex: texture_2d<f32>;

struct FS { @builtin(position) pos: vec4f }

@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> FS {
  var o: FS;
  let x = f32((vi << 1u) & 2u); let y = f32(vi & 2u);
  o.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  return o;
}

// Trail persistence: last frame dimmed, with a floor so nothing lingers as a ghost.
@fragment fn fsFade(in: FS) -> @location(0) vec4f {
  let c = textureLoad(tex, vec2i(in.pos.xy), 0);
  return max(vec4f(0.0), c * d.fade - d.eps);
}

// Trail → pixels. On a dark background the trail is light (exposure tone map, screened over the
// background); on a light one it is ink: the trail's mean colour laid down with its coverage (alpha).
@fragment fn fsDisplay(in: FS) -> @location(0) vec4f {
  let L = max(vec4f(0.0), textureLoad(tex, vec2i(in.pos.xy), 0));
  let light = 1.0 - exp(-L.rgb * d.exposure);
  let cov = 1.0 - exp(-L.a * d.exposure);
  let ink = clamp(L.rgb / max(L.a, 1e-6), vec3f(0.0), vec3f(1.0));
  let paper = smoothstep(0.25, 0.6, dot(d.bg, vec3f(0.2126, 0.7152, 0.0722)));
  let o = mix(d.bg + light * (1.0 - d.bg), mix(d.bg, ink, cov), paper);
  return vec4f(pow(clamp(o, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / d.gamma)), 1.0);
}
`;

export const BOXWIRE = /* wgsl */`${BOX.wgsl}
@group(0) @binding(0) var<uniform> b: BoxUniforms;

struct VO { @builtin(position) pos: vec4f, @location(0) a: f32 }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  // 12 edges of the unit cube as 24 corner indices, bit i of the index = axis i.
  let E = array<u32, 24>(0u,1u, 1u,3u, 3u,2u, 2u,0u, 4u,5u, 5u,7u, 7u,6u, 6u,4u, 0u,4u, 1u,5u, 2u,6u, 3u,7u);
  let c = E[vi];
  let s = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u));
  var o: VO;
  o.pos = b.viewProj * vec4f(mix(b.bmin, b.bmax, s), 1.0);
  o.a = b.alpha;
  return o;
}
@fragment fn fs(in: VO) -> @location(0) vec4f { return vec4f(vec3f(1.0 - b.ink), in.a); }
`;
