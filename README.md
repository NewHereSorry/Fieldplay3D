# fieldplay 3D

A 3D take on [anvaka/fieldplay](https://github.com/anvaka/fieldplay): type a vector field, watch particles flow through it. Here the field is `fn get_velocity(p: vec3f) -> vec3f`, the particles live in a volume, and everything about them runs on the GPU in a WebGPU compute shader.

```
python fieldplay3d/serve.py 5225      # then open http://localhost:5225
```

Needs a browser with WebGPU (Chrome/Edge 113+, Safari 26, Firefox 141+). The Claude desktop app's built-in browser has `navigator.gpu` but no adapter, so verification runs through headless Chrome (see Tools).

## How a frame works

1. **Compute** (`js/shaders.js` → `simSource`, one dispatch per substep, workgroups of 256). Each particle reads its position, asks the user's `get_velocity` for its velocity, integrates (Euler / midpoint / RK4, chosen per frame by a uniform), ages, and is reborn at a random point in the bounds when it leaves the box, exceeds its random lifespan, hits the drop probability, or overflows. The compute shader also writes the particle's colour (uniform / speed through a palette / direction / the user's `get_color`). Buffers: `pos` (xyz + age), `prev` (xyz at the start of the frame + lifespan), `col` (rgb + alpha). Randomness is an integer PCG hash of (index, seed).
2. **Trail pass** into one of two `rgba16float` textures: a fullscreen triangle writes `max(0, last * fade − ε)` (fieldplay's fading trick, in HDR, with a floor so nothing lingers), then the particles are drawn additively as streaks (a 1-px line from `prev` to `pos`, so trails stay continuous at big time steps), points, or soft strokes (screen-space capsules with a pixel width, antialiased in the fragment shader, optionally sized by perspective).
3. **Display pass**: exposure tone map `1 − exp(−c·exposure)`, composed onto the background as light on dark or ink on light, gamma, plus the faint wireframe bounds.

When the camera moves fast the fade drops to *Trail while orbiting* so the old trails dissolve instead of smearing across the screen.

## Files

| file | role |
|---|---|
| `js/layout.js` | uniform struct declared once → WGSL text + a JS writer with the right offsets |
| `js/shaders.js` | WGSL: helper library, compute template, render / display / box shaders |
| `js/gpu.js` | `Engine`: device, buffers, pipelines, compile with line mapping, the frame |
| `js/camera.js` | orbit camera, matrices, pointer/wheel/pinch input, cursor → plane ray |
| `js/editor.js` | dependency-free WGSL editor (highlight overlay, gutter, error lines) |
| `js/presets.js` | the gallery: attractors and analytic flows with their bounds, dt and camera |
| `js/random.js` | seeded random-field grammar |
| `js/state.js` | defaults, the settings schema the panel is built from, share-link codec |
| `js/ui.js` | schema → panel rows, toast, download |
| `js/main.js` | bootstrap, loop, persistence, toolbar, keys, `window.FP` harness |
| `tests/index.html` | GPU tests: layouts, codec, camera, every preset compiles, 40 random fields, error mapping, a 30-frame run read back |
| `tests/editor.html` | editor component checks |
| `tools/shot.py` | headless Chrome (CDP) screenshot of a WebGPU page; `--text` prints the page text |

## Tools

```
python fieldplay3d/tools/shot.py http://localhost:5225/tests/index.html out.png --wait 20000 --text
python fieldplay3d/tools/shot.py "http://localhost:5225/?preset=lorenz" shot.png --width 1600 --height 900 --wait 4000
python fieldplay3d/tools/shot.py "http://localhost:5225/?preset=ring" soft.png --pre "while(!window.FP) await new Promise(r=>setTimeout(r,50)); FP.S.shape=2; return 'ok'" --eval "return FP.engine.count"
```

`--pre` runs JavaScript statements after load and before the wait, `--eval` after the wait (use `return` for a printed value, `await` is allowed). `?preset=<id>` opens a preset fresh, ignoring the saved state; the URL hash carries a whole shared state.

`window.FP` exposes `S` (settings), `engine`, `cam`, `editor`, `compile()`, `loadPreset(p)`, `frame()`, `pause(v)`.

## The field API

`get_velocity(p)` gets the position, returns the velocity. Optional `get_color(p, v)`. Uniforms `u.time`, `u.frame`, `u.cursor`, `u.cursorDown`, `u.boundsMin`, `u.boundsMax`. Helpers `noise`, `noised`, `fbm`, `curl`, `hash3`, `hash1`, `rand3`, `rotateX/Y/Z`, `turbo`, `viridis`, `hsv2rgb`, `palette`, `PI`, `TAU`. The whole state (code, settings, camera) is deflated into the URL hash by the link button and autosaved to localStorage.
