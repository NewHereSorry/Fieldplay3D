// Orbit camera + the little matrix kit it needs. Column-major Float32Array mat4, WebGPU depth 0..1.

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect; out[5] = f; out[10] = far * nf; out[11] = -1; out[14] = near * far * nf;
  return out;
}

export function multiply(out, a, b) { // out = a * b
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

const EPS = 1e-4;

export class OrbitCamera {
  constructor() {
    this.theta = 0.6; this.phi = 0.35; this.dist = 6;          // azimuth, elevation, distance
    this.target = [0, 0, 0];
    this.up = 'y';                                             // 'y' or 'z' up
    this.fov = 45 * Math.PI / 180; this.near = 0.02; this.far = 1000;
    this.autoRotate = 0;                                       // radians per second
    this.eye = [0, 0, 0]; this.X = [1, 0, 0]; this.Y = [0, 1, 0]; this.Z = [0, 0, 1];
    this.view = new Float32Array(16); this.proj = new Float32Array(16); this.viewProj = new Float32Array(16);
    this.aspect = 1;
    this._motion = 0; this._last = null;
    this.punch = 1; this.viewDist = this.dist; this.dragging = false;             // punch: transient zoom (the beat), never persisted
    this.onChange = null;
  }

  // Recompute basis + matrices. Call once per frame.
  update(aspect, dt) {
    if (this.autoRotate) this.theta += this.autoRotate * dt;
    this.aspect = aspect;
    const cp = Math.cos(this.phi), sp = Math.sin(this.phi), ct = Math.cos(this.theta), st = Math.sin(this.theta);
    const t = this.target, d = this.dist * this.punch, e = this.eye, X = this.X, Y = this.Y, Z = this.Z;
    this.viewDist = d;
    let ux, uy, uz;
    if (this.up === 'z') { Z[0] = cp * ct; Z[1] = cp * st; Z[2] = sp; ux = 0; uy = 0; uz = 1; }
    else                 { Z[0] = cp * st; Z[1] = sp; Z[2] = cp * ct; ux = 0; uy = 1; uz = 0; }
    e[0] = t[0] + Z[0] * d; e[1] = t[1] + Z[1] * d; e[2] = t[2] + Z[2] * d;
    // X = normalize(up x Z), Y = Z x X
    let xx = uy * Z[2] - uz * Z[1], xy = uz * Z[0] - ux * Z[2], xz = ux * Z[1] - uy * Z[0];
    const xl = 1 / (Math.hypot(xx, xy, xz) || 1); xx *= xl; xy *= xl; xz *= xl;
    X[0] = xx; X[1] = xy; X[2] = xz;
    Y[0] = Z[1] * xz - Z[2] * xy; Y[1] = Z[2] * xx - Z[0] * xz; Y[2] = Z[0] * xy - Z[1] * xx;
    const v = this.view;
    v[0] = xx; v[1] = Y[0]; v[2] = Z[0]; v[3] = 0;
    v[4] = xy; v[5] = Y[1]; v[6] = Z[1]; v[7] = 0;
    v[8] = xz; v[9] = Y[2]; v[10] = Z[2]; v[11] = 0;
    v[12] = -(xx * e[0] + xy * e[1] + xz * e[2]);
    v[13] = -(Y[0] * e[0] + Y[1] * e[1] + Y[2] * e[2]);
    v[14] = -(Z[0] * e[0] + Z[1] * e[1] + Z[2] * e[2]); v[15] = 1;
    const far = Math.max(this.far, d * 8), near = Math.max(1e-3, d * 0.002);
    perspective(this.proj, this.fov, aspect, near, far);
    multiply(this.viewProj, this.proj, this.view);
    // Motion since the last frame (for the smear-dissolving fade): angle + log-zoom + pan/dist.
    const L = this._last;
    if (L) {
      this._motion = Math.abs(this.theta - L[0]) + Math.abs(this.phi - L[1]) + Math.abs(Math.log(this.dist / L[2])) +
        Math.hypot(t[0] - L[3], t[1] - L[4], t[2] - L[5]) / this.dist;
      L[0] = this.theta; L[1] = this.phi; L[2] = this.dist; L[3] = t[0]; L[4] = t[1]; L[5] = t[2];
    } else this._last = [this.theta, this.phi, this.dist, t[0], t[1], t[2]];
  }

  get motion() { return this._motion; }

  // World ray through a canvas pixel (px, py in CSS pixels, w x h canvas CSS size) → hit on the plane through target facing the camera.
  cursorOnPlane(px, py, w, h, out) {
    const th = Math.tan(this.fov / 2), nx = (2 * px / w - 1) * th * this.aspect, ny = (1 - 2 * py / h) * th;
    const X = this.X, Y = this.Y, Z = this.Z;
    const dx = nx * X[0] + ny * Y[0] - Z[0], dy = nx * X[1] + ny * Y[1] - Z[1], dz = nx * X[2] + ny * Y[2] - Z[2];
    const t = this.dist / -(dx * Z[0] + dy * Z[1] + dz * Z[2]);     // plane normal = Z, plane through target
    out[0] = this.eye[0] + dx * t; out[1] = this.eye[1] + dy * t; out[2] = this.eye[2] + dz * t;
    return out;
  }

  rotate(dx, dy) { this.theta -= dx; this.phi = Math.min(Math.PI / 2 - EPS, Math.max(-Math.PI / 2 + EPS, this.phi + dy)); this._changed(); }
  pan(dx, dy) {
    const s = this.dist, t = this.target, X = this.X, Y = this.Y;
    t[0] += (-dx * X[0] + dy * Y[0]) * s; t[1] += (-dx * X[1] + dy * Y[1]) * s; t[2] += (-dx * X[2] + dy * Y[2]) * s;
    this._changed();
  }
  zoom(f) { this.dist = Math.min(1e6, Math.max(1e-3, this.dist * f)); this._changed(); }
  _changed() { if (this.onChange) this.onChange(); }

  // Pointer, wheel and pinch on an element. The left and middle buttons belong to the cursor's
  // force (main.js), so on a mouse the camera answers to the right button and to shift or ctrl:
  // right drag orbits, shift/ctrl drag pans, wheel zooms. A finger has no buttons, so touch keeps
  // one finger orbiting and two panning and pinching.
  attach(el) {
    const ptrs = new Map(); let mode = 0, lx = 0, ly = 0, pinch = 0;
    const drag = () => { this.dragging = mode !== 0 && ptrs.size > 0; };   // is the CAMERA being dragged
    const centre = () => { let x = 0, y = 0; for (const p of ptrs.values()) { x += p.x; y += p.y; } return [x / ptrs.size, y / ptrs.size]; };
    const span = () => { const a = [...ptrs.values()]; return a.length < 2 ? 0 : Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    el.addEventListener('pointerdown', e => {
      if (e.button > 2) return;
      el.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      mode = e.pointerType !== 'mouse' ? 1 : (e.shiftKey || e.ctrlKey) ? 2 : e.button === 2 ? 1 : 0;
      [lx, ly] = centre(); pinch = span(); drag();
    });
    el.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [cx, cy] = centre(), h = el.clientHeight || 1;
      if (ptrs.size >= 2) {
        const s = span(); if (pinch > 0 && s > 0) this.zoom(pinch / s); pinch = s;
        this.pan((cx - lx) / h, (cy - ly) / h);
      } else if (mode === 1) this.rotate((cx - lx) / h * 4, (cy - ly) / h * 4);
      else if (mode === 2) this.pan((cx - lx) / h, (cy - ly) / h);
      lx = cx; ly = cy;
    });
    const end = e => { ptrs.delete(e.pointerId); if (!ptrs.size) mode = 0; else { [lx, ly] = centre(); pinch = span(); } drag(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(Math.sign(e.deltaY) * 0.12)); }, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  get state() { return { th: +this.theta.toFixed(4), ph: +this.phi.toFixed(4), d: +this.dist.toPrecision(5), t: this.target.map(v => +v.toPrecision(5)), up: this.up }; }
  set state(s) {
    if (!s) return;
    if (s.th !== undefined) this.theta = s.th; if (s.ph !== undefined) this.phi = s.ph; if (s.d !== undefined) this.dist = s.d;
    if (s.t) this.target = [...s.t]; if (s.up) this.up = s.up;
  }
}
