---
name: framefields-effects
description: Apply, configure, and modulate WebGPU post-processing shaders, stylized looks (pixel art, ASCII, VHS, comic, watercolor, risograph, holographic — and which look fits which request), cinematic color grading, tone mapping, procedural VFX, and on-device vision (object tracking, instance segmentation, pose, person mattes) in framefields. Use when adding blur, grain, LUTs, relighting, curves, greenscreen color keying, subject cutouts, or tracking-driven effects in framefields compositions.
---

# framefields-effects

## Setup
Import everything from the [`framefields`](https://www.npmjs.com/package/framefields) npm package. If the project doesn't have framefields set up yet, follow the `framefields` skill first (install, project scaffold, first render).

## Overview
`framefields` features a native WebGPU shader execution pipeline for 2D VFX, tonal grading, cinematic lens simulation, spatial relighting, and real-time neural vision conditioning.

Effects in framefields are strongly typed `Effect` subclasses whose uniform properties can be driven by static values, time-varying keyframes, reactive `Signal` instances, or audio extraction pipelines.

See [references/effects-catalog.md](references/effects-catalog.md) for the generated prop-level catalog, defaults, and type bounds.

---

## Attaching Effects

There are 4 main attachment modes in the engine:

### 1. Layer-Level Effect Pipeline
Attach one or more effects to a media layer (video, image, SVG, Lottie). Box and text layers take only `TemporalDeflicker` and `Relight3D` directly; to treat a group or text as an image, render it into a media layer first.


```typescript
import { Layer, Curves, Vignette, Blur } from "framefields";

const videoLayer = Layer.video("assets/footage.mp4", { fit: "cover" })
  .withEffect(new Curves({
    master: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.52 }, { x: 1, y: 0.95 }]
  }))
  .withEffect(new Vignette({ strength: 0.4, radius: 0.85, softness: 0.6 }))
  .withEffect(new Blur({ strength: 8, blurType: "Gaussian" }));
```

### 2. Whole-Composition Master Emulsion
Apply an overarching post-processing grade or film emulsion across all rendered layers:
```typescript
import { Composition, FilmGrain, ColorBalance } from "framefields";

const comp = new Composition({ width: 1920, height: 1080, fps: 30 });

// Shared organic 35mm grain applied across titles, background video, and vector graphics
comp.apply(new FilmGrain({
  strength: 0.06,
  size: 1.5,
  monochrome: true,
  animated: true,
  speed: 1.0,
}));

comp.apply(new ColorBalance({
  shadows: { cyanRed: 4, yellowBlue: -6 },
  highlights: { cyanRed: 2, yellowBlue: -4 },
  preserveLuminosity: true,
}));
```

### 3. Spatial & Tracked Sections (`comp.section` / `Layer.section`)
Isolate a sub-region of a plate or canvas to apply localized effects:
```typescript
// Box blur on a tracked object or explicit bounding rectangle
const blurredPlate = comp.section({
  source: "assets/interview.mp4",
  x: 400,
  y: 200,
  width: 300,
  height: 300,
  borderRadius: 150,
  effects: [new Blur({ strength: 25, blurType: "Gaussian" })],
});
```

### 4. Fluid Fluent Media Chains (`Media`)
Process clips outside a layout tree before mounting or exporting:
```typescript
import { Media, ApplyLUT, Crop } from "framefields";

const clip = Media.video("assets/raw_log.mp4")
  .apply(new ApplyLUT({ lutUrl: "assets/luts/cinematic.cube", intensity: 1.0 }))
  .apply(new Crop({ cropType: "rectangle", topPercentage: 10, heightPercentage: 80 }));

const pngBuffer = await clip.renderFrame({ atMs: 1500 });
```

---

## Effect Categories

### 1. Color Grading & Tonal Dynamics
- **`Curves`**: Spline-interpolated tone curves for master, red, green, blue, plus hue/saturation curves (`hueVsHue`, `hueVsSat`, `lumVsSat`, `satVsSat`).
- **`ColorBalance`**: Shadows, midtones, and highlights split color adjustments with `preserveLuminosity`.
- **`Levels`**: Master and per-channel input/output black/white points and gamma.
- **`SelectiveColor`**: CMYK-style photographic selective adjustments targeting reds, yellows, greens, cyans, blues, magentas, whites, neutrals, and blacks.
- **`GradientMap`**: Multi-stop gradient remapping (`stops: [{ position: 0, color: "#000" }, { position: 1, color: "#FFF" }]`).
- **`ShadowsHighlights`**: Separate shadow lifting and highlight recovery with radius and tonal width controls.
- **`ApplyLUT`**: 1D and 3D `.cube` color lookup table applicator.
- **`Modulate`**: Real-time HSL/contrast controls: `hue`, `brightness`, `contrast`, `exposure`, `saturation`, `sepia`.

### 2. Optical, Texture & Cinematic Emulsions
- **`FilmGrain`**: GPU-synthesized film grain with grain sizing, shadow/highlight masking, and temporal animation speed.
- **`Vignette`**: Elliptical or circular lens falloff with customizable center, roundness, and softness.
- **`Blur`**: High-performance multi-mode blur: `"Gaussian"`, `"Box"`, `"Median"`, `"Motion"`, `"Bilateral"`, `"Edge-preserving"`, `"Radial"`, `"Zoom"`. Supports partial blur regions and tracked object bounding boxes.
- **`UnsharpMask`**: High-frequency edge sharpener with threshold suppression.
- **`HighPass`**: Edge and frequency isolation with contrast boost.
- **`HalftoneScreen`**: Procedural print screening with `"Circle"`, `"Diamond"`, `"Line"`, or `"Square"` dots in `"Monochrome"` or `"CMYK"` angles.
- **`TileOffset`**: Seamless UV wrapping with `"wrap"`, `"clamp"`, `"mirror"`, or `"transparent"` boundaries.
- **`MotionBlur`**: Directional shutter simulation with custom shutter angles and velocity clamps.
- **`TemporalDeflicker`**: Multi-frame optical flow blending to eliminate flickering in generative AI clips or high-speed footage.

### Temporal (effects with memory)
- **`Trails`**: the layer over a decaying copy of its own past. `mode: "blend"` (default; echoes on full-frame footage), `"over"` (cutouts and text), `"add"` (light painting on dark scenes), `"max"` (light trails). `decay` 0.8 short echo → 0.97 long trails; per-frame `zoom` (1.02 = tunnel), `rotation`, `offsetX/Y`, `hueShift` (psychedelic cycling).
- **`Datamosh`**: the previous picture dragged along the new frame's optical flow instead of being refreshed, until a `keyframes` frame (I-frame) shows the clean picture. Put keyframes where you want it clean; leave a cut out to smear one shot with the next one's motion. `strength`, `bleed` (clean picture mixed back per frame).
- Both step as frames render; after a jump (scrubbing, a single `renderFrame`) they replay the last frames (`warmup`) to rebuild the history.

### 3. 3D Spatial Lighting & Materials
- **`Relight3D`**: Screen-space normal map relighting with point, spot, and directional lights, specular highlights, roughness, and metallic uniforms.
- **`SSAO`**: Screen-space ambient occlusion generating contact shadows from depth buffers.
- **`PBRGlass`**: Physically-based transmission, index of refraction (IOR), optical dispersion, and Fresnel reflections.
- **`DepthOfField`**: Camera lens simulation with aperture size, focal length, focus plane distance, and circle-of-confusion (CoC) blur.

### 4. Matte, Keying & Edge Operations
- **`ColorKey`**: Studio greenscreen/bluescreen keyer with spill suppression and smoothness controls.
- **`Crop`**: Rectangular, circular, or arbitrary polygon path cropping with corner rounding.

### 5. Stylize Looks (`Styles.*`)

**Which look for which request:** see [references/style-guide.md](references/style-guide.md). It maps phrases like "VHS", "8-bit", "comic" or "liquid logo" to presets, effects and techniques. Read it whenever someone names a style.

`Styles.<name>(options?)` returns an effect stack: `layer.withEffects(Styles.vhs())`. Presets: `pixelArt`, `gameBoy`, `teletext`, `ledWall`, `ascii`, `oneBit`, `risograph`, `comic`, `cartoon`, `thermal`, `vhs`, `crt`, `glitch`, `oilPainting`, `watercolor`, `topographic`, `kaleidoscope`, `opArt`, `holographic`, `noir`, `film`.

The effects behind them, for finer control:
- **`Pixelate`**: big pixels; `shape: "square" | "circle" | "diamond"` (LED wall), `gap`.
- **`Posterize`**: fewer colors, or snap to a `palette` (`gameboy`, `teletext`, `cga`, `pico8`, `c64`, `grayscale`, `sepia`, `custom` + `colors`) with Bayer `dither` and `pixelSize`.
- **`Dither`**: `bayer` / `noise` / `halftone`; 1-bit duotone (`dark` / `light`) or per-channel `levels`.
- **`Ascii`**: glyphs by brightness; `colorMode: "mono" | "source" | "green"`, `cellSize`, `fg` / `bg`, `invert`.
- **`Toon`**: brightness bands plus Sobel ink lines (`edgeColor`, `edgeWidth`, `edgeThreshold`).
- **`RGBSplit`**: chromatic aberration along `angle` or `radial`.
- **`CRT`**: curvature, scanlines, aperture mask, noise, flicker, vignette; `tracking` and `chroma` give VHS wobble and colour bleed.
- **`Painterly`**: Kuwahara `oil` / `watercolor` (pigment edges, paper grain).
- **`Contour`**: topographic isolines over the `source`, a `flat` paper colour, or nothing.
- **`Kaleidoscope`**: mirror `segments` around a center; animate `rotation` / `zoom`.
- **`OpArt`**: stripes / rings / checker / waves bent and thickened by the image.
- **`Iridescence`**: thin-film rainbow from brightness or relief; animate `shift`.
- **`Gooey`**: blur + alpha threshold (metaballs). Use it on layers with transparency (SVG, particles), not on opaque footage.

---

## On-Device Vision

`framefields` runs vision models on the rendered frame and exposes the results as reactive signals. Models download lazily on first use and are cached in `$FRAMEFIELDS_MODELS_DIR` (default `~/.cache/framefields/models`).

| Option | Model | Gives you |
| --- | --- | --- |
| `enableDetection` (default) | RTMDet-Ins | COCO-80 boxes, tracked over time → `vision.objects` |
| `enableSegmentation` | RTMDet-Ins (same pass) | Soft per-instance masks → `vision.masks`, `vision.segmentation` |
| `enablePose` | RTMO | 17 COCO keypoints per person → `vision.poseLandmarks`, `track.pose` |
| `enableMatte` | Selfie Segmenter | Fast person alpha → `vision.segmentation.matte` |

`variant: "t" | "s" | "m"` trades speed for accuracy (default `"s"`). `confidence` (default 0.3) and `classes: ["person", ...]` filter detections.

```typescript
// Whole composition: returns the reactive bundle
const vision = comp.withVision({ enableSegmentation: true, enablePose: true });

// One layer: renders through a node mode
Layer.video("assets/dancer.mp4").withVision({ mode: "matte", enableSegmentation: true });
```

Node modes: `passthrough`, `mask`, `matte`, `crop`, `skeleton`, `boxes`, `tracking`. For `mask` / `matte` / `crop`, `matteSource: "instance"` (default; any COCO class, overlapping parts such as a dress merged into the subject) or `"selfie"` (people only, fastest).

### Choosing settings

Measured per 1280–2048 px frame on CPU (`onnxruntime-node`):

| Task | `t` | `s` (default) | `m` |
| --- | --- | --- | --- |
| detect / segment (one shared pass) | 150–300 ms | 200–340 ms | 420–700 ms |
| pose | ~50 ms | ~120 ms | ~280 ms |
| matte (Selfie Segmenter) | ~20 ms | ~20 ms | ~20 ms |

- Start with `"s"`. Use `"m"` for hero shots with fast motion blur or busy backgrounds; `"t"` mainly saves time on pose.
- Enabling both `enableDetection` and `enableSegmentation` costs one inference, not two.
- **Selfie matte only for close framing.** It is tuned for a person filling much of the frame: it misses distant figures and can report a "person" on close-ups with nobody in them. Keep `matteSource: "instance"` for anything else.
- Raise `confidence` (e.g. `0.5`) on abstract or stylized footage — at the default `0.3` the model will put loose labels ("teddy bear", "donut") on smoke, eyes and planets.
- Restrict `classes` when you only care about one thing; it also stops the subject from switching to another object when the person leaves frame.

### GPU or CPU

Inference runs on the GPU through `onnxruntime-web`'s WebGPU backend (an optional dependency of `framefields`, installed by default) on a hardware adapter, and on the CPU through `onnxruntime-node` otherwise: when `onnxruntime-web` is missing, the only adapter is a software one (lavapipe, SwiftShader), or WebGPU fails. On an Apple Silicon Mac the GPU roughly halves render time against the CPU. Layers that use the same `variant` share their models, and layers showing the same pixels share one detect/segment pass.

| Variable | Effect |
| --- | --- |
| `FRAMEFIELDS_VISION_PROVIDER` | `auto` (default), `webgpu`, `cpu`, or `cuda` (onnxruntime-node's CUDA EP on Linux x64; needs the CUDA 12 and cuDNN 9 libraries). A forced backend that fails throws instead of falling back. |
| `FRAMEFIELDS_VISION_THREADS` | CPU threads per model. Default on Linux: the CPUs the process may use, cgroup quota included; elsewhere ONNX Runtime's default. |

### How it behaves at render time

- **One-frame delay.** Vision reads the layer's *previous* rendered frame, so the very first frame has no results (a cutout renders transparent) and masks trail the plate by one frame. This is invisible at normal playback speed. A matte of a clip the composition also reads with `comp.vision` has neither (see Clip Vision below).
- **Render vision frames in order.** `renderVideo` does this for you. For stills, render at least two consecutive frames with the same renderer and keep the last one. Jumping straight to a later frame (or using a frame grid) cuts out pixels from whatever frame was rendered before it, which shows up as a ghosted double of the subject.
- **Subject choice.** `mask` / `matte` / `crop` use the largest person; with no person, the most confident instance. Instances overlapping the subject and no more than twice its size are merged in (a dress, a held instrument) — large containers around it (a tunnel, a window frame) are not. `classes` limits what the subject can be, not what merges into it: COCO has no clothing class, so a flowing dress often comes back as a "kite" or "umbrella" and still joins a `classes: ["person"]` cutout.
- Each vision layer tracks objects independently; track ids from two layers are unrelated.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| Part of a fast-moving garment drops out of the cutout | `variant: "m"`, or `keyBackground: true` to grow the subject into connected foreground |
| Cutout is the wrong object | Set `classes: ["person"]` (or the class you want) |
| Faint halo around the cutout on dark backgrounds | Lower `featherRadius`, or raise `maskThreshold` (e.g. `0.6`) |
| Renders offline / in CI | Pre-download with `runner.preload([...])` into `$FRAMEFIELDS_MODELS_DIR`, or point `FRAMEFIELDS_MODELS_BASE_URL` at a mirror |
| Check the models themselves | `await runner.preload([...])` on a fresh models directory; it downloads each model and verifies its SHA-256 (about 380 MB for all of them) |

### 1. Subject Sandwich ("Text Behind Subject")
Cuts out the foreground subject from footage and sandwiches typography or graphics directly behind them:

```typescript
comp.addSubjectSandwich({
  source: "assets/dancer.mp4",
  behind: [
    Layer.text("HEADLINE BEHIND", {
      fontSize: 120,
      fill: "#FF5A1F",
      fontWeight: 900
    })
  ],
  feather: 4,
  fit: "cover"
});
```

### 2. Smart Re-Framing (16:9 to 9:16 Auto-Crop)
Smoothly reframes landscape video into vertical shorts by following a tracked subject with virtual camera damping:
```typescript
const vision = comp.withVision({ enableDetection: true });
comp.addSmartFraming({
  source: "assets/action.mp4",
  target: vision.objects.primary,
  targetAspect: 9 / 16,
  damping: 0.15,
  leadHeadroom: 0.1
});
```

### 3. Subject Outline Glow & Neon Pulse
Strokes the segmented subject boundary with an audio-reactive contour glow:
```typescript
const vision = comp.withVision({ enableSegmentation: true });
comp.addSubjectOutline(vision.segmentation.subject, {
  source: "assets/character.mp4",
  color: "#FF5A1F",
  width: 6,
  blur: 12
});
```

### 4. Tracked Region Blur
Blurs faces, license plates, or any detected class by following a live track:
```typescript
const vision = comp.withVision({ classes: ["person"] });
layer.blurRegion(vision.objects.byCategory("person"), { strength: 30 });
```

### 5. Clip Vision: Results Before the Frame Renders
`withVision` analyses a layer's *previous* rendered frame, so its results trail by a frame and exist only while rendering. When something must know the motion *at* the frame — physics, layout, keyframes — use `comp.vision`, which analyses the clip's own frames on demand:
```typescript
const dancer = comp.vision("assets/dancer.mp4", { startFrame: 0 });   // pose + silhouette (person)
const person = dancer.person.place({ width: W, height: H, fit: "cover" });
person.point("rightWrist", 48);   // { x, y, visibility } in composition px, smoothed over ±2 frames
person.signals("nose").x;          // a signal for .signal("x", …)
person.sample(48, x, y);           // silhouette alpha + inward gradient (dress and held things included)
await dancer.ready(0);             // analyse a frame (or a range: ready(0, 120)) to read it at build time
```
- The composition analyses each frame's clips just before drawing it, in every render path and the preview, and a live physics world (`world.live(comp)`) before stepping. Nothing runs up front; a preview starts at once.
- Results persist in Node (`~/.cache/framefields/vision`, or `$FRAMEFIELDS_VISION_CACHE_DIR`; `cacheDir: false` to opt out), keyed by the file and settings, so later runs and renders after a preview are instant.
- Options: `startFrame` / `trimStartSec` (where the clip plays), `pose`, `mask`, `maskCell` (silhouette grid, default 8 px), `smoothing` (frames, default 2), `variant`. When the person is lost the last pose is held for up to a second.
- A `withVision({ mode: "matte" })` cutout (or `mask` / `crop`) of the same clip reuses these results: the composition hands it the clip's subject for the frame being drawn, so it is segmented once, not again at render, and the cutout lines up with the plate on the same frame. Layers with `classes`, `keyBackground`, `matteSource: "selfie"` or other model settings than the clip keep their own pass.
- Analysis costs about 200 ms per frame on CPU (segmentation dominates); on WebGPU it is faster. In a live preview the playhead waits for frames not analysed yet.

### 6. Analyze Before Authoring
One-shot, ffmpeg-free report of what is in a clip (tracks, classes, mask coverage):
```typescript
const report = await comp.analyzeVisionSequence("assets/street.mp4", {
  tasks: ["detect", "pose"],
  categories: ["person"]
});
report.tracks; // [{ trackId, category, frames: [start, end], centerPath, ... }]
```

---

## Reactive Signal Modulation

Uniforms on any `Effect` accept reactive `Signal` instances instead of static values. When the signal changes, the GPU uniform buffer updates automatically without rebuilding the pipeline:

```typescript
import { Layer, Blur, sineSignal, computed } from "framefields";

// Oscillating breath blur
const blurSignal = sineSignal({
  frequencyHz: 0.5,
  min: 0,
  max: 20
});

const layer = Layer.image("assets/bg.jpg")
  .withEffect(new Blur({
    strength: blurSignal,
    blurType: "Gaussian"
  }));
```

### Best Practices:
1. **Emulsion Restraint:** Keep `FilmGrain` (`0.04–0.08`) and `Vignette` (`0.2–0.45`) subtle. Over-filtering looks amateurish.
2. **Order Matters:** Place tonal grading (`Curves`, `ColorBalance`) before lens optics (`Blur`, `DepthOfField`), and apply grain (`FilmGrain`) as the outermost layer.
3. **No Redundant Shaders:** For static image exports, set `animated: false` on `FilmGrain` to preserve deterministic static renders.
