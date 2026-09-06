// A dependency-free syntax-highlighting code editor for WGSL.
// Technique: a highlighted <pre> under a transparent-text <textarea> with identical metrics;
// the textarea owns input, caret, selection and scrolling, the pre and the gutter follow it.
//
//   <div class="ed">
//     <div class="ed-gutter"><div>1</div>…</div>
//     <div class="ed-body"><pre class="ed-hl"><code>…</code></pre><textarea class="ed-ta"></textarea></div>
//   </div>

const KW = 'fn let var const return if else for while loop break continue switch case default struct discard true false';
const TY = 'f32 u32 i32 bool vec2 vec3 vec4 vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u vec4u mat2x2f mat3x3f mat4x4f array ptr';
const FN = 'sin cos tan asin acos atan atan2 sinh cosh tanh exp exp2 log log2 pow sqrt inverseSqrt abs sign floor ceil round fract trunc min max clamp mix step smoothstep length distance dot cross normalize reflect refract select any all saturate degrees radians';
const LIB = 'noise noised fbm curl hash3 hash1 rand3 rotateX rotateY rotateZ hsv2rgb turbo viridis palette get_velocity get_color PI TAU';

// word → token class
const WORDS = new Map();
for (const [list, cls] of [[KW, 'tk-kw'], [TY, 'tk-ty'], [FN, 'tk-fn'], [LIB, 'tk-lib']])
  for (const w of list.split(' ')) WORDS.set(w, cls);

// One global tokenizer over HTML-escaped source. Groups: 1 comment, 2 uniform access, 3 number, 4 identifier, 5 operator.
// `<`, `>` and `&` arrive as entities, so the operator group matches those entities whole.
const RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S])))|(u\.[A-Za-z_]\w*)|(0[xX][0-9a-fA-F]+[iu]?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fuih]?)|([A-Za-z_]\w*)|(&(?:lt|gt|amp);|[-+*\/=!|^%])/gm;

const esc = s => s.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');
const span = (c, t) => `<span class="${c}">${t}</span>`;

// Highlight source → HTML. Lines are separated by raw '\n' and no span ever crosses one
// (block comments are re-opened per line), so the result can be split on '\n' safely.
export function highlight(src) {
  return esc(src).replace(RE, (m, cm, uni, num, id) => {
    if (cm) return m.includes('\n') ? m.split('\n').map(p => p ? span('tk-cm', p) : '').join('\n') : span('tk-cm', m);
    if (uni) return span('tk-uni', m);
    if (num) return span('tk-num', m);
    if (id) { const c = WORDS.get(m); return c ? span(c, m) : m; }
    return span('tk-op', m);
  });
}

const lineStartAt = (v, i) => i <= 0 ? 0 : v.lastIndexOf('\n', i - 1) + 1;

export class Editor {
  constructor(host, { value = '', onChange = null, onSubmit = null } = {}) {
    this.host = host;
    this.onChange = onChange;
    this.onSubmit = onSubmit;
    this._errs = new Map();
    this._n = 0;

    const root = this.root = document.createElement('div');
    root.className = 'ed';
    root.innerHTML = '<div class="ed-gutter"></div><div class="ed-body"><pre class="ed-hl"><code></code></pre><textarea class="ed-ta"></textarea></div>';
    this.gutter = root.firstChild;
    this.hl = root.lastChild.firstChild;
    this.code = this.hl.firstChild;
    const ta = this.ta = root.lastChild.lastChild;
    ta.setAttribute('wrap', 'off');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('aria-label', 'code');
    ta.spellcheck = false;
    ta.value = value;

    this._onInput = () => { this._render(); this._sync(); if (this.onChange) this.onChange(ta.value); };
    this._onScroll = () => this._sync();
    this._onKey = e => this._key(e);
    ta.addEventListener('input', this._onInput);
    ta.addEventListener('scroll', this._onScroll);
    ta.addEventListener('keydown', this._onKey);
    // Scrollbars come and go with the box size; keep the spacer in step without waiting for a scroll.
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(this._onScroll) : null;
    if (this._ro) this._ro.observe(ta);

    host.appendChild(root);
    this._render();
    this._sync();
  }

  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this._render(); this._sync(); }

  setErrors(list) {
    const m = this._errs = new Map();
    for (const { line, message } of list || []) {
      const l = line | 0;
      m.set(l, m.has(l) ? m.get(l) + '\n' + message : String(message ?? ''));
    }
    this._paintErrors();
  }

  focus() { this.ta.focus(); }

  destroy() {
    const ta = this.ta;
    ta.removeEventListener('input', this._onInput);
    ta.removeEventListener('scroll', this._onScroll);
    ta.removeEventListener('keydown', this._onKey);
    if (this._ro) this._ro.disconnect();
    this.root.remove();
  }

  // ---- rendering -------------------------------------------------------------------------

  _render() {
    const lines = highlight(this.ta.value).split('\n');
    const n = lines.length;
    let h = '';
    for (let i = 0; i < n; i++) h += '<span class="ed-line">' + lines[i] + '\n</span>';
    this.code.innerHTML = h;
    if (n !== this._n) {
      let g = '';
      for (let i = 1; i <= n; i++) g += '<div>' + i + '</div>';
      this.gutter.innerHTML = g;
      this._n = n;
    }
    if (this._errs.size) this._paintErrors();
  }

  _paintErrors() {
    const errs = this._errs, cl = this.code.children, gl = this.gutter.children;
    for (let i = 0; i < cl.length; i++) {
      const msg = errs.get(i + 1), a = cl[i], b = gl[i];
      a.classList.toggle('ed-err', msg !== undefined);
      if (msg !== undefined) a.title = msg; else a.removeAttribute('title');
      if (b) {
        b.classList.toggle('ed-err', msg !== undefined);
        if (msg !== undefined) b.title = msg; else b.removeAttribute('title');
      }
    }
  }

  // Copy the textarea's scroll to the pre and the gutter. The textarea's scrollbars eat into its
  // client box, so it can scroll a scrollbar's thickness further than the pre; the spacer
  // variables give the pre and the gutter exactly that much extra reach.
  _sync() {
    const ta = this.ta, root = this.root;
    const sbh = ta.offsetHeight - ta.clientHeight, sbw = ta.offsetWidth - ta.clientWidth;
    if (sbh !== this._sbh) { this._sbh = sbh; root.style.setProperty('--ed-sbh', sbh + 'px'); }
    if (sbw !== this._sbw) { this._sbw = sbw; root.style.setProperty('--ed-sbw', sbw + 'px'); }
    this.hl.scrollTop = ta.scrollTop;
    this.hl.scrollLeft = ta.scrollLeft;
    this.gutter.scrollTop = ta.scrollTop;
  }

  // ---- editing ---------------------------------------------------------------------------

  _key(e) {
    if (e.isComposing) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'Enter') { e.preventDefault(); if (this.onSubmit) this.onSubmit(this.ta.value); return; }
    if (mod && !e.altKey && (k === '/' || e.code === 'Slash')) { e.preventDefault(); this._toggleComment(); return; }
    if (mod || e.altKey) return;
    if (k === 'Tab') { e.preventDefault(); if (e.shiftKey) this._indent(-1); else this._tab(); return; }
    if (k === 'Enter') { e.preventDefault(); this._newline(); }
  }

  // Replace [start, end) with text, through execCommand so the browser's undo stack keeps working,
  // falling back to setRangeText (+ a synthetic input event) where execCommand is unavailable.
  _replace(start, end, text, selS = start + text.length, selE = selS) {
    const ta = this.ta;
    if (start === end && !text) return;
    const before = ta.value, want = before.slice(0, start) + text + before.slice(end);
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand(text ? 'insertText' : 'delete', false, text); } catch (_) { ok = false; }
    if (!ok || ta.value !== want) {
      if (ta.value === before) ta.setRangeText(text, start, end, 'end');
      else ta.value = want;
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: text ? 'insertText' : 'deleteContentBackward', data: text || null }));
    }
    ta.setSelectionRange(selS, selE);
  }

  // [start, end) of the whole lines the selection touches. A selection that ends right after a
  // newline does not claim the line below it.
  _block() {
    const ta = this.ta, v = ta.value, s = ta.selectionStart;
    let e = ta.selectionEnd;
    if (e > s && v[e - 1] === '\n') e--;
    const ls = lineStartAt(v, s);
    let le = v.indexOf('\n', e);
    if (le < 0) le = v.length;
    return [ls, le];
  }

  // Rewrite each line of the selection's block with fn, keeping the caret/selection on the same text.
  _mapLines(fn) {
    const ta = this.ta, v = ta.value, s0 = ta.selectionStart, e0 = ta.selectionEnd;
    const [ls, le] = this._block();
    const old = v.slice(ls, le), lines = old.split('\n');
    let d0 = 0, dt = 0;
    const out = lines.map((l, i) => { const r = fn(l); const d = r.length - l.length; if (i === 0) d0 = d; dt += d; return r; }).join('\n');
    if (out === old) return;
    const ns = Math.max(ls, s0 + d0);
    const ne = s0 === e0 ? ns : Math.max(ns, e0 + dt);
    this._replace(ls, le, out, ns, ne);
  }

  _tab() {
    const ta = this.ta, s = ta.selectionStart, e = ta.selectionEnd;
    if (e > s && ta.value.slice(s, e).includes('\n')) return this._indent(1);
    this._replace(s, e, '  ');
  }

  _indent(dir) {
    this._mapLines(dir > 0 ? l => '  ' + l : l => l.replace(/^(?: {1,2}|\t)/, ''));
  }

  _toggleComment() {
    const ta = this.ta, [ls, le] = this._block();
    const lines = ta.value.slice(ls, le).split('\n').filter(l => l.trim());
    const on = lines.length > 0 && lines.every(l => /^\s*\/\//.test(l));
    this._mapLines(on ? l => l.replace(/^(\s*)\/\/ ?/, '$1') : l => l.replace(/^([ \t]*)(?=\S)/, '$1// '));
  }

  _newline() {
    const ta = this.ta, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const line = v.slice(lineStartAt(v, s), s);
    const ind = /^[ \t]*/.exec(line)[0];
    const open = /\{[ \t]*$/.test(line);
    let text = '\n' + ind + (open ? '  ' : '');
    const caret = s + text.length;
    if (open && v[e] === '}') text += '\n' + ind;   // `{|}` → the brace lands on its own line under the caret
    this._replace(s, e, text, caret, caret);
  }
}
