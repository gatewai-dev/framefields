---
name: gitframes-compose
description: Design, structure, and animate code-first video compositions using the gitframes WebGPU SDK. Use when creating scenes, layout trees, kinetic typography, camera trajectories, vector shapes, or audio-synchronized motion graphics in gitframes.
---

# gitframes-compose

## Overview
`gitframes` is a code-first, deterministic video composition SDK executing natively on WebGPU (Dawn) in Node.js. It replaces browser-based rendering (Puppeteer/Chromium) with high-performance GPU pipelines, Yoga flexbox layout, Slug vector typography, 3D camera transforms, and reactive audio/signal drivers.

Every composition is defined as a tree of layout nodes compiled into a deterministic execution program: `(composition, frame) → pixels`.

---

## Architecture & Core Concepts

### 1. Composition Lifecycle
A `Composition` instance defines canvas dimensions, frame rate, background, registered fonts, global audio tracks, and the layer hierarchy:

```typescript
import { Composition, Layer, FontManager } from "gitframes";

// Always register fonts before assembling layers
await FontManager.register({
  family: "Inter",
  source: "assets/fonts/Inter.ttf"
});

const comp = new Composition({
  width: 1920,
  height: 1080,
  fps: 30,
  durationMs: 10000, // or computeDuration()
  backgroundColor: "#0E0D0C",
  fonts: ["assets/fonts/Inter.ttf"],
});

comp.add(Layer.box({ /* ... */ }));
comp.add(Layer.audio("assets/score.mp3", { volume: 1 }));
```

### 2. Scene Architecture (Production Pattern)
For commercials, films, and multi-shot videos, break the project into discrete, modular scene functions using scene-local frames:

- **Tokens first (`theme.ts`):** Centralize color palette, typography, easing curves, and a tempo-locked beat grid (`BEAT = Math.round(fps * 60 / BPM)`). Never use arbitrary margins or ad-hoc hex codes.
- **Scene modules (`scenes/hero.ts`):** Each scene returns a full-frame root box with `startFrame` and `durationFrames`. Children position themselves relative to scene start (`frame: 0` = scene onset).
- **Master assembly (`film.ts`):** Imports scenes, mounts them to `comp.add(scene())`, attaches the master soundtrack and composition-level grading/grain.

```typescript
// theme.ts
export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const BEAT = 18; // 100 BPM at 30 fps
export const beats = (n: number) => Math.round(n * BEAT);

export const INK = "#0E0D0C";
export const PAPER = "#EEE9E0";
export const EMBER = "#FF5A1F";

export function scene(options: { id: string; from: number; to: number; children: unknown[] }) {
  return Layer.box({
    id: options.id,
    position: "absolute",
    x: 0,
    y: 0,
    width: W,
    height: H,
    startFrame: options.from,
    durationFrames: options.to - options.from,
    children: options.children as never,
  });
}
```

---

## Layer Primitives (`Layer.*`)

All `Layer.*` builders return `AnimatableNode<T>` instances with chainable `.animate()`, `.apply()`, and effect methods.

| Builder | Node `kind` | Description & Key Options |
|---|---|---|
| `Layer.text(content, options)` | `"text"` | Slug GPU vector text. Options: `fontSize`, `fontFamily`, `fill`, `letterSpacing`, `lineHeight`, `align`, `animators`, `spans`. |
| `Layer.box(options)` | `"box"` | Rectangular container / card. Options: `background`, `borderRadius`, `borderColor`, `borderWidth`, `overflow: "hidden"`, `padding`, `children`. |
| `Layer.flex(options)` | `"flex"` | Auto-layout container (Yoga). Options: `dir: "row" \| "column"`, `gap`, `justify`, `align`, `padding`, `wrap`, `children`. |
| `Layer.video(src, options)` | `"media"` | Video layer decoded via mediabunny. Options: `fit: "cover" \| "contain"`, `trimStartSec`, `muted`, `volume`. |
| `Layer.image(src, options)` | `"media"` | Static raster image (`.png`, `.jpg`, `.webp`). Options: `fit: "cover" \| "contain"`. |
| `Layer.svg(src, options)` | `"media"` | Vector SVG asset. Options: `fit: "contain"`. |
| `Layer.lottie(src, options)` | `"media"` | Lottie vector animation file. |
| `Layer.audio(src, options)` | `"media"` | Audio track layer. Options: `volume`, `startFrame`, `durationFrames`. |
| `Layer.shape(type, options)` | `"shape"` | Parametric vector graphics (`"rect"`, `"circle"`, `"ellipse"`, `"polygon"`, `"star"`, `"arrow"`, `"path"`). Options: `d` (SVG path data with arcs), `strokeWidth`, `strokeColor`, `trimStart`, `trimEnd`. |
| `Layer.caption(src, options)` | `"media"` | SRT-driven synchronized subtitle engine. Bottom-anchored auto-wrapping cues. |
| `Layer.chart(options)` | `"chart"` | Headless ChartGPU integration. Line, area, candlestick, 3D point cloud, with `drawProgress` animations. |
| `Layer.camera(options)` | `"camera"` | 3D scene camera with FOV, lens rack focus, and orbital coordinates. |
| `Layer.light(options)` | `"light"` | 3D lighting primitive (`ambient`, `directional`, `point`, `spot`). |
| `Layer.model(options)` | `"model3d"` | 3D mesh loader (`.gltf`, `.glb`, `.obj`, `.fbx`, `.stl`, `.ply`). Supports skinning and audio deformation compute shaders. |

---

## Animation System (`LayerAnimation`)

Create animations using `LayerAnimation.create()` or fluent factory methods. Animations are composed of keyframed tracks or procedural drivers.

### 1. Keyframe Transitions (`fromTo`)
```typescript
import { LayerAnimation } from "gitframes";

// Fluent chain
const anim = LayerAnimation.create()
  .fadeIn(0, 20, "power2.out")
  .fromTo("y", 60, 0, { start: 0, end: 24, ease: "expo.out" })
  .fromTo("scale", 0.95, 1.0, { start: 0, end: 30, ease: "power3.out" });

// Easing bases: none, power1, power2, power3, sine, circ, expo, back, elastic, bounce, spring, cubic, hold
// Directions: in, out, inOut (e.g. "expo.out", "back.out(1.7)", "power2.inOut")
```

For more than two keyframes on one prop, list them with `keys`: each tuple is `[frame, value, ease?]`, where the ease shapes the motion *into* that keyframe. Frames are rounded, so beat math (`at + BEAT / 2`) can go straight in:

```typescript
const pop = LayerAnimation.create()
  .keys("scale", [[0, 0], [10, 1.12, "back.out(1.6)"], [16, 1, "power2.out"]])
  .keys("opacity", [[0, 0], [6, 1]]);
// Static form: LayerAnimation.keys("rotation", [[0, -8], [20, 0, "expo.out"]])
```

Keyframes past the layer's `durationFrames` never play; the render warns (`animation_truncated`) and `renderVideo({ qa: true })` reports it.

### 2. Kinetic Typography (`TextAnimator`)
Text animators operate at the GPU glyph instancing level, cascading offsets across characters, words, or lines:

```typescript
import { Layer, LayerAnimation, TextAnimator } from "gitframes";

// Letter-by-letter wave rise with perspective tilt and blur
const headlineNode = Layer.text("PRECISION MOTION", {
  fontSize: 96,
  fontFamily: "Inter",
  fill: "#FFFFFF",
  animators: [
    TextAnimator.waveRise({
      y: 40,
      rotationX: 45,
      opacity: 0,
      blur: 10,
      easing: "expo.in"
    })
  ]
}).animate(
  // Sweep the selection offset across the text string
  LayerAnimation.create().kineticSweep(-1, 1, 0, 24, "power2.inOut")
);
```

Presets available: `TextAnimator.waveRise()`, `TextAnimator.wordPop()`, `TextAnimator.blurIn()`, `TextAnimator.flip3D()`, `TextAnimator.colorSweep()`.

### 3. 3D Spatial Transforms & Camera Motion
Layers can be transformed in 3D perspective space:
```typescript
const card = Layer.box({
  width: 600,
  height: 400,
  background: "#181715",
  borderRadius: 24,
  transformStyle: "preserve-3d",
  perspective: 1200,
}).animate(
  LayerAnimation.create()
    .fromTo("rotateX", 25, 0, { start: 0, end: 30, ease: "expo.out" })
    .fromTo("rotateY", -35, 0, { start: 0, end: 30, ease: "expo.out" })
    .fromTo("translateZ", -200, 0, { start: 0, end: 30, ease: "expo.out" })
);
```

For full 3D camera staging, use `CameraAnimation`:
```typescript
import { CameraAnimation } from "gitframes";

const camAnim = CameraAnimation.camera()
  .orbit({
    azimuth: { from: -45, to: 15 },
    elevation: { from: 10, to: 25 },
    radius: { from: 2000, to: 1400 },
    start: 0,
    end: 90,
    ease: "sine.inOut"
  })
  .rackFocus({
    fromDistance: 2000,
    toDistance: 1400,
    fromFStop: 1.8,
    toFStop: 4.0,
    start: 20,
    end: 60
  });
```

### 4. Procedural & Audio-Reactive Drivers
Properties can be bound to Perlin wiggles, harmonic springs, or audio-extracted signals:
```typescript
// Organic floating drift
const floatAnim = LayerAnimation.create()
  .wiggle("x", { frequency: 1.5, amplitude: 25 })
  .wiggle("y", { frequency: 1.2, amplitude: 20 });

// Physics spring overshoot
const springAnim = LayerAnimation.create()
  .spring("scale", { damping: 14, stiffness: 190, mass: 1 });

// Audio reactivity via Signal
const beatAnim = LayerAnimation.create()
  .signal("scale", "drum_stem_signal", { multiplier: 0.12, offset: 1.0, smoothing: 2 });
```

---

## Critical Authoring Rules & Gotchas

1. **Local Keyframe Coordinates:** Keyframes are strictly relative to the node's own timeline window (`0` = node appearance). Never offset keyframe frames by the parent's `startFrame`.
2. **Coordinate Overrides:** Animating `y` overrides the node's layout `y`. If a node is placed at `y: 400`, animate `fromTo("y", 440, 400)`, NOT `fromTo("y", 40, 0)`.
3. **No String Styles for Borders:** Use `borderColor` and `borderWidth`. CSS `border: "1px solid red"` is silently ignored.
4. **Font Registration is Mandatory:** In headless WebGPU, system fonts do not exist. Every font must be registered via `FontManager.register()` and listed in `comp.fonts`.
5. **Integer Frames Only:** Keyframe frames, start frames, and durations must be integers. Decimal frames cause schema validation errors.
6. **Relative vs. Absolute:** Providing `x` or `y` without `position: "relative"` turns the node into an absolute-positioned layer removed from flex flow.
7. **Audio Layer Duration:** Every `Layer.audio()` must be assigned `durationFrames` to prevent audio truncation in headless rendering.
8. **Premultiplied Alpha:** Alpha shaders operate with premultiplied alpha. Never use `"src-alpha"` factor in custom blends.
