// The user's own fields, kept in this browser. An entry is a name and a whole state — the same
// deflated string the share link carries — so loading one brings back the code, the settings and
// the camera exactly as they were saved. Names are unique; saving over one replaces it.

const KEY = 'fieldplay3d.library';
export const PREFIX = 'saved:';                 // how a saved field is named in the preset select

function read() {
  try { const a = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(a) ? a.filter(e => e && e.name && e.state) : []; }
  catch (e) { return []; }
}

function write(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); return true; }
  catch (e) { return false; }                   // private mode, or the quota is full
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Every saved field, by name. */
export const list = () => read().sort(byName);

export const find = name => read().find(e => e.name === name) || null;

/** Save (or replace) one. `state` is an encodeState() string. Returns the entry, or null if the
 *  browser refused to store it. */
export function save(name, state) {
  name = String(name).trim().slice(0, 60);
  if (!name || !state) return null;
  const items = read().filter(e => e.name !== name);
  const entry = { name, state, saved: Date.now() };
  items.push(entry);
  return write(items.sort(byName)) ? entry : null;
}

export function remove(name) {
  const items = read().filter(e => e.name !== name);
  write(items);
  return items;
}
