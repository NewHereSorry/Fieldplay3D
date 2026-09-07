// App bootstrap: engine + camera + editor + panel, the frame loop, persistence and the toolbar.
import { Engine } from './gpu.js';
import { OrbitCamera } from './camera.js';
import { Editor } from './editor.js';
import { PRESETS, byId } from './presets.js';
import { randomField } from './random.js';
import { SCHEMA, applyPreset, freshState, hexToLinear, encodeState, decodeState } from './state.js';
import { buildSettings, toast, download } from './ui.js';
import * as library from './library.js';
import { Pulse } from './audio.js';

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
    onChange: v => { S.code = v; if (S.preset !== 'custom') { S.preset = 'custom'; fillPresets(); } scheduleCompile(); persist(); },
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

  // ---- presets and the fields you saved yourself ----
  const presetSel = $('#preset');
  const group = (label, items) => {
    if (!items.length) return null;
    const g = document.createElement('optgroup'); g.label = label;
    for (const [value, text] of items) { const o = document.createElement('option'); o.value = value; o.textContent = text; g.append(o); }
    presetSel.append(g);
    return g;
  };
  function fillPresets() {
    presetSel.replaceChildren();
    group('Saved', library.list().map(e => [library.PREFIX + e.name, e.name]));
    group('Presets', PRESETS.map(p => [p.id, p.name]));
    const own = document.createElement('option');
    own.value = 'custom'; own.textContent = 'Custom (unsaved)'; presetSel.append(own);
    presetSel.value = known(S.preset) ? S.preset : 'custom';
    const saved = presetSel.value.startsWith(library.PREFIX);
    $('#btn-forget').hidden = !saved;
    $('#btn-save').title = saved ? 'Save over it, or under a new name' : 'Save this field';
  }
  const known = id => !!byId(id) || (id.startsWith(library.PREFIX) && !!library.find(id.slice(library.PREFIX.length)));
  fillPresets();
  presetSel.addEventListener('change', () => {
    const id = presetSel.value;
    if (id.startsWith(library.PREFIX)) loadSaved(id.slice(library.PREFIX.length));
    else { const p = byId(id); if (p) loadPreset(p); }
  });

  // Everything a load has to do, however the state was made.
  function adopt() {
    S.colorLin = S.colorLin || [0, 0, 0]; S.bgLin = S.bgLin || [0, 0, 0];
    // Loading a field neither starts nor stops the music sync: what is running keeps running (and the
    // picker is corrected to say so), and what the loaded state merely asks for waits behind Start.
    if (S.pulseOn) S.pulseSource = KINDS.indexOf(pulse.source);
    editor.value = S.code; applyCam(); settings.refresh();
    engine.setCount(1 << S.count); engine.reset();
    compile(); persist();
  }
  function loadPreset(p) { applyPreset(S, p); adopt(); }
  async function loadSaved(name) {
    const entry = library.find(name);
    if (!entry) { fillPresets(); return; }
    try {
      const next = await decodeState(entry.state);
      Object.assign(S, next); S.preset = library.PREFIX + name;
      adopt(); fillPresets();
    } catch (e) { toast('That saved field could not be read'); }
  }

  $('#btn-random').addEventListener('click', () => {
    S.code = randomField(); S.preset = 'custom'; presetSel.value = 'custom'; fillPresets();
    engine.reset(); editor.value = S.code; compile(); persist();
  });
  $('#btn-save').addEventListener('click', async () => {
    const current = S.preset.startsWith(library.PREFIX) ? S.preset.slice(library.PREFIX.length) : '';
    const suggested = current || (byId(S.preset) ? byId(S.preset).name + ' (mine)' : 'My field');
    const name = prompt('Save this field as:', suggested);
    if (name === null) return;
    S.cam = cam.state;
    const entry = library.save(name, await encodeState({ ...S, preset: 'custom' }));
    if (!entry) { toast(name.trim() ? 'This browser would not store it' : 'That needs a name'); return; }
    S.preset = library.PREFIX + entry.name; fillPresets(); persist();
    toast(`Saved as “${entry.name}”`);
  });
  $('#btn-forget').addEventListener('click', () => {
    const name = S.preset.slice(library.PREFIX.length);
    if (!confirm(`Forget “${name}”? The field itself stays on screen.`)) return;
    library.remove(name);
    S.preset = 'custom'; fillPresets(); persist();
    toast(`Forgot “${name}”`);
  });

  // ---- settings panel ----
  const settings = buildSettings($('#settings'), S, key => {
    if (key === 'count') engine.setCount(1 << S.count);
    else if (key === 'box') { engine.reset(); }
    else if (key === 'upAxis') { cam.up = S.upAxis ? 'z' : 'y'; }
    else if (key === 'shape' || key === 'colorMode') settings.refresh();
    else if (key === 'pulseSource') { if (S.pulseSource) startPulse(); else stopPulse(); settings.refresh(); }
    else if (key === 'pulseStart') startPulse();
    else if (key === 'pulseUrl') { if (S.pulseOn && pulse.source === 'auxcord') startPulse(); }
    persist();
  });
  engine.setCount(1 << S.count);

  // ---- pulse: the music, as numbers ----
  // The page asks the browser for nothing on its own — no sharing, no microphone, no reaching for the
  // bot's port. A source runs only after a press in this panel, so a saved state or a shared link that
  // names one opens with Start waiting instead of a permission prompt.
  const pulse = new Pulse();
  const KINDS = ['off', 'auxcord', 'capture', 'mic'];
  S.pulseOn = false;
  pulse.status = S.pulseSource ? 'not started' : 'off';
  pulse.onStop = () => { S.pulseOn = false; settings.refresh(); persist(); };
  async function startPulse() {
    let ok = false;
    try { ok = await pulse.setSource(KINDS[S.pulseSource] || 'off', S.pulseUrl); }
    catch (e) { toast(e.message); }
    S.pulseOn = ok; settings.refresh(); persist();
    return ok;
  }
  function stopPulse() { pulse.stop(); S.pulseOn = false; pulse.status = S.pulseSource ? 'not started' : 'off'; }

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
  // e.buttons is the bitmask of what is held right now (1 left, 2 right, 4 middle) and is already
  // up to date on a pointerup, so one handler covers press, drag and release.
  const mouse = { x: 0, y: 0, down: 0, over: 0, buttons: 0 };
  const track = e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.over = 1; mouse.buttons = e.buttons; mouse.down = e.buttons ? 1 : 0; };
  for (const type of ['pointermove', 'pointerdown', 'pointerup']) canvas.addEventListener(type, track);
  canvas.addEventListener('pointerenter', track);
  canvas.addEventListener('pointerleave', () => { mouse.over = 0; });
  window.addEventListener('pointerup', e => { mouse.buttons = e.buttons; mouse.down = e.buttons ? 1 : 0; });
  window.addEventListener('blur', () => { mouse.buttons = 0; mouse.down = 0; });

  // ---- frame loop ----
  const ctl = { cursor: [0, 0, 0], cursorDown: 0, motion: 0, paused: false, dpr: 1, audio: [0, 0, 0, 0], beat: 0, phase: 0, bpm: 0, speedMul: 1, glowMul: 1, cursorMode: 0, cursorSign: 1 };
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
    pulse.offset = S.pulseOffset; pulse.update(now / 1000);
    const A = pulse.A, drive = S.pulseSource ? [A.beat, A.bass, A.level][S.pulseDrive] || 0 : 0;
    cam.punch = 1 - 0.08 * S.pulseZoom * drive;
    ctl.audio[0] = A.bass; ctl.audio[1] = A.mid; ctl.audio[2] = A.high; ctl.audio[3] = A.level;
    ctl.beat = A.beat; ctl.phase = A.phase; ctl.bpm = A.bpm;
    ctl.speedMul = 1 + S.pulseSpeed * drive; ctl.glowMul = 1 + S.pulseGlow * drive;
    if (S.pulseSource) settings.meter(A, pulse.status, pulse.title);
    cam.update(engine.width / engine.height, dt);
    hexToLinear(S.color, S.colorLin); hexToLinear(S.bg, S.bgLin);
    cam.cursorOnPlane(mouse.x, mouse.y, canvas.clientWidth, canvas.clientHeight, ctl.cursor);
    ctl.cursorDown = mouse.down; ctl.motion = cam.motion / Math.max(dt, 1e-3); ctl.paused = paused;
    // Hold the left button to bend the flow, the middle one to bend it the other way. A drag that
    // belongs to the camera (right, or shift/ctrl) leaves the flow alone.
    const held = (mouse.over && !cam.dragging) ? (mouse.buttons & 1 ? 1 : (mouse.buttons & 4 ? -1 : 0)) : 0;
    ctl.cursorMode = held ? S.cursorMode : 0; ctl.cursorSign = held;
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
  window.FP = { S, engine, cam, editor, compile, loadPreset, loadSaved, library, mouse, presets: PRESETS, pulse, settings,
    frame: () => frame(performance.now()), pause: v => setPaused(v), stop: () => { running = false; }, run: () => { if (!running) { running = true; requestAnimationFrame(loop); } } };
}

boot();
