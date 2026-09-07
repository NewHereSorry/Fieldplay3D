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
| `js/library.js` | the fields you saved yourself: name → a whole state, in this browser |
| `js/audio.js` | Pulse: Aux Cord clock + beat map sampling, or live Web Audio analysis → bass/mid/high/level/beat/phase/bpm |
| `js/state.js` | defaults, the settings schema the panel is built from, share-link codec |
| `js/ui.js` | schema → panel rows, toast, download |
| `js/main.js` | bootstrap, loop, persistence, toolbar, keys, `window.FP` harness |
| `js/tutor.js` | the tutorial: the step list, the spotlight and the hand it drives |
| `tests/index.html` | GPU tests: layouts, codec, camera, every preset compiles, 40 random fields, error mapping, a 30-frame run read back |
| `tests/editor.html` | editor component checks |
| `tests/tutor.html` | tutorial component checks, against a stub app |
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

## Pulse — sync to music

The *Pulse* group in the panel drives the look from music: **Aux Cord bot** polls the bot's localhost endpoint (`GET /now` for the player's rate-aware clock, `GET /analysis?key=` for the track's 50 Hz band timeline + beat map, made by `dashcord/bots/aux-cord/auxcord/pulse.py`) and samples it at the moment the room hears, with a *Sync offset* for Discord's latency; **Shared audio** / **Microphone** analyse live sound in the browser (Web Audio, adaptive band peaks, a bass-onset beat detector). Either way `js/audio.js` produces bass/mid/high/level, a decaying `beat`, `phase` and `bpm`; the knobs punch speed, exposure and a camera zoom on the beat, and the field sees `u.audio`, `u.beat`, `u.phase`, `u.bpm`. The "Pulse (sync to music)" preset shows the idiom.

**Nothing is requested of the browser on its own.** Screen or tab sharing, the microphone and the fetch to the bot's port all wait for an explicit *Start* in the Pulse panel — never a page load, a field load or a stray click. `pulseOn` is session state, stripped by `encodeState` and forced false by `decodeState`, so a link or a saved field can name a source but never arrive already listening; loading a field leaves a running source running and corrects the picker to match it. Without Discord: `python -m auxcord.pulse song.mp3` (from the bot folder) serves one file's pulse on 5226.

## The tutorial

**Tutorial** in the panel header runs a half-minute tour. It never starts by itself. The first two steps are the whole idea: the code is lit and everything else goes dark — *this is the maths* — and then the light swaps to the picture alone — *this is that same function, as wind*. After that it stops describing and starts doing: it holds the cursor down and stirs the flow with a visible ring, changes only the look keys to show the photograph is separate from the physics, loads Lorenz, and points at 🎲 and 🔗.

Every step drives the real app through the paths everything else uses — `loadPreset`, ordinary settings, and the same cursor uniform a real hand writes — so there is nothing in `js/tutor.js` that renders or simulates anything. A step is `{spot, title, body, ms, enter, tick, exit}`, where `spot` is a selector, `'display'` for the canvas outside the panel, or `null` for no dimming; the dim is one element's `box-shadow`, so exactly one rectangle is lit at a time.

The whole state is deflated on entry and put back on exit — on the last step, on Skip, or on Escape — so a tour never costs anyone the field they were working on. Click anywhere to move on.

## Saving your own

💾 stores the whole state — field, settings and camera — in this browser under a name, and it joins the picker under *Saved*; the same name replaces, 🗑 forgets the selected one. A saved entry holds the same deflated string the 🔗 link carries, so `library.save(name, await encodeState(S))` and the share link are one format. Storage key `fieldplay3d.library`.

## The cursor

Holding the **left button** bends the flow toward the pointer; the **middle button** does the opposite, which is the same gesture with a negated `cursorForce` — so pull becomes push and swirl turns the other way, and the shader needs one code path, not three. *Cursor → Left button* picks pulls / pushes / swirls / does nothing, with *Strength* and *Reach* as a fraction of the box. The force is applied inside `field()`, so every integrator stage sees it, and it is proportional to the local speed — one strength reads the same in a gentle swirl and in a Lorenz attractor.

Because the left and middle buttons are the cursor's, the camera moved: **right-drag orbits**, **shift or ctrl drag pans**, the wheel zooms. Touch is unchanged (one finger orbits, two pan and pinch) since a finger has no buttons, and a camera drag never disturbs the flow.

## Live

Deployed on Cloudflare Pages at **https://fieldplay3d.pages.dev** (project `fieldplay3d`, production branch `main`). Redeploy with:

```
python fieldplay3d/tools/deploy.py
```

(one-time `npx wrangler login` first; the OAuth page must be approved within two minutes.)
