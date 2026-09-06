// Pulse: what the music is doing right now, as numbers the field and the look can use.
// Two kinds of source. 'auxcord' asks the Aux Cord bot's localhost endpoint for its clock and the
// track's pre-analysed timeline (dashcord/bots/aux-cord/auxcord/pulse.py) and samples it at the
// moment the room hears; 'capture' and 'mic' analyse live audio in the browser with Web Audio.
// Either way the output is A = {bass, mid, high, level (0…1), beat (1 on the beat, decaying),
// phase (0…1 to the next beat), bpm, on}.

const ZERO = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, phase: 0, bpm: 0, on: 0 };
const BEAT_DECAY = 0.12;                 // seconds for a beat to fall to 1/e
export const DEFAULT_BASE = 'http://localhost:5226';

export function decodeBands(b64) {
  const s = atob(b64), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// Bands + beat at media time `pos` from a decoded analysis {rate, n, bpm, beats, bytes}.
export function sampleAnalysis(an, pos, A) {
  const n = an.n, x = Math.max(0, Math.min(n - 1, pos * an.rate));
  const i0 = Math.floor(x), i1 = Math.min(n - 1, i0 + 1), f = x - i0, b = an.bytes;
  const g = k => (b[i0 * 4 + k] * (1 - f) + b[i1 * 4 + k] * f) / 255;
  A.bass = g(0); A.mid = g(1); A.high = g(2); A.level = g(3);
  const bt = an.beats;
  let lo = 0, hi = bt.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bt[m] <= pos) lo = m + 1; else hi = m; }
  const period = 60 / (an.bpm || 120);
  const prev = lo > 0 ? bt[lo - 1] : bt.length ? bt[0] - period : pos;
  const next = lo < bt.length ? bt[lo] : prev + period;
  A.beat = Math.exp(-Math.max(0, pos - prev) / BEAT_DECAY);
  A.phase = Math.max(0, Math.min(1, (pos - prev) / Math.max(1e-3, next - prev)));
  A.bpm = an.bpm; A.on = 1;
  return A;
}

export class Pulse {
  constructor() {
    this.A = { ...ZERO };
    this.source = 'off'; this.status = 'off'; this.title = ''; this.offset = 0; this.base = DEFAULT_BASE;
    this._now = null; this._analysis = null; this._key = ''; this._timer = 0; this._gen = 0;
    this._ctx = null; this._stream = null; this._an = null;
  }

  // kind: 'off' | 'auxcord' | 'capture' (a tab or the screen's sound) | 'mic'
  async setSource(kind, url) {
    this.stop();
    this.source = kind;
    const gen = ++this._gen;
    if (kind === 'auxcord') {
      this.base = (url || DEFAULT_BASE).replace(/\/+$/, '');
      this.status = 'connecting…';
      this._poll(gen);
    } else if (kind === 'capture' || kind === 'mic') {
      await this._startLive(kind === 'mic', gen);
    } else this.status = 'off';
  }

  stop() {
    this._gen++;
    clearTimeout(this._timer); this._timer = 0;
    if (this._stream) { for (const t of this._stream.getTracks()) t.stop(); this._stream = null; }
    if (this._ctx) { this._ctx.close().catch(() => {}); this._ctx = null; }
    this._an = null; this._now = null; this._analysis = null; this._key = ''; this.title = ''; this.status = 'off';
    Object.assign(this.A, ZERO);
  }

  // ---- Aux Cord: the bot's clock twice a second, the timeline once per track ----
  async _poll(gen) {
    let ok = false;
    try {
      const j = await (await fetch(this.base + '/now', { cache: 'no-store' })).json();
      if (gen !== this._gen) return;
      j.recv = performance.now() / 1000;
      this._now = j; ok = true;
      this.title = j.track ? j.track.title : '';
      this.status = !j.track ? 'bot idle' : j.paused ? 'paused' : j.analysis === 'ready' ? 'synced'
        : j.analysis === 'pending' ? 'analysing…' : 'live stream, no beat map';
      if (j.key && j.analysis === 'ready' && j.key !== this._key) {
        this._key = j.key; this._analysis = null;
        const a = await (await fetch(this.base + '/analysis?key=' + encodeURIComponent(j.key), { cache: 'no-store' })).json();
        if (gen !== this._gen) return;
        if (a && a.n) { a.bytes = decodeBands(a.bands); this._analysis = a; }
      }
    } catch (e) {
      if (gen !== this._gen) return;
      this._now = null; this.status = 'no bot at ' + this.base;
    }
    this._timer = setTimeout(() => this._poll(gen), ok ? 500 : 2000);
  }

  // Per frame; t = performance.now() / 1000.
  update(t) {
    const A = this.A;
    if (this.source === 'auxcord') {
      const N = this._now, an = this._analysis;
      if (!N || !N.playing || N.paused || !an) return this._decay(A);
      sampleAnalysis(an, N.position + (t - N.recv) * N.rate + this.offset, A);
    } else if (this._an) this._live(t, A);
    else this._decay(A);
  }

  _decay(A) { A.bass *= 0.9; A.mid *= 0.9; A.high *= 0.9; A.level *= 0.9; A.beat *= 0.85; A.on = 0; }

  // ---- live capture: Web Audio analyser, adaptive band peaks, a bass-onset beat detector ----
  async _startLive(mic, gen) {
    this.status = 'waiting for permission…';
    let stream;
    try {
      stream = mic
        ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (e) { if (gen === this._gen) this.status = 'no permission: ' + e.message; return; }
    if (gen !== this._gen) { for (const tr of stream.getTracks()) tr.stop(); return; }
    for (const tr of stream.getVideoTracks()) tr.stop();
    const audio = stream.getAudioTracks()[0];
    if (!audio) { this.status = 'nothing shared had sound — tick "share audio"'; return; }
    this._stream = stream;
    this._ctx = new AudioContext();
    await this._ctx.resume().catch(() => {});
    const src = this._ctx.createMediaStreamSource(stream);
    const an = this._ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.3;
    src.connect(an);
    this._an = an; this._fft = new Uint8Array(an.frequencyBinCount);
    this._peak = [0.2, 0.2, 0.2, 0.2]; this._hist = []; this._lastBeat = -1; this._ivals = []; this._prevBass = 0;
    audio.addEventListener('ended', () => { if (gen === this._gen) { this.status = 'sharing stopped'; this._an = null; } });
    this.title = mic ? 'microphone' : (audio.label || 'shared audio');
    this.status = 'listening';
  }

  _live(t, A) {
    const an = this._an, fft = this._fft;
    an.getByteFrequencyData(fft);
    const binHz = this._ctx.sampleRate / an.fftSize;
    const band = (lo, hi) => {
      let s = 0, n = 0;
      for (let i = Math.max(1, Math.floor(lo / binHz)), e = Math.min(fft.length, Math.ceil(hi / binHz)); i < e; i++) { s += fft[i]; n++; }
      return n ? s / (n * 255) : 0;
    };
    const raw = [band(30, 160), band(160, 2000), band(2000, 8000), band(30, 8000)];
    const pk = this._peak;
    for (let k = 0; k < 4; k++) pk[k] = Math.max(pk[k] * 0.9995, raw[k], 0.08);
    A.bass = Math.min(1, raw[0] / pk[0]); A.mid = Math.min(1, raw[1] / pk[1]);
    A.high = Math.min(1, raw[2] / pk[2]); A.level = Math.min(1, raw[3] / pk[3]);
    // Onset: bass jumping over its last second's mean while rising, at most four a second.
    const h = this._hist; h.push(t, raw[0]);
    while (h.length && h[0] < t - 1) h.splice(0, 2);
    let mean = 0; for (let i = 1; i < h.length; i += 2) mean += h[i]; mean /= (h.length >> 1) || 1;
    if (raw[0] > mean * 1.3 + 0.04 && raw[0] > this._prevBass && t - this._lastBeat > 0.25) {
      if (this._lastBeat > 0) {
        const iv = t - this._lastBeat;
        if (iv > 0.28 && iv < 1.1) { this._ivals.push(iv); if (this._ivals.length > 12) this._ivals.shift(); }
      }
      this._lastBeat = t;
    }
    this._prevBass = raw[0];
    A.beat = this._lastBeat > 0 ? Math.exp(-(t - this._lastBeat) / BEAT_DECAY) : 0;
    if (this._ivals.length >= 4) {
      const s = [...this._ivals].sort((a, b) => a - b), med = s[s.length >> 1];
      A.bpm = 60 / med; A.phase = Math.min(1, (t - this._lastBeat) / med);
    } else { A.bpm = 0; A.phase = 0; }
    A.on = 1;
  }
}
