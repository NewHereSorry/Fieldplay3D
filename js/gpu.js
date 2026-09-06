// The WebGPU engine: particle buffers, the compute step around the user's field, the HDR trail
// textures and the three passes of a frame (fade + particles → trail, trail → canvas, box).
import { SIM, REN, DISP, BOX, WORKGROUP, LIB, simSource, PREFIX_LINES, RENDER, DISPLAY, BOXWIRE } from './shaders.js';

const TRAIL_FORMAT = 'rgba16float';
const UNI_STRIDE = 256;                 // one sim uniform slice per substep, dynamic offset
const ZERO4 = [0, 0, 0, 0];

export class Engine {
  static async create(canvas, { maxSubsteps = 16 } = {}) {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter. Enable hardware acceleration or try Chrome/Edge 113+.');
    const want = {};
    const req = ['maxBufferSize', 'maxStorageBufferBindingSize'];
    for (const k of req) want[k] = adapter.limits[k];
    const device = await adapter.requestDevice({ requiredLimits: want });
    return new Engine(device, adapter, canvas, maxSubsteps);
  }

  constructor(device, adapter, canvas, maxSubsteps) {
    this.device = device; this.adapter = adapter; this.canvas = canvas; this.maxSubsteps = maxSubsteps;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx = canvas.getContext('webgpu');
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.maxCount = Math.min(1 << 23, Math.floor(device.limits.maxStorageBufferBindingSize / 16));
    this.count = 0; this.frameIndex = 0; this.time = 0; this.seed = 1;
    this.needReset = true; this.clearTrails = true;
    this.simPipeline = null; this.compileToken = 0;
    this.width = 0; this.height = 0; this.cur = 0;
    this.onFrameEnd = null;
    this._build();
    device.lost.then(info => { this.lost = info; console.error('WebGPU device lost:', info.message); });
  }

  _build() {
    const d = this.device;
    const st = (binding, type, vis) => ({ binding, visibility: vis, buffer: { type } });
    this.simBGL = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
      st(1, 'storage', GPUShaderStage.COMPUTE), st(2, 'storage', GPUShaderStage.COMPUTE), st(3, 'storage', GPUShaderStage.COMPUTE)] });
    this.renBGL = d.createBindGroupLayout({ entries: [
      st(0, 'uniform', GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT),
      st(1, 'read-only-storage', GPUShaderStage.VERTEX), st(2, 'read-only-storage', GPUShaderStage.VERTEX), st(3, 'read-only-storage', GPUShaderStage.VERTEX)] });
    this.dispBGL = d.createBindGroupLayout({ entries: [
      st(0, 'uniform', GPUShaderStage.FRAGMENT),
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
    this.boxBGL = d.createBindGroupLayout({ entries: [st(0, 'uniform', GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT)] });

    this.simLayout = d.createPipelineLayout({ bindGroupLayouts: [this.simBGL] });
    const U = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    this.simUB = d.createBuffer({ size: UNI_STRIDE * this.maxSubsteps, usage: U });
    this.renUB = d.createBuffer({ size: REN.size, usage: U });
    this.dispUB = d.createBuffer({ size: DISP.size, usage: U });
    this.boxUB = d.createBuffer({ size: BOX.size, usage: U });
    this.simW = SIM.writer(); this.renW = REN.writer(); this.dispW = DISP.writer(); this.boxW = BOX.writer();
    this.simData = new Uint8Array(UNI_STRIDE * this.maxSubsteps);
    this.simBytes = new Uint8Array(this.simW.data);
    this.boxBG = d.createBindGroup({ layout: this.boxBGL, entries: [{ binding: 0, resource: { buffer: this.boxUB } }] });

    // Render pipelines: three particle shapes into the HDR trail texture, additive.
    const rm = d.createShaderModule({ code: RENDER });
    const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
    const renLayout = d.createPipelineLayout({ bindGroupLayouts: [this.renBGL] });
    const mk = (vs, fs, topology) => d.createRenderPipeline({ layout: renLayout,
      vertex: { module: rm, entryPoint: vs }, fragment: { module: rm, entryPoint: fs, targets: [{ format: TRAIL_FORMAT, blend: add }] },
      primitive: { topology } });
    this.pipeLine = mk('vsLine', 'fsFlat', 'line-list');
    this.pipePoint = mk('vsPoint', 'fsFlat', 'point-list');
    this.pipeQuad = mk('vsQuad', 'fsQuad', 'triangle-list');

    const dm = d.createShaderModule({ code: DISPLAY });
    const dispLayout = d.createPipelineLayout({ bindGroupLayouts: [this.dispBGL] });
    this.pipeFade = d.createRenderPipeline({ layout: dispLayout, vertex: { module: dm, entryPoint: 'vsFull' },
      fragment: { module: dm, entryPoint: 'fsFade', targets: [{ format: TRAIL_FORMAT }] }, primitive: { topology: 'triangle-list' } });
    this.pipeDisplay = d.createRenderPipeline({ layout: dispLayout, vertex: { module: dm, entryPoint: 'vsFull' },
      fragment: { module: dm, entryPoint: 'fsDisplay', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' } });

    const bm = d.createShaderModule({ code: BOXWIRE });
    this.pipeBox = d.createRenderPipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: [this.boxBGL] }),
      vertex: { module: bm, entryPoint: 'vs' },
      fragment: { module: bm, entryPoint: 'fs', targets: [{ format: this.format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
      primitive: { topology: 'line-list' } });
  }

  // Particle storage. Contents come from the next compute step's reset branch.
  setCount(n) {
    n = Math.max(WORKGROUP, Math.min(this.maxCount, n | 0));
    if (n === this.count) return;
    const d = this.device;
    for (const b of [this.posB, this.prevB, this.colB]) b && b.destroy();
    const mkb = () => d.createBuffer({ size: n * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.posB = mkb(); this.prevB = mkb(); this.colB = mkb();
    const ent = ub => [{ binding: 0, resource: { buffer: ub, size: ub === this.simUB ? SIM.size : undefined } },
      { binding: 1, resource: { buffer: this.posB } }, { binding: 2, resource: { buffer: this.prevB } }, { binding: 3, resource: { buffer: this.colB } }];
    this.simBG = d.createBindGroup({ layout: this.simBGL, entries: ent(this.simUB) });
    this.renBG = d.createBindGroup({ layout: this.renBGL, entries: ent(this.renUB) });
    this.count = n; this.needReset = true; this.clearTrails = true;
  }

  reset() { this.needReset = true; this.clearTrails = true; }

  // Compile the user's field into the compute pipeline. Keeps the previous one on failure.
  async compile(code) {
    const token = ++this.compileToken;
    const d = this.device;
    const module = d.createShaderModule({ code: simSource(code) });
    const info = await module.getCompilationInfo();
    const msgs = info.messages.map(m => ({ type: m.type, line: m.lineNum - PREFIX_LINES, col: m.linePos, message: m.message }));
    const errors = msgs.filter(m => m.type === 'error');
    if (errors.length) return { ok: false, errors, warnings: msgs.filter(m => m.type !== 'error') };
    let pipeline;
    try {
      pipeline = await d.createComputePipelineAsync({ layout: this.simLayout, compute: { module, entryPoint: 'main' } });
    } catch (e) {
      return { ok: false, errors: [{ type: 'error', line: 0, col: 0, message: e.message }], warnings: [] };
    }
    if (token !== this.compileToken) return { ok: true, stale: true, errors: [], warnings: [] };
    this.simPipeline = pipeline;
    return { ok: true, errors: [], warnings: msgs.filter(m => m.type !== 'error') };
  }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    const d = this.device;
    for (const t of this.trail || []) t.destroy();
    this.trail = [0, 1].map(() => d.createTexture({ size: [w, h], format: TRAIL_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC }));
    this.trailView = this.trail.map(t => t.createView());
    this.dispBG = this.trailView.map(v => d.createBindGroup({ layout: this.dispBGL, entries: [{ binding: 0, resource: { buffer: this.dispUB } }, { binding: 1, resource: v }] }));
    this.clearTrails = true;
  }

  // One frame. S = the settings object, cam = OrbitCamera (already updated), ctl = per-frame controls.
  frame(S, cam, ctl) {
    if (this.lost || !this.simPipeline || !this.count || !this.width) return;
    const d = this.device, q = d.queue;
    const substeps = Math.max(1, Math.min(this.maxSubsteps, S.substeps | 0));
    const bmin = [S.box.c[0] - S.box.s[0] / 2, S.box.c[1] - S.box.s[1] / 2, S.box.c[2] - S.box.s[2] / 2];
    const bmax = [S.box.c[0] + S.box.s[0] / 2, S.box.c[1] + S.box.s[1] / 2, S.box.c[2] + S.box.s[2] / 2];
    const enc = d.createCommandEncoder();

    const stepping = !ctl.paused || this.needReset;
    const steps = this.needReset ? 1 : substeps;
    if (stepping) {
      const w = this.simW, dt = S.dt;
      w.set('boundsMin', bmin); w.set('boundsMax', bmax);
      w.set('cursor', ctl.cursor); w.set('cursorDown', ctl.cursorDown ? 1 : 0);
      w.set('color', S.colorLin); w.set('dropProb', S.drop);
      w.set('count', this.count); w.set('integrator', S.integrator); w.set('colorMode', S.colorMode);
      w.set('speed', S.speed * (ctl.speedMul || 1)); w.set('minLife', S.life * 0.5); w.set('maxLife', S.life * 1.5);
      w.set('colorScale', S.colorScale); w.set('palette', S.palette); w.set('spawn', S.spawn);
      w.set('fadeLife', 0.15);
      w.set('audio', ctl.audio || ZERO4); w.set('beat', ctl.beat || 0); w.set('phase', ctl.phase || 0); w.set('bpm', ctl.bpm || 0);
      // Cursor radius is a fraction of the box, so it means the same thing in every preset.
      w.set('cursorMode', ctl.cursorMode || 0); w.set('cursorForce', S.cursorForce);
      w.set('cursorRadius', S.cursorRadius * 0.5 * Math.hypot(S.box.s[0], S.box.s[1], S.box.s[2]));
      w.set('cursorAxis', cam.Z);
      for (let s = 0; s < steps; s++) {
        w.set('dt', dt); w.set('time', this.time); w.set('frame', this.frameIndex);
        w.set('seed', (this.seed = (this.seed + 0x9E3779B9) >>> 0)); w.set('substep', s);
        w.set('reset', this.needReset ? 1 : 0);
        this.simData.set(this.simBytes, s * UNI_STRIDE);
        if (!this.needReset) this.time += dt;
      }
      q.writeBuffer(this.simUB, 0, this.simData, 0, steps * UNI_STRIDE);
      const pass = enc.beginComputePass();
      pass.setPipeline(this.simPipeline);
      const groups = Math.ceil(this.count / WORKGROUP);
      for (let s = 0; s < steps; s++) { pass.setBindGroup(0, this.simBG, [s * UNI_STRIDE]); pass.dispatchWorkgroups(groups); }
      pass.end();
      this.needReset = false;
    }
    this.frameIndex++;

    // Render uniforms.
    const r = this.renW;
    r.set('viewProj', cam.viewProj); r.set('eye', cam.eye); r.set('fog', S.fog);
    r.set('viewport', [this.width, this.height]); r.set('width', S.width * ctl.dpr); r.set('intensity', S.intensity * 65536 / this.count);
    r.set('persp', S.persp ? 1 : 0); r.set('fogRef', cam.viewDist || cam.dist);
    q.writeBuffer(this.renUB, 0, r.data);
    const dsp = this.dispW;
    const fade = ctl.motion > 0.06 ? Math.min(S.fade, S.fadeMoving) : S.fade;   // ctl.motion in rad/s
    dsp.set('bg', S.bgLin); dsp.set('exposure', S.exposure * (ctl.glowMul || 1)); dsp.set('fade', this.clearTrails ? 0 : fade);
    dsp.set('eps', 0.0015); dsp.set('gamma', 2.2);
    q.writeBuffer(this.dispUB, 0, dsp.data);
    const bx = this.boxW;
    const lum = 0.2126 * S.bgLin[0] + 0.7152 * S.bgLin[1] + 0.0722 * S.bgLin[2];
    bx.set('viewProj', cam.viewProj); bx.set('bmin', bmin); bx.set('bmax', bmax); bx.set('alpha', S.showBox ? 0.22 : 0); bx.set('ink', lum > 0.18 ? 1 : 0);
    q.writeBuffer(this.boxUB, 0, bx.data);

    // Pass 1: fade last frame's trail into the other texture, then add the particles.
    const cur = this.cur, prv = cur ^ 1;
    const p1 = enc.beginRenderPass({ colorAttachments: [{ view: this.trailView[cur], loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
    p1.setPipeline(this.pipeFade); p1.setBindGroup(0, this.dispBG[prv]); p1.draw(3);
    p1.setBindGroup(0, this.renBG);
    if (S.shape === 1) { p1.setPipeline(this.pipePoint); p1.draw(this.count); }
    else if (S.shape === 2) { p1.setPipeline(this.pipeQuad); p1.draw(6, this.count); }
    else { p1.setPipeline(this.pipeLine); p1.draw(this.count * 2); }
    p1.end();

    // Pass 2: trail → canvas, plus the box.
    const p2 = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }] });
    p2.setPipeline(this.pipeDisplay); p2.setBindGroup(0, this.dispBG[cur]); p2.draw(3);
    if (S.showBox) { p2.setPipeline(this.pipeBox); p2.setBindGroup(0, this.boxBG); p2.draw(24); }
    p2.end();

    q.submit([enc.finish()]);
    this.cur = prv; this.clearTrails = false;
    if (this.onFrameEnd) { const f = this.onFrameEnd; this.onFrameEnd = null; f(); }
  }

  screenshot(type = 'image/png') {
    return new Promise(res => { this.onFrameEnd = () => this.canvas.toBlob(res, type); });
  }

  get info() {
    const i = this.adapter.info || {};
    return `${i.vendor || ''} ${i.architecture || ''} ${i.description || i.device || ''}`.trim() || 'WebGPU';
  }
}

export { LIB };
