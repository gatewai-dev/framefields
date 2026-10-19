# framefields

## 2.3.2

### Patch Changes

- 1c5919f: Fix native C++ memory leaks in headless video and still renders:
  - Decouple headless Lottie rendering from `skia-canvas`, reading straight-alpha pixels directly from the underlying ThorVG WASM linear buffer (`_dotLottieCore.get_pixel_buffer()`) into an instance-reused upload buffer before writing to the WebGPU texture, eliminating megabytes of native heap leakage per frame.
  - Add frame-based eviction (`mediaDecoderCache.tick()`) for video and audio decoders of clips that ended over 120 frames ago, and pool still render IDs to prevent decoder re-instantiation across consecutive stills.

## 2.3.1

### Patch Changes

- 0415bc7: Fix 3D extruded text in the browser preview filling the notches of letters such as V and M. Without skia's outline merge, glyph contours that cross themselves (common in variable fonts) were triangulated as-is; they are now split at their self-crossings and filled with the nonzero rule, matching rendered output.

## 2.3.0

### Minor Changes

- 303c410: `withVision({ mode: "matte" })` (and `mask` / `crop`) on a video layer now reuses `comp.vision(clip)`'s per-frame results when the composition already analyses that clip, instead of segmenting every frame a second time during render. The clip keeps each frame's full-resolution subject mask (merged the same way as the matte), persisted beside its other results in the vision cache, and the cutout uses the mask for the frame being drawn, so it no longer runs one frame behind the plate. Layers whose settings would give a different subject (`classes`, `keyBackground`, `matteSource: "selfie"`, a different `variant` / `confidence` / `maskThreshold` / `featherRadius`, or an attached vision bundle) keep their own segmentation, and so do frames the clip has not analysed.
- 4625cc7: Add rigid-body physics: `Physics.world2d` / `Physics.world3d` (Rapier, deterministic) simulate once while the composition is built and replay as per-frame signals. Bodies come from layers (boxes, circles, convex hulls of shapes, measured text, Layer3D primitives and models); `simulate()` binds each layer, and every body exposes `impact`, `speed`, velocity and pose signals for driving any prop or effect. Includes ground/walls, pins, hinges, welds, springs, ropes, signal-driven forces and kinematic bodies, collision lists, and `bakeKeyframes()` for plain keyframes.

  `world.field()` adds position-dependent forces (wind, vortices, flow fields). `world.live(comp)` steps a world as the composition renders instead of all at once: before each frame draws it advances to it, after that frame's inputs are ready, giving the same result as `simulate()`.

  `comp.vision(clip)` analyses a clip's own frames on demand (pose keypoints and a soft silhouette) and shares the results with everything that reads them; every render path and the preview await it before drawing a frame, and results persist on disk in Node. `comp.onPrepareFrame()` registers async per-frame work, and the renderer awaits an `onRequestFrame` that returns a promise. `colorSignal` takes `multiplier` and `offset`.

  `Layer.particles` adds GPU particle systems: a compute-shader simulation (emitters, curl-noise flow, attractors, gravity, drag, floors and bounds, a performer's silhouette push) drawn in one instanced call, with snapshots so scrubbing back restores state. New temporal effects: `Trails` (echoes, light painting, feedback tunnels) and `Datamosh` (pixels dragged along optical flow between keyframes).

  3D `glass`, `acrylic` and `frosted` materials now refract what is behind them on screen (with dispersion, thickness, tint and studio reflections) instead of drawing as translucent plastic. Particle emitters can move: `emitter.x` / `emitter.y` take drivers, and births spread along the path between frames (light painting from a tracked hand).

- 6685719: Add a stylize effect pack: `Pixelate` (square, circle/LED and diamond cells), `Posterize` (levels or retro palettes: GameBoy, teletext, CGA, PICO-8, C64, grayscale, sepia, custom; with Bayer dithering and big pixels), `Dither` (Bayer, noise and halftone; 1-bit duotone or per channel), `Ascii`, `Toon` (cel bands and ink outlines), `RGBSplit`, `CRT` (curvature, scanlines, aperture mask, plus VHS tracking and colour bleed), `Painterly` (Kuwahara oil and watercolour), `Contour` (topographic lines), `Kaleidoscope`, `OpArt`, `Iridescence` (holographic foil) and `Gooey` (metaballs).

  `Styles.*` presets return ready-made effect stacks for common looks (`pixelArt`, `gameBoy`, `teletext`, `ledWall`, `ascii`, `oneBit`, `risograph`, `comic`, `cartoon`, `thermal`, `vhs`, `crt`, `glitch`, `oilPainting`, `watercolor`, `topographic`, `kaleidoscope`, `opArt`, `holographic`, `noir`, `film`): `layer.withEffects(Styles.vhs())`.

  `LayerAnimation.stepped(n)` gives a layer stepped timing ("on twos"): every animated value is held for `n` frames, eases kept. A shape's `d` is now animatable: keyframed SVG paths morph into each other, resampled and aligned so paths with different point counts, curves and subpaths morph cleanly.

  `Layer.vfx()` draws `ProceduralVFX` looks as their own layer (the node was not registered before), and adds an `Aurora` effect type.

## 2.2.0

### Minor Changes

- cf65727: Headless rendering for long-lived workers and any Linux machine:

  - Video encoding uses a hardware encoder (NVENC, VideoToolbox) only after testing that it works, and software encoders (libx264, libx265, libvpx, SVT-AV1) otherwise. This fixes H.264/HEVC renders on linux-arm64, where `h264_rkmpp` was picked without Rockchip hardware, and on NVIDIA GPUs without NVENC (A100, H100). Set `FRAMEFIELDS_HW_CODECS=off` to always encode in software.
  - WebGPU falls back to a software adapter (e.g. lavapipe) when no GPU adapter is available. The new `describeGpu()` reports the adapter in use and whether it is a CPU one.
  - `renderVideo` accepts `signal` (AbortSignal) and `onProgress`; `resetRenderCaches()` clears per-render caches between jobs in one process.

- 60c35a0: Faster on-device vision, on the GPU by default:

  - Vision layers no longer reload their models every frame. Layers whose options differed (e.g. one with `classes: ["person"]` and one without) used to close and recreate their ONNX sessions on each frame; they now share sessions through `VisionRunner.derive()`. This also fixes the `thread constructor failed: Resource temporarily unavailable` crash with `onnxruntime-web` installed.
  - Layers that hand vision the same pixels (two panels of one video) share one RTMDet-Ins pass.
  - `onnxruntime-web` is now an optional dependency of `framefields`, so inference runs on WebGPU when there is a hardware adapter. Dawn's `GPUSupportedFeatures` gains the `forEach` that onnxruntime-web's WebGPU build needs. Software adapters (lavapipe, SwiftShader) use the CPU instead.
  - CPU sessions on Linux size their thread pool from the CPUs the process may use, cgroup quota included, instead of the host's cores. `FRAMEFIELDS_VISION_THREADS` overrides it.
  - `FRAMEFIELDS_VISION_PROVIDER` (`auto`, `webgpu`, `cpu`, `cuda`) forces a backend; `cuda` uses onnxruntime-node's CUDA EP on Linux x64.

  The smoke project's `vision` export (three vision layers, 60 frames of 1280×720) on an Apple Silicon Mac: 84.9 s before; 41–43 s on the CPU and 26–29 s on the GPU after. In the renderer worker on a RunPod RTX 3070: 58.7 s before, 22–25 s after.

### Patch Changes

- 9b70fda: Asset and font paths no longer depend on the `BASE_URL` and `R2_CUSTOM_DOMAIN` environment variables, left over from the Gatewai web app. With `BASE_URL` set, a font registered from an absolute path was fetched from `$BASE_URL/<path>`, and when that failed the engine quietly used a font from the `R2_CUSTOM_DOMAIN` CDN instead of the project's file. Absolute paths are now always read from disk, and Lottie sources and fonts are used as given instead of being prefixed with `http://localhost:8081`.

  Removed from `@framefields/client-utils`: `getEnv`, `BASE_URL`, `R2_CUSTOM_DOMAIN`, `configureAssetUrls` and the `options` argument of `GetAssetEndpoint`, `GetFontAssetUrl`, `resolveMediaSourceUrl` and `ResolveFileDataUrl`. Removed from `@framefields/compositions`: `getFontUrl`.

- 6adfd26: Requires mediabunny and @mediabunny/server 1.61.6 or newer. Encoded video now carries correct colour: older versions converted RGB to YUV with BT.601 and left the output untagged, so reds came out dull and blues shifted. 1.61.5, the first release with the colour fix, also slowed RGB encoding about 5×; 1.61.6 fixes that, and the new minimum keeps installs off 1.61.5.
- edfe483: `resetRenderCaches()` also forgets registered font files and deletes fonts downloaded from URLs (`clearHeadlessFonts()`). Before, the first file registered for a family stayed in use for the life of the process. In a long-lived worker, the next project's "Inter" then loaded the previous project's file, and failed once that checkout was evicted. Downloaded fonts now go to a fresh temp folder per session instead of a shared `gatewai-fonts`.
- 5c55a7b: Vision layers no longer copy frames to the CPU. ONNX Runtime's WebGPU sessions now run on the renderer's own device (`setVisionDevice`), and a compute shader turns the layer's texture straight into each model's input tensor. It does the same resize, letterbox, channel order and normalisation as `imageToTensor`, within float32 rounding. A small GPU checksum replaces hashing the pixels on the CPU, so layers showing the same frame still share a pass. Frames come back to the CPU only for the opt-in background key (`keyBackground`).

  `VisionRunner` methods accept a `VisionGpuImage` (`{ texture, device, width, height }`) as well as RGBA pixels. When its sessions run on another device, or on the CPU, the runner reads the texture back itself. `WebGPUProvider` takes a `device` option and feeds `gpuBuffer` inputs with `Tensor.fromGpuBuffer`.

- 25edbba: A `mask` / `matte` / `crop` cutout with `classes` keeps the whole subject again. The class filter ran before the subject was assembled, so the parts COCO labels as other classes were thrown away before they could merge: a flowing dress comes back as a "kite", "umbrella" or "horse", and a `classes: ["person"]` cutout of a dancer kept only head, arms and torso (about 3% of the frame instead of 12%). The text behind the dancer then showed through the dress on most frames, on every platform. `classes` now only decides which instance is the subject; overlapping parts of any class merge into it, and the masks a vision bundle receives are still filtered by `classes`.

  `mergeSubjectMask(masks, options)` takes `{ classes, overlap, maxGrowth }` instead of positional `overlap` and `maxGrowth`, and `selectSubjectMask(masks, classes)` takes an optional class list.

- 931435f: Instance segmentation does far less work per frame. The RTMDet-Ins export ran NMS on the CPU in the middle of its graph and returned a full 640×640 mask for every detection: about 40 per frame, 65 MB of floats, computed on the GPU and copied back. The runner now cuts the graph at load time before its first data-dependent step and does the rest itself: top-k, per-class NMS with the export's thresholds, and each mask's three dynamic 1×1 layers at 80×80, only for the detections a layer keeps. `detect()` computes no masks at all.

  Results match the end2end graph: the same detections, scores and boxes, and masks with IoU above 0.98 on the reference frames (edges differ by one interpolation step). The model file and its SHA-256 check are unchanged; a model without the expected head tensors still runs end to end.

  The smoke project's `vision` export on an Apple Silicon Mac: 22.3 s → 15 s.

## 2.2.0-beta.4

### Patch Changes

- 9b70fda: Asset and font paths no longer depend on the `BASE_URL` and `R2_CUSTOM_DOMAIN` environment variables, left over from the Gatewai web app. With `BASE_URL` set, a font registered from an absolute path was fetched from `$BASE_URL/<path>`, and when that failed the engine quietly used a font from the `R2_CUSTOM_DOMAIN` CDN instead of the project's file. Absolute paths are now always read from disk, and Lottie sources and fonts are used as given instead of being prefixed with `http://localhost:8081`.

  Removed from `@framefields/client-utils`: `getEnv`, `BASE_URL`, `R2_CUSTOM_DOMAIN`, `configureAssetUrls` and the `options` argument of `GetAssetEndpoint`, `GetFontAssetUrl`, `resolveMediaSourceUrl` and `ResolveFileDataUrl`. Removed from `@framefields/compositions`: `getFontUrl`.

- 6adfd26: Requires mediabunny and @mediabunny/server 1.61.6 or newer. Encoded video now carries correct colour: older versions converted RGB to YUV with BT.601 and left the output untagged, so reds came out dull and blues shifted. 1.61.5, the first release with the colour fix, also slowed RGB encoding about 5×; 1.61.6 fixes that, and the new minimum keeps installs off 1.61.5.
- edfe483: `resetRenderCaches()` also forgets registered font files and deletes fonts downloaded from URLs (`clearHeadlessFonts()`). Before, the first file registered for a family stayed in use for the life of the process. In a long-lived worker, the next project's "Inter" then loaded the previous project's file, and failed once that checkout was evicted. Downloaded fonts now go to a fresh temp folder per session instead of a shared `gatewai-fonts`.

## 2.2.0-beta.3

### Patch Changes

- 25edbba: A `mask` / `matte` / `crop` cutout with `classes` keeps the whole subject again. The class filter ran before the subject was assembled, so the parts COCO labels as other classes were thrown away before they could merge: a flowing dress comes back as a "kite", "umbrella" or "horse", and a `classes: ["person"]` cutout of a dancer kept only head, arms and torso (about 3% of the frame instead of 12%). The text behind the dancer then showed through the dress on most frames, on every platform. `classes` now only decides which instance is the subject; overlapping parts of any class merge into it, and the masks a vision bundle receives are still filtered by `classes`.

  `mergeSubjectMask(masks, options)` takes `{ classes, overlap, maxGrowth }` instead of positional `overlap` and `maxGrowth`, and `selectSubjectMask(masks, classes)` takes an optional class list.

## 2.2.0-beta.2

### Patch Changes

- 5c55a7b: Vision layers no longer copy frames to the CPU. ONNX Runtime's WebGPU sessions now run on the renderer's own device (`setVisionDevice`), and a compute shader turns the layer's texture straight into each model's input tensor. It does the same resize, letterbox, channel order and normalisation as `imageToTensor`, within float32 rounding. A small GPU checksum replaces hashing the pixels on the CPU, so layers showing the same frame still share a pass. Frames come back to the CPU only for the opt-in background key (`keyBackground`).

  `VisionRunner` methods accept a `VisionGpuImage` (`{ texture, device, width, height }`) as well as RGBA pixels. When its sessions run on another device, or on the CPU, the runner reads the texture back itself. `WebGPUProvider` takes a `device` option and feeds `gpuBuffer` inputs with `Tensor.fromGpuBuffer`.

- 931435f: Instance segmentation does far less work per frame. The RTMDet-Ins export ran NMS on the CPU in the middle of its graph and returned a full 640×640 mask for every detection: about 40 per frame, 65 MB of floats, computed on the GPU and copied back. The runner now cuts the graph at load time before its first data-dependent step and does the rest itself: top-k, per-class NMS with the export's thresholds, and each mask's three dynamic 1×1 layers at 80×80, only for the detections a layer keeps. `detect()` computes no masks at all.

  Results match the end2end graph: the same detections, scores and boxes, and masks with IoU above 0.98 on the reference frames (edges differ by one interpolation step). The model file and its SHA-256 check are unchanged; a model without the expected head tensors still runs end to end.

  The smoke project's `vision` export on an Apple Silicon Mac: 22.3 s → 15 s.

## 2.2.0-beta.1

### Minor Changes

- 60c35a0: Faster on-device vision, on the GPU by default:

  - Vision layers no longer reload their models every frame. Layers whose options differed (e.g. one with `classes: ["person"]` and one without) used to close and recreate their ONNX sessions on each frame; they now share sessions through `VisionRunner.derive()`. This also fixes the `thread constructor failed: Resource temporarily unavailable` crash with `onnxruntime-web` installed.
  - Layers that hand vision the same pixels (two panels of one video) share one RTMDet-Ins pass.
  - `onnxruntime-web` is now an optional dependency of `framefields`, so inference runs on WebGPU when there is a hardware adapter. Dawn's `GPUSupportedFeatures` gains the `forEach` that onnxruntime-web's WebGPU build needs. Software adapters (lavapipe, SwiftShader) use the CPU instead.
  - CPU sessions on Linux size their thread pool from the CPUs the process may use, cgroup quota included, instead of the host's cores. `FRAMEFIELDS_VISION_THREADS` overrides it.
  - `FRAMEFIELDS_VISION_PROVIDER` (`auto`, `webgpu`, `cpu`, `cuda`) forces a backend; `cuda` uses onnxruntime-node's CUDA EP on Linux x64.

  The smoke project's `vision` export (three vision layers, 60 frames of 1280×720) on an Apple Silicon Mac: 84.9 s before; 41–43 s on the CPU and 26–29 s on the GPU after. In the renderer worker on a RunPod RTX 3070: 58.7 s before, 22–25 s after.

## 2.2.0-beta.0

### Minor Changes

- cf65727: Headless rendering for long-lived workers and any Linux machine:

  - Video encoding uses a hardware encoder (NVENC, VideoToolbox) only after testing that it works, and software encoders (libx264, libx265, libvpx, SVT-AV1) otherwise. This fixes H.264/HEVC renders on linux-arm64, where `h264_rkmpp` was picked without Rockchip hardware, and on NVIDIA GPUs without NVENC (A100, H100). Set `FRAMEFIELDS_HW_CODECS=off` to always encode in software.
  - WebGPU falls back to a software adapter (e.g. lavapipe) when no GPU adapter is available. The new `describeGpu()` reports the adapter in use and whether it is a CPU one.
  - `renderVideo` accepts `signal` (AbortSignal) and `onProgress`; `resetRenderCaches()` clears per-render caches between jobs in one process.

## 2.1.3

### Patch Changes

- Measure variable fonts with optical size (`opsz`) clamped to `fontSize` across `FontManager.measure`, `measureText`, captions, and rich text so layout matches rendered glyph geometry.
- 71d48b4: Fail fast when referenced local media files cannot be opened or decoded during headless rendering, instead of silently resolving with black frames or silent audio.

## 2.1.2

### Patch Changes

- Update homepage and documentation URLs to https://framefields.dev.

## 2.1.1

### Patch Changes

- rm aws bundle

## 2.1.0

### Minor Changes

- 24a4176: Text layers now render Arabic, Hebrew, Persian and other complex scripts. Each run is shaped with the font's OpenType tables (joining forms, lam-alef and other ligatures, kerning, mark placement), paragraphs go through the Unicode Bidirectional Algorithm, and lines wrap and read right to left with embedded Latin words and numbers kept left to right. Glyphs outside the default Latin set are generated on first use instead of rendering as boxes.

  New `direction: "auto" | "ltr" | "rtl"` option on text and caption layers (default `"auto"`, taken from the first strong character); `align: "start" | "end"` now follow it instead of always meaning left and right. `FontManager.measure` accepts `direction` and reports right-to-left glyphs and carets. The Slug binary format moves to v2 (`SLUGGIS2`, with glyph ids); v1 files still load.

## 2.0.11

### Patch Changes

- Physical 3D look, gradients, mattes, transitions and lint for agents:

  - `Layer.environment(preset)` / `Lighting.studio|soft|sunset|dramatic()`: GGX PBR with a procedural studio environment, emissive, exposure and tone mapping (PBR Neutral, AgX, ACES), soft shadow maps (`castShadow`), HDR bloom and fog. glTF normal, metallic-roughness, occlusion and emissive maps are now used.
  - `Color` helpers (`oklch`, `mix`, `ramp`, `lighten`, `contrast`, `readableOn`, …); `hsl()`, `oklch()` and space-separated `rgb()` accepted everywhere; color keyframes blend in OKLab.
  - CSS `linear-` / `radial-` / `conic-gradient()` with up to 8 stops on any background or shape fill.
  - Track mattes (`withMatte(layer, "alpha" | "alpha-inverted" | "luma" | "luma-inverted")`), on 2D and 3D layers; 3D layers keep their depth.
  - `Layer.sequence([...])` with `Transition.crossfade|push|slide|zoom|whip|wipe|iris|fadeThrough`.
  - `.animate()` merges with existing tracks; `FontManager.measure()` text metrics.
  - `comp.lint()` (also in `renderVideo({ qa })`): unreadable colors/gradients, low-contrast text, off-canvas layers, shadow and environment misuse, static tracks.
  - Fixes: `Layer.shape({ fill })` was ignored; `Layer3D.plane` dropped material options; stale 3D camera buffer reuse between frames.

## 2.0.10

### Patch Changes

- Internal cleanup and maintenance.

## 2.0.9

### Patch Changes

- Sample effect signals at composition frame across effect nodes, add Rotate effect node and SDK bindings, fix audio layer timing and LUT local file loading, and add WebGPU media size utilities.

## 2.0.8

### Patch Changes

- Fix text padding asymmetry and background badge rendering by eliminating artificial width offsets and fixing word-wrap token width calculation.

## 2.0.7

### Patch Changes

- Remove node-svg and node-lottie.

## 2.0.6

### Patch Changes

- 7ddb9d9: Register all remaining effect and audio DSP nodes with the effects generator and catalog, bundle them in the `framefields` SDK, and expose their strongly-typed classes, factories, and props for agents and composers.

## 2.0.5

### Patch Changes

- Fix homepage URL and bump packages.

## 2.0.4

### Patch Changes

- cf04e38: Preview: drawing no longer stops for good after a frame is shown from the frame cache (stepping or scrubbing back to a frame drawn before).
- 7ce675d: Preview: the page shows the frame rate playback reaches next to the timecode, and `window.framefieldsPreview.state()` reports it as `playbackFps`, with `renderMs` for the last frame drawn.
- d70a58b: Preview: Play runs in real time. It draws the frame due on the soundtrack's clock and skips the ones it missed, so playback starts at once and the sound never waits, however slow the device; it no longer renders 3 s ahead first and stalls whenever rendering falls behind.

## 2.0.3

### Patch Changes

- 4bf477c: Preview: the page's errors and the server's lifecycle are printed where the preview runs, `session.closed` resolves with why it stopped, the playhead survives reloads and `#t=` links, and `window.framefieldsPreview` lets scripts seek, play and read state. The audio mixer no longer prints its progress at info level.

  Preview notes: pause and click the picture (or drag an area) to pin a note to that spot and moment. Notes are saved in `.framefields/preview-notes/` (`notes.json` plus the frame with the spot marked), printed in the preview's output, listed in a Notes panel and on the timeline, and can be ticked off or copied for a chat. `notesDir` moves them, `false` turns them off.

  Preview playback: pausing keeps the frames rendered ahead (and keeps filling them), so playing on starts at once; moving the playhead clears them. Fixes a seek that could wait forever when it landed while a buffered frame was drawing.

- ea9edc3: Preview: drawn frames are cached, so stepping or scrubbing back to a frame you have already seen is a blit instead of a re-render. The cache is full-resolution and bounded by a byte budget, and is disabled for compositions that use vision (whose frames depend on the one before them).
- 52c2e8b: The live preview now works from the published package. The browser engine (framefields, the player and the Node shims) is prebuilt into `dist/preview-engine` (about 3 MB) and served to the page as separate modules. At preview time only the project's own files are bundled, against that engine. onnxruntime-web, needed only for vision effects, comes from the project's install when present and otherwise from a pinned CDN build, so its WebAssembly isn't shipped. Fonts referenced by family only (`assets/fonts/<Family>.ttf`) are served from the project folder, as the export engine reads them.
- 51b0daf: Rendering performance for the headless / server-GPU path:

  - VRAM telemetry no longer blocks the event loop. The renderer's 5-second stats probe ran `nvidia-smi` with `execSync`; it is now sampled asynchronously and cached, so it can no longer stall the frame loop and DMA callbacks on NVIDIA hosts.
  - `renderVideo` accepts `ringCapacity` (also `FRAMEFIELDS_RING_CAPACITY`, clamped 2–8) to tune the DMA staging ring depth. The default stays at 2.
  - `renderImage` reuses render surfaces across stills instead of allocating and destroying the native render target and readback staging buffer on every call.
  - Headless video decode reuses a single RGBA staging buffer per decoder instead of allocating a full-frame buffer for every decoded frame.

## 2.0.2

### Patch Changes

- d7bda9e: The preview now serves assets from the project that holds the entry (its nearest `.git`, else `package.json`), not just the entry's own directory. A project with no `.git`, where fonts and media live in a sibling `assets/` folder, previously failed to load them. `root` also accepts several paths now, for assets kept outside the project.

## 2.0.1

### Patch Changes

- Fix the browser preview failing to load from an installed package. The engine bundles the Node-only preview server, whose top-level `createRequire(import.meta.url)` ran against the stubbed `node:module`, so loading `framefields` in the preview threw `(0, Dr.createRequire) is not a function` before the player could start. `node:module` now has a shim, and a test imports every engine entry so a missing shim is caught.

  The npm page now shows the repository README: the package's README is generated from the root one at build and pack time, with its relative asset and repository links rewritten to absolute GitHub URLs so images and links resolve on npmjs.com.

## 2.0.0

### Minor Changes

- 5c257c2: `Layer.chart` is rebuilt on d3 and no longer depends on `chartgpu`, which removes about 130 MB from every install. Charts are now ordinary nodes: bars are boxes, lines, areas and slices are path shapes, and labels are text in the composition's own fonts. They support line, area, bar (grouped or stacked), scatter, candlestick, pie and donut, with a built-in reveal (`animate: { start, duration, stagger, ease }`).

  Breaking for chart users: `Layer.chart` takes the new `ChartOptions` (`type`, `series`/`data`, `categories`, `xAxis`/`yAxis`, `legend`, `valueLabels`, …) instead of ChartGPU options, and returns a box. The `"chart"` node kind, the `ChartGPUOptions`/`Chart*Schema` exports, the `progress`/`drawProgress`/`chartProgress` animatable props and `LayerAnimation.drawProgress()`/`chartProgress()` are removed.

- 5c257c2: Add a live preview before rendering. `startPreview({ entry, export })` (also from `framefields/preview`) serves a localhost player for a composition, with the mixed soundtrack and a timeline with the audio waveform. The page loads the module that builds the composition, bundled by esbuild against the browser engine that ships with the package (`dist/preview-engine`), and renders every frame with WebGPU in the browser, so nothing is streamed from the server. The server serves that bundle, the project's files (by absolute path, with byte ranges for video), and the soundtrack mixed by the export engine. Extruded 3D text (`Layer3D.extrudedText`) renders in the browser too. Glyph outlines used to go through skia's path `simplify`, which is Node-only; without skia they are read from fontkit, and overlapping contours (common in variable fonts) are sorted into outlines and holes by winding. Node output is unchanged. Build-time Node code in the composition (`node:path`, `import.meta.url`, synchronous `fs` reads) runs in the browser through shims. Playback never drops frames. Frames are rendered ahead, in order, into a buffer on the GPU and shown at the film's frame rate, on the soundtrack's clock. Playback starts once 3 seconds (or the rest of the film) are ready, and holds with a spinner to refill whenever rendering falls behind. The timeline shows the buffered range. `startPreview` returns a session (`url`, `close()`, `closed`) and serves the page instead of opening a browser, so an agent can show the URL in its own pane; `open: true` opens the system browser. The server shuts itself down a few seconds after the last tab closes (`idleCloseMs`). A reload doesn't trigger this. Each project gets a fixed port, so running the preview again replaces the running one and an open tab reloads into the new version by itself. No Electron. `esbuild` is a new dependency.

  Rendering consecutive frames is about 3× faster. The compositor no longer re-hashes every keyframe on each frame. `renderFrame` also accepts a stable `renderId`, which lets compiled timelines be reused between frames as `renderVideo` already does, and `format: "rgba"`, which returns raw pixels and skips PNG encoding. The new `renderAudio()` returns the composition's mixed soundtrack as PCM. The compositor also reuses the previous frame's layout when no layout input changed (the tree, the viewport, media sizes, and animated `width`, `height`, `gap`, `padding`, `fontSize` and `letterSpacing`). Before, it re-ran Yoga over the whole film's tree on every frame.

- 5c257c2: Vision effects are faster, in export and in the preview. The matte modes (`matte`, `mask`, `crop`) composite on the GPU: only the 8-bit mask is uploaded, instead of building the cut-out at full resolution on the CPU. That CPU path also kept a new full-frame texture for every frame rendered; the new path keeps two per node. Vision results are cached per source frame, keyed by node, source and inference settings, with run-length-encoded masks, so replays, scrubbing back and later renders in the same process skip inference. A frame found in the cache is cut out from its own pixels, without the usual one-frame delay. The preview analyses frames ahead of the playhead while paused, so tracked shots play at full frame rate. Background keying (`keyBackground`) runs about 10× faster with the same output: flood fills use typed-array queues and a foreground map computed once, and the edge blur reads memory in order. The preview page is served cross-origin isolated, so onnxruntime-web runs its CPU operations on several threads.

  Vision effects also run in the browser preview, on onnxruntime-web with WebGPU. `@framefields/vision` adds `setDefaultSessionProvider()`, which the player uses to switch to that runtime. Cached models are read asynchronously. The texture cache now holds evicted textures until the frame being recorded has been submitted, which fixes "Destroyed texture used in a submit" when a frame's recording spans a mid-frame GPU readback. Its pruning also evicts the least recently used textures first, as documented.

### Patch Changes

- 985e6be: `LayerAnimation.signal()` and `.colorSignal()` now accept a signal object (`Signal.fromArray`, `Signal.builder`, …) as well as a name registered with `comp.addSignal`. Before, passing the object produced a meaningless handle id and the track silently did nothing (or picked up an unrelated signal). The object is carried on its track and registered with the program under a generated `inline_signal_N` id, so specs stay plain JSON. Values that are neither a signal nor a name now throw.
- 5c257c2: Require `sharp` ^0.35.0, so fresh installs no longer pull the libvips/libheif versions flagged by `npm audit`. Fix the README samples that did not compile against the published types (quickstart animation, 3D camera orbit and carousel, `ColorBalance`). The setup skill's `tsconfig.json` now sets `"types": ["node"]` so `typecheck` passes on TypeScript 6+, and its `package.json` also denies the `esbuild` install script that `tsx` brings in, so installs finish without warnings.

## 1.4.3

### Patch Changes

- Quieter renders: headless GPU, font, and node-discovery messages now log only with `LOG_LEVEL=debug`, and a local font no longer logs as if it were downloaded. The setup skill now writes `package.json` with the `skia-canvas` install-script approval (npm `allowScripts`, pnpm `onlyBuiltDependencies`, bun `trustedDependencies`) before installing, so installs work on package managers that block dependency scripts.

## 1.4.2

### Patch Changes

- Render logs now report the released version: the monorepo root version is synced on every release, so the logger no longer shows a stale `1.3.0`.

## 1.4.1

### Patch Changes

- Fix issues from the 1.4.0 friction report:

  - Published types no longer import unpublished `@framefields/*` packages, so signal APIs, `frameSignal`/`timeSignal`/`progressSignal` and layer option types are fully typed instead of `any`. A build check now guards against regressions.
  - `Layer.cube`, `carousel3d`, `prism3d` and `extrudedText` no longer leak `faces`/`items` into the spec, so `CompositorProgramSchema` accepts them.
  - `scale` (and `scaleX`/`scaleY`/`scaleZ`) now applies to preserve-3d containers such as `Layer.cube`.
  - `renderVideo({ outputPath })` returns `outputPath` as `filePath` and removes the temp file.

## 1.4.0

### Minor Changes

- Bundle every built-in node renderer (Compositor, effects, audio) into the published package. Renderers are now registered from a generated static list instead of a scan for a `nodes/` directory, so installed projects no longer render blank frames. Set `FRAMEFIELDS_NODES_DIR` to load extra nodes from disk during local node development.

  Remove React: the `framefields/react` entry point (`CanvasComposition`, `FramefieldsPlayer`, `RenderProvider`, `useRenderContext`, `useCompositionState`) and the `react` peer dependency are gone. `import "framefields"` no longer requires `react` to be installed.

  Relicense all `@framefields/*` packages and nodes to Apache-2.0.

## 1.3.2

### Patch Changes

- Agent plugin: add the `framefields` entry-point skill for setting up a new project, and fix the frame-grid example in `framefields-render` (`showLabels`).

## 1.3.1

### Patch Changes

- init
