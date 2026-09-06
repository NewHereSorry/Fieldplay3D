// One uniform layout, declared once, consumed twice: the WGSL struct text and the JS writer.
// Follows WGSL's uniform address-space rules (vec3 aligns to 16 and occupies 12).
const T = { f32: [4, 4], u32: [4, 4], i32: [4, 4], vec2f: [8, 8], vec3f: [16, 12], vec4f: [16, 16], mat4x4f: [16, 64] };

export function layout(name, fields) {
  let off = 0; const map = {}; const lines = [];
  for (const [k, t] of fields) {
    const [al, sz] = T[t];
    off = (off + al - 1) & ~(al - 1);
    map[k] = { off: off >> 2, t };
    lines.push(`  ${k}: ${t},`);
    off += sz;
  }
  const size = (off + 15) & ~15;
  return {
    wgsl: `struct ${name} {\n${lines.join('\n')}\n}`,
    size,
    fields: map,
    // A writer: set(name, value) then upload .data with queue.writeBuffer.
    writer() {
      const data = new ArrayBuffer(size), f = new Float32Array(data), u = new Uint32Array(data), i = new Int32Array(data);
      return {
        data,
        set(k, v) {
          const m = map[k];
          if (v.length !== undefined) f.set(v, m.off);
          else if (m.t === 'u32') u[m.off] = v;
          else if (m.t === 'i32') i[m.off] = v;
          else f[m.off] = v;
        },
      };
    },
  };
}
