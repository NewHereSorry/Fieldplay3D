// The settings model: defaults, the schema the panel is built from, preset application, and the
// share-link codec (JSON → deflate → base64url in the URL hash).
import { PRESETS } from './presets.js';

export const DEFAULTS = {
  preset: 'swirl', code: PRESETS[0].code,
  count: 18, dt: 0.01, speed: 1, substeps: 1, integrator: 2, life: 3, drop: 0, spawn: 0,
  fade: 0.96, fadeMoving: 0.8, shape: 0, width: 3, persp: 1, intensity: 0.12, exposure: 1.2, fog: 0.6,
  colorMode: 1, palette: 0, colorScale: 2, color: '#ffb347', bg: '#000000',
  box: { c: [0, 0, 0], s: [3, 3, 3] }, showBox: 1, autoRotate: 0, upAxis: 0,
  cursorMode: 1, cursorForce: 1.5, cursorRadius: 0.3,
  pulseSource: 0, pulseOn: false, pulseUrl: 'http://localhost:5226', pulseOffset: 0, pulseDrive: 0, pulseSpeed: 1.5, pulseGlow: 0.8, pulseZoom: 0.25,
  cam: null,
};

// Keys a preset may override (everything but code/box/cam, which it always sets).
const PRESET_KEYS = ['dt', 'speed', 'substeps', 'integrator', 'life', 'drop', 'spawn', 'fade', 'shape', 'width', 'intensity', 'exposure', 'fog', 'colorMode', 'palette', 'colorScale', 'color', 'bg', 'cursorMode', 'cursorForce', 'cursorRadius', 'pulseDrive', 'pulseSpeed', 'pulseGlow', 'pulseZoom'];

const trail = { to: x => 1 - 0.5 * (1 - x) ** 3, from: f => 1 - Math.cbrt(2 * (1 - f)) };
const fmt3 = v => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toPrecision(3).replace(/\.?0+$/, '');

export const SCHEMA = [
  { group: 'Particles' },
  { key: 'count', label: 'Count', type: 'range', min: 10, max: 22, step: 1, fmt: v => (1 << v).toLocaleString() },
  { key: 'dt', label: 'Time step', type: 'range', min: 0.0002, max: 0.2, log: true, fmt: v => v.toPrecision(2) },
  { key: 'speed', label: 'Speed', type: 'range', min: 0.05, max: 20, log: true, fmt: fmt3 },
  { key: 'substeps', label: 'Steps per frame', type: 'range', min: 1, max: 8, step: 1 },
  { key: 'integrator', label: 'Integrator', type: 'select', options: ['Euler', 'Midpoint', 'Runge–Kutta 4'] },
  { key: 'life', label: 'Lifetime', type: 'range', min: 0.1, max: 200, log: true, fmt: fmt3 },
  { key: 'drop', label: 'Drop probability', type: 'range', min: 0, max: 0.05, step: 0.0005, fmt: v => v.toFixed(4) },
  { key: 'spawn', label: 'Spawn in', type: 'select', options: ['Box', 'Ball', 'Shell'] },
  { group: 'Look' },
  { key: 'fade', label: 'Trail length', type: 'range', min: 0, max: 1, step: 0.001, map: trail, fmt: v => v.toFixed(3) },
  { key: 'fadeMoving', label: 'Trail while orbiting', type: 'range', min: 0, max: 1, step: 0.001, map: trail, fmt: v => v.toFixed(3) },
  { key: 'shape', label: 'Shape', type: 'select', options: ['Streaks', 'Points', 'Soft strokes'] },
  { key: 'width', label: 'Stroke width', type: 'range', min: 1, max: 24, step: 0.5, show: S => S.shape === 2, fmt: v => v + ' px' },
  { key: 'persp', label: 'Perspective width', type: 'check', show: S => S.shape === 2 },
  { key: 'intensity', label: 'Intensity', type: 'range', min: 0.01, max: 4, log: true, fmt: fmt3 },
  { key: 'exposure', label: 'Exposure', type: 'range', min: 0.1, max: 8, log: true, fmt: fmt3 },
  { key: 'fog', label: 'Depth fade', type: 'range', min: 0, max: 3, step: 0.05 },
  { group: 'Colour' },
  { key: 'colorMode', label: 'Colour by', type: 'select', options: ['Uniform', 'Speed', 'Direction', 'get_color()'] },
  { key: 'palette', label: 'Palette', type: 'select', options: ['Turbo', 'Fire', 'Ice', 'Hue', 'Viridis', 'Grey'], show: S => S.colorMode === 1 },
  { key: 'colorScale', label: 'Full-scale speed', type: 'range', min: 0.01, max: 2000, log: true, show: S => S.colorMode === 1, fmt: fmt3 },
  { key: 'color', label: 'Colour', type: 'color', show: S => S.colorMode === 0 || S.colorMode === 3 },
  { key: 'bg', label: 'Background', type: 'color' },
  { group: 'Cursor' },
  { key: 'cursorMode', label: 'Left button', type: 'select', options: ['Does nothing', 'Pulls', 'Pushes', 'Swirls'] },
  { key: 'cursorNote', type: 'note', text: 'Middle button does the opposite. Right-drag orbits.', show: S => S.cursorMode > 0 },
  { key: 'cursorForce', label: 'Strength', type: 'range', min: 0.1, max: 8, log: true, show: S => S.cursorMode > 0, fmt: fmt3 },
  { key: 'cursorRadius', label: 'Reach', type: 'range', min: 0.02, max: 1.5, step: 0.01, show: S => S.cursorMode > 0, fmt: v => v.toFixed(2) },
  { group: 'Pulse' },
  { key: 'pulseSource', label: 'Sync to', type: 'select', options: ['Off', 'Aux Cord bot', 'Shared audio', 'Microphone'] },
  { key: 'pulseStart', label: 'Not running', type: 'button', text: 'Start', show: S => S.pulseSource > 0 && !S.pulseOn },
  { key: 'pulseWait', type: 'note', text: 'Nothing is asked of the browser until you press Start.', show: S => S.pulseSource > 0 && !S.pulseOn },
  { key: 'pulseUrl', label: 'Bot address', type: 'text', show: S => S.pulseSource === 1 },
  { key: 'pulseOffset', label: 'Sync offset', type: 'range', min: -2, max: 2, step: 0.01, show: S => S.pulseSource === 1, fmt: v => (v >= 0 ? '+' : '') + v.toFixed(2) + ' s' },
  { key: 'pulseMeter', type: 'meter', show: S => S.pulseSource > 0 && S.pulseOn },
  { key: 'pulseDrive', label: 'Driven by', type: 'select', options: ['Beat', 'Bass', 'Level'], show: S => S.pulseSource > 0 },
  { key: 'pulseSpeed', label: 'Speed punch', type: 'range', min: 0, max: 4, step: 0.05, show: S => S.pulseSource > 0, fmt: v => v.toFixed(2) },
  { key: 'pulseGlow', label: 'Glow', type: 'range', min: 0, max: 3, step: 0.05, show: S => S.pulseSource > 0, fmt: v => v.toFixed(2) },
  { key: 'pulseZoom', label: 'Zoom punch', type: 'range', min: 0, max: 1, step: 0.02, show: S => S.pulseSource > 0, fmt: v => v.toFixed(2) },
  { group: 'Space' },
  { key: 'box', label: 'Bounds', type: 'box' },
  { key: 'showBox', label: 'Show bounds', type: 'check' },
  { key: 'upAxis', label: 'Up axis', type: 'select', options: ['Y', 'Z'] },
  { key: 'autoRotate', label: 'Auto-rotate', type: 'range', min: -1, max: 1, step: 0.02, fmt: v => v.toFixed(2) },
];

export function applyPreset(S, p) {
  S.preset = p.id; S.code = p.code;
  S.box = { c: [...p.box.c], s: [...p.box.s] };
  for (const k of PRESET_KEYS) S[k] = p[k] !== undefined ? p[k] : DEFAULTS[k];
  S.upAxis = p.cam && p.cam.up === 'z' ? 1 : 0;
  const d = (p.cam && p.cam.d) || 2.1 * Math.max(...p.box.s);
  S.cam = { th: p.cam ? p.cam.th : 0.6, ph: p.cam ? p.cam.ph : 0.3, d, t: [...p.box.c], up: S.upAxis ? 'z' : 'y' };
  return S;
}

export function freshState() { return applyPreset(structuredClone(DEFAULTS), PRESETS[0]); }

// sRGB hex → linear rgb triple.
export function hexToLinear(hex, out = [0, 0, 0]) {
  const n = parseInt(hex.slice(1), 16);
  for (let i = 0; i < 3; i++) { const c = ((n >> (16 - 8 * i)) & 255) / 255; out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
  return out;
}

const b64u = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };

async function pipe(bytes, stream) {
  const w = stream.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export async function encodeState(S) {
  // pulseOn is this session's business, not the document's: a link never arrives already listening.
  const { colorLin, bgLin, pulseOn, ...rest } = S;
  const bytes = new TextEncoder().encode(JSON.stringify(rest));
  return b64u(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decodeState(str) {
  const bytes = await pipe(unb64u(str), new DecompressionStream('deflate-raw'));
  const S = JSON.parse(new TextDecoder().decode(bytes));
  const out = structuredClone(DEFAULTS);
  for (const k in out) if (S[k] !== undefined) out[k] = S[k];
  if (!out.box || !out.box.c || !out.box.s) out.box = structuredClone(DEFAULTS.box);
  out.pulseOn = false;              // whatever the link says, nothing is running until asked
  return out;
}
