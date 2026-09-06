// Random field generator: a small expression grammar over p, printed as WGSL. Seeded so a field
// can be regenerated from the number in its first comment line.

export function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function randomField(seed = (Math.random() * 1e9) | 0) {
  const rng = mulberry32(seed);
  const pick = a => a[(rng() * a.length) | 0];
  const num = (lo = -2, hi = 2) => (Math.round((lo + rng() * (hi - lo)) * 100) / 100).toFixed(2);
  const LEAF = ['p.x', 'p.y', 'p.z', 'p.x', 'p.y', 'p.z', 'p.x', 'p.y', 'p.z', 'length(p)', 'length(p.xy)', 'length(p.yz)', 'length(p.xz)'];
  const leaf = () => { const k = rng(); return k < 0.8 ? pick(LEAF) : k < 0.92 ? num() : 'u.time'; };
  const expr = d => {
    if (d <= 0) return leaf();
    const k = rng();
    if (k < 0.34) return `${pick(['sin', 'cos', 'sin', 'cos', 'tanh', 'abs'])}(${expr(d - 1)})`;
    if (k < 0.74) return `${expr(d - 1)} ${pick(['+', '-', '*', '+', '*'])} ${expr(d - 1)}`;
    if (k < 0.86) return `${num(0.3, 3)} * ${expr(d - 1)}`;
    if (k < 0.93) return `noise(p * ${num(0.5, 3)})`;
    return leaf();
  };
  const comp = () => { const e = expr(2 + (rng() < 0.5 ? 1 : 0)); return rng() < 0.55 ? `${pick(['sin', 'cos'])}(${e})` : e; };
  return `// random field ${seed}
fn get_velocity(p: vec3f) -> vec3f {
  return vec3f(
    ${comp()},
    ${comp()},
    ${comp()});
}
`;
}
