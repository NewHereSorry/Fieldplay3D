// App bootstrap: engine + camera + editor + panel, the frame loop, persistence and the toolbar.
import { Engine } from './gpu.js';
import { OrbitCamera } from './camera.js';
import { Editor } from './editor.js';
import { PRESETS, byId } from './presets.js';
import { randomField } from './random.js';
import { SCHEMA, applyPreset, freshState, hexToLinear, encodeState, decodeState } from './state.js';
import { buildSettings, toast, download } from './ui.js';

const $ = s => document.querySelector(s);
const STORE = 'fieldplay3d.state';
const MAX_DPR = 2;

async function loadState() {
  const q = new URLSearchParams(location.search).get('preset');
  if (q && byId(q)) return applyPreset(freshState(), byId(q));
  const h = location.hash.slice(1);
  if (h) { try { return await decodeState(h); } catch (e) { console.warn('bad share link', e); } }
  try { const s = localStorage.getItem(STORE); if (s) return await decodeState(s); } catch (e) { console.warn('bad saved state', e); }
  return freshState();
}

async function boot() {
  const canvas = $('#gl');
  let engine;
  try { engine = await Engine.create(canvas); }
  catch (e) { $('#nogpu-msg').textContent = e.message; $('#nogpu').hidden = false; console.error(e); return; }

  const S = await loadState();
  S.colorLin = [0, 0, 0]; S.bgLin = [0, 0, 0];
  const cam = new OrbitCamera();
  cam.attach(canvas);
  const applyCam = () => { cam.up = S.upAxis ? 'z' : 'y'; if (S.cam) cam.state = S.cam; else { cam.target = [...S.box.c]; cam.dist = 2.1 * Math.max(...S.box.s); } };
  applyCam();

  // ---- editor + compile ----
  const status = $('#status'), errBox = $('#errors');
  let compileTimer = 0;
  const editor = new Editor($('#editor'), {
    value: S.code,
    onChange: v => { S.code = v; if (S.preset !== 'custom') { S.preset = 'custom'; presetSel.value = 'custom'; } scheduleCompile(); persist(); },
    onSubmit: () => compile(),
  });
  function scheduleCompile() { clearTimeout(compileTimer); compileTimer = setTimeout(compile, 300); status.textContent = '…'; status.className = 'status busy'; }
  async function compile() {
    clearTimeout(compileTimer);
    const r = await engine.compile(S.code);
    if (r.stale) return;
    if (r.ok) {
      editor.setErrors([]); errBox.hidden = true;
      status.textContent = r.warnings.length ? `compiled, ${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''}` : 'compiled';
      status.className = 'status ok';
    } else {
      editor.setErrors(r.errors);
      errBox.textContent = r.errors.map(e => (e.line > 0 ? `line ${e.line}:${e.col}  ` : '') + e.message).join('\n');
      errBox.hidden = false;
      status.textContent = `${r.errors.length} error${r.errors.length > 1 ? 's' : ''}`; status.className = 'status err';
    }
    return r.ok;
  }

  // ---- presets ----
  const presetSel = $('#preset');
  for (const p of PRESETS) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; presetSel.append(o); }
  const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = 'Custom'; presetSel.append(custom);
  presetSel.value = byId(S.preset) ? S.preset : 'custom';
  presetSel.addEventListener('change', () => { const p = byId(presetSel.value); if (p) loadPreset(p); });
  function loadPreset(p) {
    applyPreset(S, p);
    editor.value = S.code; applyCam(); settings.refresh();
    engine.setCount(1 << S.count); engine.reset();
    compile(); persist();
  }
  $('#btn-random').addEventListener('click', () => {
    S.code = randomField(); S.preset = 'custom'; presetSel.value = 'custom';
    editor.value = S.code; engine.reset(); compile(); persist();
  });

  // ---- settings panel ----
  const settings = buildSettings($('#settings'), S, key => {
    if (key === 'count') engine.setCount(1 << S.count);
    else if (key === 'box') { engine.reset(); }
    else if (key === 'upAxis') { cam.up = S.upAxis ? 'z' : 'y'; }
    else if (key === 'shape' || key === 'colorMode') settings.refresh();
    persist();
  });
  engine.setCount(1 << S.count);

  // ---- persistence: localStorage + the URL hash, debounced ----
  let persistTimer = 0;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      S.cam = cam.state;
      const enc = await encodeState(S);
      try { localStorage.setItem(STORE, enc); } catch (e) { /* private mode */ }
      history.replaceState(null, '', '#' + enc);
    }, 600);
  }
  cam.onChange = persist;

  // ---- toolbar ----
  let paused = false;
  const app = $('#app');
  const setPaused = v => { paused = v; $('#btn-pause').textContent = v ? '▶' : '❚❚'; $('#btn-pause').classList.toggle('on', v); };
  $('#btn-pause').addEventListener('click', () => setPaused(!paused));
  $('#btn-reset').addEventListener('click', () => engine.reset());
  const setPanel = hidden => { app.classList.toggle('hide-panel', hidden); $('#btn-show').hidden = !hidden; };
  $('#btn-hide').addEventListener('click', () => setPanel(true));
  $('#btn-show').addEventListener('click', () => setPanel(false));
  $('#btn-help').addEventListener('click', () => { $('#help').hidden = false; });
  $('#btn-help-close').addEventListener('click', () => { $('#help').hidden = true; });
  $('#help').addEventListener('click', e => { if (e.target === $('#help')) $('#help').hidden = true; });
  $('#btn-full').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  $('#btn-share').addEventListener('click', async () => {
    S.cam = cam.state;
    const url = location.origin + location.pathname + '#' + await encodeState(S);
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { toast('Link is in the address bar'); }
  });
  $('#btn-shot').addEventListener('click', async () => {
    const blob = await engine.screenshot();
    download(blob, `fieldplay3d-${S.preset}-${Date.now()}.png`); toast('PNG saved');
  });
  let rec = null;
  $('#btn-rec').addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    const stream = canvas.captureStream(60), chunks = [];
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 20e6 });
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => { download(new Blob(chunks, { type: 'video/webm' }), `fieldplay3d-${S.preset}-${Date.now()}.webm`); rec = null; $('#btn-rec').classList.remove('rec'); toast('WebM saved'); };
    rec.start(200); $('#btn-rec').classList.add('rec'); toast('Recording… click again to stop');
  });

  document.addEventListener('keydown', e => {
    const typing = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT';
    if (e.key === 'Escape') { $('#help').hidden = true; return; }
    if (typing) return;
    if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
    else if (e.key === 'r' || e.key === 'R') engine.reset();
    else if (e.key === 'h' || e.key === 'H') setPanel(!app.classList.contains('hide-panel'));
    else if (e.key === 'f' || e.key === 'F') $('#btn-full').click();
  });

  // ---- cursor uniform ----
  const mouse = { x: 0, y: 0, down: 0 };
  canvas.addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('pointerdown', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = 1; });
  window.addEventListener('pointerup', () => { mouse.down = 0; });

  // ---- frame loop ----
  const ctl = { cursor: [0, 0, 0], cursorDown: 0, motion: 0, paused: false, dpr: 1 };
  const stats = $('#stats');
  let last = performance.now(), fpsT = 0, fpsN = 0, running = true;
  function fit() {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    engine.resize(w, h); ctl.dpr = dpr;
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    fit();
    cam.autoRotate = S.autoRotate * 0.6;
    cam.update(engine.width / engine.height, dt);
    hexToLinear(S.color, S.colorLin); hexToLinear(S.bg, S.bgLin);
    cam.cursorOnPlane(mouse.x, mouse.y, canvas.clientWidth, canvas.clientHeight, ctl.cursor);
    ctl.cursorDown = mouse.down; ctl.motion = cam.motion / Math.max(dt, 1e-3); ctl.paused = paused;
    engine.frame(S, cam, ctl);
    fpsN++; fpsT += dt;
    if (fpsT >= 0.5) {
      stats.textContent = `${Math.round(fpsN / fpsT)} fps · ${engine.count.toLocaleString()} particles · ${engine.info}`;
      fpsT = 0; fpsN = 0;
    }
  }
  function loop(now) { frame(now); if (running) requestAnimationFrame(loop); }
  await compile();
  requestAnimationFrame(loop);

  // Harness for scripted verification (screenshots with a hidden pane, tests).
  window.FP = { S, engine, cam, editor, compile, loadPreset, presets: PRESETS,
    frame: () => frame(performance.now()), pause: v => setPaused(v), stop: () => { running = false; }, run: () => { if (!running) { running = true; requestAnimationFrame(loop); } } };
}

boot();
