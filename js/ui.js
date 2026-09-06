// The settings panel, built from the schema in state.js. Rows read and write the state object directly
// and call onChange(key) so the app can act on the few keys that need it.
import { SCHEMA } from './state.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export function buildSettings(host, S, onChange) {
  const rows = [];
  let group = null;
  for (const f of SCHEMA) {
    if (f.group) { group = el('div', 'grp'); group.append(el('div', 'grp-title', f.group)); host.append(group); continue; }
    const row = el('label', 'ctl');
    row.append(el('span', 'lbl', f.label));
    let sync;
    const fmt = f.fmt || (v => String(v));
    switch (f.type) {
      case 'range': {
        const input = el('input'), val = el('span', 'val');
        input.type = 'range';
        const warped = f.log || f.map;
        const toSlider = v => f.log ? Math.log(v / f.min) / Math.log(f.max / f.min) * 1000 : f.map ? f.map.from(v) * 1000 : v;
        const fromSlider = x => f.log ? f.min * Math.pow(f.max / f.min, x / 1000) : f.map ? f.map.to(x / 1000) : x;
        if (warped) { input.min = 0; input.max = 1000; input.step = 1; }
        else { input.min = f.min; input.max = f.max; input.step = f.step || 'any'; }
        input.addEventListener('input', () => { S[f.key] = fromSlider(+input.value); val.textContent = fmt(S[f.key]); onChange(f.key); });
        sync = () => { input.value = toSlider(S[f.key]); val.textContent = fmt(S[f.key]); };
        row.append(input, val);
        break;
      }
      case 'select': {
        const sel = el('select');
        f.options.forEach((o, i) => { const op = el('option', null, o); op.value = i; sel.append(op); });
        sel.addEventListener('change', () => { S[f.key] = +sel.value; onChange(f.key); });
        sync = () => { sel.value = S[f.key]; };
        row.append(sel);
        break;
      }
      case 'check': {
        const cb = el('input'); cb.type = 'checkbox';
        cb.addEventListener('change', () => { S[f.key] = cb.checked ? 1 : 0; onChange(f.key); });
        sync = () => { cb.checked = !!S[f.key]; };
        row.append(cb, el('span', 'grow'));
        break;
      }
      case 'color': {
        const c = el('input'); c.type = 'color';
        c.addEventListener('input', () => { S[f.key] = c.value; onChange(f.key); });
        sync = () => { c.value = S[f.key]; };
        row.append(c, el('span', 'grow'));
        break;
      }
      case 'box': {
        const grid = el('div', 'box-grid'), inputs = [];
        for (const [k, key] of [['centre', 'c'], ['size', 's']]) {
          grid.append(el('span', 'k', k));
          for (let i = 0; i < 3; i++) {
            const n = el('input'); n.type = 'number'; n.step = 'any'; if (key === 's') n.min = 0.001;
            n.addEventListener('change', () => { const v = parseFloat(n.value); if (isFinite(v)) S.box[key][i] = key === 's' ? Math.max(1e-3, v) : v; onChange('box'); sync(); });
            inputs.push([n, key, i]); grid.append(n);
          }
        }
        sync = () => { for (const [n, key, i] of inputs) n.value = +S.box[key][i].toPrecision(5); };
        row.append(grid);
        break;
      }
    }
    group.append(row);
    rows.push({ f, row, sync });
  }
  const refresh = () => { for (const r of rows) { r.sync(); r.row.hidden = r.f.show ? !r.f.show(S) : false; } };
  refresh();
  return { refresh };
}

let toastTimer = 0;
export function toast(msg, ms = 1800) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
