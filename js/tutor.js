// The tutorial: a dimmed hole, a caption, and the real app doing real things behind them.
//
// Every step drives the same state everything else drives — presets load through loadPreset, the look
// changes are ordinary settings, and the hand is the same cursor uniform a mouse writes. Nothing here
// simulates the app for the camera; the tour has no picture of its own. The whole state is snapshotted
// on entry and put back on exit, so a tour never costs anyone the field they were working on.

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// A step: where to shine the light, what to say, and what the app should be doing while it is said.
// `spot` is a selector, 'display' for the canvas outside the panel, or null for no dimming at all.
const STEPS = [
  {
    spot: '#editor', ms: 3400,
    title: 'This is the maths.',
    body: 'One function. Hand it any point in space and it answers with a direction to move.',
  },
  {
    spot: 'display', ms: 3600,
    title: 'This is that same function, as wind.',
    body: 'A million specks, each one only ever doing what the function just told it.',
  },
  {
    spot: null, ms: 4600,
    title: 'Put your hand in it.',
    body: 'Hold the left mouse button anywhere in the flow and the wind bends toward you.',
    enter: api => { api.look({ cursorMode: 1, cursorForce: 2.4, cursorRadius: 0.42 }); },
    // A slow circle near the middle of the picture, with the button held the whole way.
    tick: (api, t) => {
      const r = api.display();
      const a = t * 1.7, rad = Math.min(r.w, r.h) * 0.17;
      api.hand(r.x + r.w / 2 + Math.cos(a) * rad * 1.5, r.y + r.h / 2 + Math.sin(a) * rad, true);
    },
    exit: api => api.hand(null),
  },
  {
    spot: null, ms: 3400,
    title: 'Same wind. Different photograph.',
    body: 'Colour, trail length and exposure are their own thing — the maths above has not moved.',
    enter: api => api.look({ shape: 2, width: 4, colorMode: 1, palette: 1, fade: 0.985, intensity: 0.09, exposure: 1.7 }),
  },
  {
    spot: '#preset', ms: 3800,
    title: 'Twenty of these come with it.',
    body: 'This one is the butterfly effect: Lorenz, 1963. Two specks a hair apart end up nowhere near each other.',
    enter: api => api.preset('lorenz'),
  },
  {
    spot: '#btn-random', ms: 3000,
    title: 'Or roll one nobody has seen.',
    body: '🎲 writes a whole new field from nothing, and most of them have never existed before.',
  },
  {
    spot: '#btn-share', ms: 3200,
    title: 'Then send it.',
    body: '🔗 packs the code, every setting and the camera angle into one link. No account, no upload.',
  },
  {
    spot: null, ms: 0, last: true,
    title: 'Your turn.',
    body: 'Change a number in the function and watch the wind change with it. Your own field is back on screen.',
  },
];

export class Tour {
  constructor(api) {
    // One call moves the force and the ring that explains it, so they can never disagree.
    this.api = { ...api, hand: (x, y, down) => { api.hand(x, y, down); this.showHand(x, y); } };
    this.i = -1;
    this.running = false;
    this.raf = 0; this.timer = 0; this.t0 = 0;
    this.snap = null;
    this.build();
  }

  build() {
    const root = el('div', 'tour'); root.id = 'tour'; root.hidden = true;
    const hole = el('div', 'tour-hole');
    const say = el('div', 'tour-say');
    const num = el('div', 'tour-num');
    const h = el('h3'), p = el('p');
    const foot = el('div', 'tour-foot');
    const dots = el('div', 'tour-dots');
    for (let i = 0; i < STEPS.length; i++) dots.append(el('i'));
    const skip = el('button', 'tour-skip', 'Skip');
    const hint = el('span', 'tour-hint', 'click to continue');
    const hand = el('div', 'tour-hand');
    foot.append(dots, hint, skip);
    say.append(num, h, p, foot);
    root.append(hole, say, hand);
    document.body.append(root);

    skip.addEventListener('pointerdown', e => { e.stopPropagation(); this.stop(); });
    root.addEventListener('pointerdown', () => this.next());
    this.els = { root, hole, say, num, h, p, dots, skip, hint, hand };
    this.onKey = e => {
      if (!this.running) return;
      if (e.key === 'Escape') { e.stopPropagation(); this.stop(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.next(); }
    };
    this.onResize = () => this.place();
  }

  async start() {
    if (this.running) return;
    this.snap = await this.api.snapshot();
    this.running = true; this.i = -1;
    this.els.root.hidden = false;
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
    this.next();
  }

  next() {
    if (!this.running) return;
    const prev = STEPS[this.i];
    if (prev && prev.exit) prev.exit(this.api);
    if (this.i >= STEPS.length - 1) { this.stop(); return; }
    this.show(this.i + 1);
  }

  show(i) {
    clearTimeout(this.timer);
    this.i = i;
    const s = STEPS[i];
    const { num, h, p, dots, root, skip, hint } = this.els;
    num.textContent = `Step ${i + 1} of ${STEPS.length}`;
    h.textContent = s.title; p.textContent = s.body;
    [...dots.children].forEach((d, n) => d.classList.toggle('on', n <= i));
    root.classList.toggle('bare', !s.spot);
    skip.textContent = s.last ? 'Start playing' : 'Skip';
    skip.classList.toggle('go', !!s.last);
    hint.hidden = !!s.last;

    // The last step is where the tour gives the field back, before anyone is asked to touch anything.
    if (s.last && this.snap) { this.api.restore(this.snap); this.snap = null; }
    if (s.enter) s.enter(this.api);
    this.place();

    this.t0 = performance.now();
    if (s.tick) { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this.spin = now => { if (!this.running || STEPS[this.i] !== s) return; s.tick(this.api, (now - this.t0) / 1000); this.raf = requestAnimationFrame(this.spin); }); }
    if (s.ms) this.timer = setTimeout(() => this.next(), s.ms);
  }

  // The lit rectangle for a step, in viewport coordinates.
  rect(spot) {
    const vw = innerWidth, vh = innerHeight;
    if (!spot) return { x: 0, y: 0, w: vw, h: vh };
    if (spot === 'display') return this.api.display();
    const n = document.querySelector(spot);
    if (!n) return { x: 0, y: 0, w: vw, h: vh };
    const r = n.getBoundingClientRect(), pad = 6;
    return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  }

  place() {
    const s = STEPS[this.i]; if (!s) return;
    const { hole, say } = this.els;
    const r = this.rect(s.spot), vw = innerWidth, vh = innerHeight, gap = 16;
    Object.assign(hole.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });

    // Prefer beside the lit area, then under it, then over it, and only then inside it.
    const sw = say.offsetWidth || 420, sh = say.offsetHeight || 150;
    let x, y;
    if (r.x + r.w + gap + sw + gap <= vw) { x = r.x + r.w + gap; y = r.y + r.h / 2 - sh / 2; }
    else if (r.x - gap - sw - gap >= 0) { x = r.x - gap - sw; y = r.y + r.h / 2 - sh / 2; }
    else if (r.y + r.h + gap + sh + gap <= vh) { x = r.x + r.w / 2 - sw / 2; y = r.y + r.h + gap; }
    else if (r.y - gap - sh - gap >= 0) { x = r.x + r.w / 2 - sw / 2; y = r.y - gap - sh; }
    else { x = r.x + r.w / 2 - sw / 2; y = r.y + r.h - sh - 40; }
    Object.assign(say.style, { left: clamp(x, gap, vw - sw - gap) + 'px', top: clamp(y, gap, vh - sh - gap) + 'px' });
  }

  stop() {
    if (!this.running) return;
    const s = STEPS[this.i];
    if (s && s.exit) s.exit(this.api);
    clearTimeout(this.timer); cancelAnimationFrame(this.raf);
    this.running = false; this.i = -1;
    this.els.root.hidden = true;
    this.els.hand.classList.remove('on');
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    // Skipping early still gives the field back.
    if (this.snap) { this.api.restore(this.snap); this.snap = null; }
  }

  // Drives the visible ring; the flow itself is bent by the api's own hand().
  showHand(x, y) {
    const { hand } = this.els;
    if (x == null) { hand.classList.remove('on'); return; }
    hand.style.left = x + 'px'; hand.style.top = y + 'px'; hand.classList.add('on');
  }
}

export const TOUR_STEPS = STEPS;
