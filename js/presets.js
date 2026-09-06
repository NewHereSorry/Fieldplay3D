// The gallery. Each preset carries its own bounds, time step, camera and the settings that make it read well.
// `cam.up` picks the camera's up axis; attractors are written z-up like their papers.

const HEAD = `// p: the particle's position. Return its velocity.
// Helpers: noise fbm curl hash3 rotateX/Y/Z (see ?)
// Uniforms: u.time u.cursor u.cursorDown u.bounds…
`;

export const PRESETS = [
  {
    id: 'swirl', name: 'Swirl',
    code: HEAD + `fn get_velocity(p: vec3f) -> vec3f {
  var v = vec3f(0.0);
  v.x = -p.z;
  v.z = p.x;
  v.y = 0.5 * sin(4.0 * length(p.xz) - 2.0 * p.y);
  return v;
}
`,
    box: { c: [0, 0, 0], s: [3, 3, 3] }, dt: 0.01, colorScale: 2, life: 4, cam: { up: 'y', th: 0.7, ph: 0.35 },
  },
  {
    id: 'lorenz', name: 'Lorenz attractor',
    code: `// The classic. sigma, rho, beta as Lorenz wrote them.
fn get_velocity(p: vec3f) -> vec3f {
  let sigma = 10.0;
  let rho = 28.0;
  let beta = 8.0 / 3.0;
  return vec3f(
    sigma * (p.y - p.x),
    p.x * (rho - p.z) - p.y,
    p.x * p.y - beta * p.z);
}
`,
    box: { c: [0, 0, 25], s: [60, 60, 60] }, dt: 0.004, intensity: 0.05, colorScale: 120, life: 4, fade: 0.97,
    cam: { up: 'z', th: 0.9, ph: 0.25, d: 95 },
  },
  {
    id: 'rossler', name: 'Rössler attractor',
    code: `fn get_velocity(p: vec3f) -> vec3f {
  let a = 0.2;
  let b = 0.2;
  let c = 5.7;
  return vec3f(-p.y - p.z, p.x + a * p.y, b + p.z * (p.x - c));
}
`,
    box: { c: [0, 0, 10], s: [34, 34, 34] }, dt: 0.02, intensity: 0.08, colorScale: 18, life: 40,
    cam: { up: 'z', th: 0.8, ph: 0.5 },
  },
  {
    id: 'aizawa', name: 'Aizawa attractor',
    code: `fn get_velocity(p: vec3f) -> vec3f {
  let a = 0.95; let b = 0.7; let c = 0.6;
  let d = 3.5; let e = 0.25; let f = 0.1;
  let x = p.x; let y = p.y; let z = p.z;
  return vec3f(
    (z - b) * x - d * y,
    d * x + (z - b) * y,
    c + a * z - z * z * z / 3.0 - (x * x + y * y) * (1.0 + e * z) + f * z * x * x * x);
}
`,
    box: { c: [0, 0, 0.5], s: [3.6, 3.6, 3.6] }, dt: 0.01, intensity: 0.06, colorScale: 4, life: 12,
    cam: { up: 'z', th: 0.6, ph: 0.3 },
  },
  {
    id: 'thomas', name: 'Thomas attractor',
    code: `// Cyclically symmetric; b close to the chaos threshold.
fn get_velocity(p: vec3f) -> vec3f {
  let b = 0.208186;
  return vec3f(sin(p.y) - b * p.x, sin(p.z) - b * p.y, sin(p.x) - b * p.z);
}
`,
    box: { c: [0, 0, 0], s: [10, 10, 10] }, dt: 0.05, intensity: 0.08, colorScale: 1.3, life: 80, fade: 0.975,
    cam: { up: 'z', th: 0.8, ph: 0.6 },
  },
  {
    id: 'halvorsen', name: 'Halvorsen attractor',
    code: `fn get_velocity(p: vec3f) -> vec3f {
  let a = 1.89;
  let x = p.x; let y = p.y; let z = p.z;
  return vec3f(
    -a * x - 4.0 * y - 4.0 * z - y * y,
    -a * y - 4.0 * z - 4.0 * x - z * z,
    -a * z - 4.0 * x - 4.0 * y - x * x);
}
`,
    box: { c: [-1.5, -1.5, -1.5], s: [26, 26, 26] }, dt: 0.004, intensity: 0.06, colorScale: 70, life: 5,
    cam: { up: 'z', th: 0.7, ph: 0.45 },
  },
  {
    id: 'chen', name: 'Chen attractor',
    code: `fn get_velocity(p: vec3f) -> vec3f {
  let a = 35.0; let b = 3.0; let c = 28.0;
  return vec3f(
    a * (p.y - p.x),
    (c - a) * p.x - p.x * p.z + c * p.y,
    p.x * p.y - b * p.z);
}
`,
    box: { c: [0, 0, 22], s: [60, 60, 60] }, dt: 0.002, intensity: 0.05, colorScale: 500, life: 2.5,
    cam: { up: 'z', th: 0.9, ph: 0.3 },
  },
  {
    id: 'dadras', name: 'Dadras attractor',
    code: `fn get_velocity(p: vec3f) -> vec3f {
  let a = 3.0; let b = 2.7; let c = 1.7; let d = 2.0; let e = 9.0;
  let x = p.x; let y = p.y; let z = p.z;
  return vec3f(y - a * x + b * y * z, c * y - x * z + z, d * x * y - e * z);
}
`,
    box: { c: [0, 0, 0], s: [30, 30, 30] }, dt: 0.005, intensity: 0.06, colorScale: 45, life: 6,
    cam: { up: 'z', th: 0.5, ph: 0.35 },
  },
  {
    id: 'fourwing', name: 'Four-wing attractor',
    code: `fn get_velocity(p: vec3f) -> vec3f {
  let a = 0.2; let b = 0.01; let c = -0.4;
  let x = p.x; let y = p.y; let z = p.z;
  return vec3f(a * x + y * z, b * x + c * y - x * z, -z - x * y);
}
`,
    box: { c: [0, 0, 0], s: [10, 10, 10] }, dt: 0.02, intensity: 0.08, colorScale: 6, life: 30,
    cam: { up: 'z', th: 0.6, ph: 0.4 },
  },
  {
    id: 'abc', name: 'ABC flow',
    code: `// Arnold–Beltrami–Childress: a steady flow with chaotic streamlines.
fn get_velocity(p: vec3f) -> vec3f {
  let A = sqrt(3.0); let B = sqrt(2.0); let C = 1.0;
  return vec3f(
    A * sin(p.z) + C * cos(p.y),
    B * sin(p.x) + A * cos(p.z),
    C * sin(p.y) + B * cos(p.x));
}
`,
    box: { c: [0, 0, 0], s: [12.6, 12.6, 12.6] }, dt: 0.02, colorScale: 3.2, life: 10,
    cam: { up: 'y', th: 0.6, ph: 0.3 },
  },
  {
    id: 'curl', name: 'Curl noise',
    code: `// Divergence-free noise at two scales, drifting with time.
fn get_velocity(p: vec3f) -> vec3f {
  let q = p * 0.6 + vec3f(0.0, u.time * 0.1, 0.0);
  return curl(q) * 1.6 + curl(p * 2.2 + vec3f(7.0)) * 0.35;
}
`,
    box: { c: [0, 0, 0], s: [6, 6, 6] }, dt: 0.02, intensity: 0.06, colorScale: 4, life: 8, palette: 2,
    cam: { up: 'y', th: 0.5, ph: 0.25 },
  },
  {
    id: 'tornado', name: 'Tornado',
    code: `// Swirl around the y axis, in at the floor, up the core, out at the top.
fn get_velocity(p: vec3f) -> vec3f {
  let r = max(length(p.xz), 0.02);
  let h = (p.y - u.boundsMin.y) / (u.boundsMax.y - u.boundsMin.y);
  let t = vec2f(-p.z, p.x) / r;
  let swirl = 2.5 / (r + 0.25);
  let vr = -0.5 * (1.0 - h) * (1.0 - exp(-r)) + 0.35 * h * r;
  let up = 1.3 * exp(-1.5 * r) - 0.15;
  return vec3f(t.x * swirl + p.x / r * vr, up, t.y * swirl + p.z / r * vr);
}
`,
    box: { c: [0, 0, 0], s: [5, 4, 5] }, dt: 0.01, colorScale: 5, life: 6, palette: 1,
    cam: { up: 'y', th: 0.5, ph: 0.2 },
  },
  {
    id: 'dipole', name: 'Magnetic dipole',
    code: `// Field lines of a dipole pointing up, walked at a steady pace.
fn get_velocity(p: vec3f) -> vec3f {
  let m = vec3f(0.0, 1.0, 0.0);
  let r2 = max(dot(p, p), 1e-6);
  let n = p * inverseSqrt(r2);
  let B = (3.0 * dot(m, n) * n - m) / max(r2 * sqrt(r2), 0.001);
  return B / (length(B) + 0.15);
}
`,
    box: { c: [0, 0, 0], s: [5, 5, 5] }, dt: 0.02, colorMode: 2, life: 14, spawn: 1,
    cam: { up: 'y', th: 0.5, ph: 0.15 },
  },
  {
    id: 'ring', name: 'Vortex ring',
    code: `// Circulation around a ring of radius R, with a slow twist along it.
fn get_velocity(p: vec3f) -> vec3f {
  let R = 1.0;
  let rho = max(length(p.xz), 1e-4);
  let c = vec3f(p.x, 0.0, p.z) * (R / rho);
  let t = vec3f(-p.z, 0.0, p.x) / rho;
  let d = p - c;
  return cross(t, d) * (0.6 / (dot(d, d) + 0.04)) + t * 0.12;
}
`,
    box: { c: [0, 0, 0], s: [4, 3, 4] }, dt: 0.01, colorScale: 3, life: 10, palette: 2,
    cam: { up: 'y', th: 0.6, ph: 0.35 },
  },
  {
    id: 'helix', name: 'Helix',
    code: `fn get_velocity(p: vec3f) -> vec3f {
  return vec3f(-p.z, 0.6, p.x);
}
`,
    box: { c: [0, 0, 0], s: [3, 4, 3] }, dt: 0.01, colorMode: 0, color: '#7ad0ff', life: 7,
    cam: { up: 'y', th: 0.6, ph: 0.25 },
  },
  {
    id: 'saddle', name: 'Saddle',
    code: `// Contract along y, expand in the plane. Divergence-free.
fn get_velocity(p: vec3f) -> vec3f {
  return vec3f(p.x, -2.0 * p.y, p.z);
}
`,
    box: { c: [0, 0, 0], s: [3, 3, 3] }, dt: 0.01, colorScale: 3, life: 4, spawn: 1,
    cam: { up: 'y', th: 0.6, ph: 0.3 },
  },
  {
    id: 'charges', name: 'Point charges',
    code: `fn charge(p: vec3f, c: vec3f, q: f32) -> vec3f {
  let d = p - c;
  let r2 = dot(d, d);
  return d * (q / (r2 * sqrt(r2) + 0.002));
}
fn get_velocity(p: vec3f) -> vec3f {
  let E = charge(p, vec3f(-1.0, 0.0, 0.0), 1.0)
        + charge(p, vec3f(1.0, 0.0, 0.0), -1.0)
        + charge(p, vec3f(0.0, 1.2, 0.0), 0.5)
        + charge(p, vec3f(0.0, -1.2, 0.0), -0.5);
  return E / (length(E) + 0.2);
}
`,
    box: { c: [0, 0, 0], s: [5, 5, 5] }, dt: 0.015, colorMode: 2, life: 12,
    cam: { up: 'y', th: 0.4, ph: 0.2 },
  },
  {
    id: 'cursor', name: 'Cursor pull',
    code: `// Hold the mouse button to pull the flow toward the cursor.
fn get_velocity(p: vec3f) -> vec3f {
  let d = u.cursor - p;
  let pull = d * (3.0 * u.cursorDown / (dot(d, d) + 0.3));
  return vec3f(-p.z, 0.0, p.x) * 0.4 + pull + curl(p * 1.5) * 0.3;
}
`,
    box: { c: [0, 0, 0], s: [4, 4, 4] }, dt: 0.02, colorScale: 2, life: 6,
    cam: { up: 'y', th: 0.3, ph: 0.2 },
  },
  {
    id: 'ripples', name: 'Ripples',
    code: `// A spherical wave breathing in and out, with a slow spin.
fn get_velocity(p: vec3f) -> vec3f {
  let r = length(p);
  let n = p / max(r, 1e-5);
  return n * sin(6.0 * r - 3.0 * u.time) + vec3f(-p.z, 0.0, p.x) * 0.3;
}
`,
    box: { c: [0, 0, 0], s: [4, 4, 4] }, dt: 0.02, colorScale: 1.4, life: 6, palette: 3, spawn: 1,
    cam: { up: 'y', th: 0.5, ph: 0.3 },
  },
];

export const byId = id => PRESETS.find(p => p.id === id);
