---
name: framefields-compose
description: Design, structure, and animate code-first video compositions using the framefields WebGPU SDK. Use when creating scenes, layout trees, kinetic typography, camera trajectories, vector shapes, or audio-synchronized motion graphics in framefields.
---

# framefields-compose

## Setup
Import everything from the [`framefields`](https://www.npmjs.com/package/framefields) npm package. If the project doesn't have framefields set up yet, follow the `framefields` skill first (install, project scaffold, first render).

## Overview
`framefields` is a code-first, deterministic video composition SDK executing natively on WebGPU (Dawn) in Node.js. It replaces browser-based rendering (Puppeteer/Chromium) with high-performance GPU pipelines, Yoga flexbox layout, Slug vector typography, 3D camera transforms, and reactive audio/signal drivers.

Every composition is defined as a tree of layout nodes compiled into a deterministic execution program: `(composition, frame) → pixels`.

---

## Architecture & Core Concepts

### 1. Composition Lifecycle
A `Composition` instance defines canvas dimensions, frame rate, background, registered fonts, global audio tracks, and the layer hierarchy:

```typescript
import { Composition, Layer, FontManager } from "framefields";

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
| `Layer.text(content, options)` | `"text"` | Slug GPU vector text. Options: `fontSize`, `fontFamily`, `fill`, `letterSpacing`, `lineHeight`, `align`, `direction`, `animators`, `spans`. Arabic, Hebrew and Persian are shaped and laid out right to left automatically (`direction: "auto"`); set `"rtl"`/`"ltr"` to force it. `align: "start"`/`"end"` follow the direction. |
| `Layer.box(options)` | `"box"` | Rectangular container / card. Options: `background`, `borderRadius`, `borderColor`, `borderWidth`, `overflow: "hidden"`, `padding`, `children`. |
| `Layer.flex(options)` | `"flex"` | Auto-layout container (Yoga). Options: `dir: "row" \| "column"`, `gap`, `justify`, `align`, `padding`, `wrap`, `children`. |
| `Layer.video(src, options)` | `"media"` | Video layer decoded via mediabunny. Options: `fit: "cover" \| "contain"`, `trimStartSec`, `muted`, `volume`. |
| `Layer.image(src, options)` | `"media"` | Static raster image (`.png`, `.jpg`, `.webp`). Options: `fit: "cover" \| "contain"`. For vector animations (`.json`, `.lottie`), use `Layer.lottie`. |
| `Layer.svg(src, options)` | `"media"` | Vector SVG asset. Options: `fit: "contain"`. |
| `Layer.lottie(src, options)` | `"media"` | Lottie vector animation file (`.json`, `.lottie`). Decoded and rendered via ThorVG. Options: `fit: "contain" \| "cover" \| "fill"`, `width`, `height`. |
| `Layer.audio(src, options)` | `"media"` | Audio track layer. Options: `volume`, `startFrame`, `durationFrames`. |
| `Layer.shape(type, options)` | `"shape"` | Parametric vector graphics (`"rect"`, `"circle"`, `"ellipse"`, `"polygon"`, `"star"`, `"arrow"`, `"path"`). Options: `fill` (a color or CSS gradient), `d` (SVG path data with arcs), `strokeWidth`, `strokeColor`, `trimStart`, `trimEnd`. |
| `Layer.caption(src, options)` | `"media"` | SRT-driven synchronized subtitle engine. Bottom-anchored auto-wrapping cues. |
| `Layer.chart(options, props)` | `"box"` | Charts built from native nodes (d3 scales and geometry). `type`: `"line" \| "area" \| "bar" \| "scatter" \| "candlestick" \| "pie" \| "donut"`. Options: `width`, `height`, `series: [{ name, data, color, type, curve, pointRadius }]` or `data`, `categories`, `stacked`, `xAxis`/`yAxis` (`min`, `max`, `ticks`, `grid`, `format`: a d3-format string like `"$,.0f"`), `legend`, `valueLabels`, `fontFamily`, `fontSize`, `colors`, `animate: { start, duration, stagger, ease } \| false`. `props` positions the chart box. Children get ids `<id>-bar-<series>-<i>`, `<id>-line-<series>`, `<id>-slice-<i>`. Keep scatter charts to a few hundred points: each point is a node. |
| `Layer.camera(options)` | `"camera"` | 3D scene camera with FOV, lens rack focus, and orbital coordinates. |
| `Layer.light(options)` | `"light"` | 3D lighting primitive (`ambient`, `directional`, `point`, `spot`). Directional and spot take `castShadow: true` (one per scene), `shadowSoftness`, `shadowDarkness`. |
| `Layer.environment(preset, options)` | `"light"` | The 3D scene's world: studio image-based light, exposure, tone mapping, fog, bloom. **Adding one switches the scene to physically based shading.** See *3D Look* below. |
| `Layer.sequence(entries, options)` | `"box"` | Scenes back to back with `Transition`s between them; returns a box whose `totalFrames` is the length. See *Scenes & Transitions*. |
| `Layer.model(options)` | `"model3d"` | 3D mesh loader (`.gltf`, `.glb`, `.obj`, `.fbx`, `.stl`, `.ply`). Supports skinning and audio deformation compute shaders. |
| `Layer3D.roundedBox / sphere / cylinder(options)` | `"model3d"` | Procedural solid meshes, centered on `x`/`y`/`z` (y is down, so "top" is -y). `roundedBox`: `width`, `height`, `depth`, `radius`, `segments`, `taper` (top face scale, <1 for a keycap). `sphere`: `radius`. `cylinder`: `radius` or `radiusTop`/`radiusBottom`, `height`, `openEnded`. `color` is baked in; `tint` multiplies it and animates as the `color` prop. Surface: `roughness`, `metallic`, `emissive`, `emissiveIntensity`, `castShadow`. Equal shapes share one GPU buffer, so hundreds of copies are cheap. |

---

## Animation System (`LayerAnimation`)

Create animations using `LayerAnimation.create()` or fluent factory methods. Animations are composed of keyframed tracks or procedural drivers.

### 1. Keyframe Transitions (`fromTo`)
```typescript
import { LayerAnimation } from "framefields";

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
import { Layer, LayerAnimation, TextAnimator } from "framefields";

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
import { CameraAnimation } from "framefields";

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

// Audio reactivity: pass the signal object straight in…
const kick = Signal.fromArray(kickEnvelope, fps); // or Signal.builder({ type: "custom", fn })
const beatAnim = LayerAnimation.create()
  .signal("scale", kick, { multiplier: 0.12, offset: 1.0, smoothing: 2 });

// …or register it once by name and bind the name (handy when many layers share it)
comp.addSignal("drum_stem_signal", kick);
const beatAnim2 = LayerAnimation.create()
  .signal("opacity", "drum_stem_signal", { multiplier: 0.5, offset: 0.5 });
```

`.signal()` / `.colorSignal()` drive the prop with `value × multiplier + offset` every frame. A signal
object is carried on its track and registered with the program automatically (under a generated
`inline_signal_N` id, so the spec stays plain JSON); a string is looked up in `comp.addSignal` names.
Anything else (a number, `undefined`) throws. Signals are sampled at the **composition** frame
(`ctx.frame`), not the layer's local frame.

---

## Color, Gradients & Text Metrics

Every color prop accepts hex, `rgb()`, `hsl()`, `oklch()`, `oklab()` and CSS names. Color keyframes blend **perceptually (OKLab)**, so red → green passes through yellow, not mud. `Color` builds colors without hand-rolled math; every helper returns a hex string:

```typescript
import { Color, Gradient } from "framefields";

Color.oklch(0.72, 0.16, 250);          // equal L = equal perceived brightness: balanced palettes
Color.mix("#ff5a1f", "#1f6bff", 0.5);  // perceptual mix
const wave = Color.ramp(["#3b82f6", "#8b5cf6", "#ec4899"]); wave(0.3);
Color.steps(["#0E0D0C", "#FF5A1F"], 5); // 5 swatches
Color.lighten(EMBER, 0.1); Color.alpha("#000", 0.4); Color.readableOn(bg);
Color.contrast(fg, bg);                 // WCAG ratio; ≥ 4.5 body text, ≥ 3 large
```

**Gradients are CSS strings**, usable in any `background` (boxes, flex, cards; rounded corners kept) and any shape `fill`. Linear, radial and conic, up to 8 stops, hard stops (`red 0 50%, blue 0`), `transparent` fades keep their hue:

```typescript
Layer.box({ background: "linear-gradient(135deg, #ff5a1f, #ffb800 60%, #7c3aed)" });
Layer.shape("circle", { fill: Gradient.radial(["#fff", "transparent"]) });
Layer.box({ background: Gradient.conic(["red", "yellow", "lime", "aqua", "blue", "magenta", "red"]) });
```

**Measure text with the real font** instead of guessing advances (place carets, underline a word, size a pill):

```typescript
const m = FontManager.measure("Hello, world", { fontFamily: "Inter", fontSize: 64 });
m.width; m.height; m.lines; m.caretX(5); m.glyphs[0].x; // px, relative to the text box
```

---

## Composing Animations

`.animate()` **layers** onto what a node already has: call it several times, or pass several animations. Keyframe tracks on the same prop merge into one sorted track; a later key wins on a shared frame. Author behaviours separately and combine them:

```typescript
const rainIn = LayerAnimation.keys("y", [[0, -300], [d, -300], [d + 12, 0, "back.out(1.5)"]]);
const press  = LayerAnimation.keys("y", [[40, 0], [42, 6, "power2.in"], [47, 0, "power2.out"]]);
const glow   = LayerAnimation.keys("color", [[42, GLOW], [60, REST, "sine.inOut"]]);
key.animate(rainIn).animate(press, glow);   // or LayerAnimation.merge(rainIn, press, glow)
```

---

## Track Mattes (masks, wipes, reveals)

`node.withMatte(matteLayer, mode)` shows `node` only where the matte is opaque (`"alpha"`, default), transparent (`"alpha-inverted"`), bright (`"luma"`) or dark (`"luma-inverted"`). The matte is laid out like a **sibling** (same parent; absolute), keyed from the node's start, and covers the node's box when it has no `x`/`y`/`width`/`height`. It is never drawn by itself. On a 3D layer (or model) the matte works in screen space inside the 3D pass, so the layer still sorts by depth and its hidden part does not block what is behind it; a matte with its own `z` is projected like any 3D layer.

```typescript
// Text revealed by a sliding bar
Layer.text("LAUNCH", { id: "title", position: "absolute", x: 560, y: 480, width: 800, height: 120, fontSize: 120 })
  .withMatte(
    Layer.box({ position: "absolute", x: 560, y: 480, width: 800, height: 120, background: "#fff" })
      .animate(LayerAnimation.keys("x", [[0, -240], [24, 560, "expo.out"]])),
  );

// Video inside type: the text is the matte
Layer.video("assets/surf.mp4", { position: "absolute", x: 0, y: 0, width: W, height: H, fit: "cover" })
  .withMatte(Layer.text("OCEAN", { position: "absolute", x: 0, y: 340, width: W, fontSize: 380, align: "center", fill: "#fff" }));
```

---

## Scenes & Transitions

`Layer.sequence` places full-frame scenes end to end, overlapping each pair by its transition, and writes the scenes' `startFrame` / `durationFrames` for you (each scene keys from its own frame 0). Transitions are ordinary keyframes and mattes merged into the scenes:

```typescript
import { Layer, Transition } from "framefields";

const film = Layer.sequence([
  { scene: hero(), duration: beats(8) },
  { scene: features(), duration: beats(12), transition: Transition.push("left", 18) },
  { scene: proof(), duration: beats(8), transition: Transition.wipe("right", 16) },
  { scene: outro(), duration: beats(6), transition: Transition.iris(20) },
], { width: W, height: H });
comp.add(film);                       // film.totalFrames → composition length
```

| Transition | Look |
|---|---|
| `cut()` | hard cut |
| `crossfade(frames)` | new scene fades in over the old |
| `fadeThrough(frames)` | dip to the background color and back |
| `push(dir, frames, ease)` | new scene pushes the old one out |
| `slide(dir, frames)` | new scene slides over the old (which dims) |
| `zoom(frames)` | old scene grows and fades, new one settles in |
| `whip(dir, frames)` | fast motion-blurred push |
| `wipe(dir, frames)` | hard edge sweeps across (matte) |
| `iris(frames, { at })` | circle opens from a point (matte) |

---

## 3D Look: Environment, Materials, Shadows, Bloom

A scene **without** `Layer.environment` keeps the classic Blinn-Phong look. **Add one** and the whole 3D pass becomes physically based: linear-light GGX shading where `roughness` and `metallic` behave like in Blender, a procedural studio environment that lights and reflects off everything, exposure, tone mapping, and optional fog and bloom.

**Fastest path to a great product shot: a lighting rig.** It returns an environment plus placed key/rim(/fill) lights, the key casting a soft shadow:

```typescript
import { Lighting } from "framefields";

comp.add(Lighting.studio({ target: [W / 2, H / 2, 0] }));   // also: soft, sunset, dramatic
comp.add(Lighting.dramatic({ target: [W / 2, H / 2, 0], bloom: true, fog: { color: BG, start: 2500, end: 6000 } }));
// knobs: intensity, exposure (stops), rotation (turns the rig), shadowSoftness, shadows: false
```

Or by hand:

```typescript
comp.add([
  Layer.environment("studio", {        // presets: studio | soft | sunset | night | neutral
    exposure: 0.3,                     // stops
    toneMapping: "neutral",            // default; "agx" filmic, "aces" punchy, "none"
    rotation: 30,                      // turn the reflections
    fog: { color: BG, start: 2000, end: 5000 },   // surfaces fade into the background color
    bloom: true,                       // or { intensity: 0.3, threshold: 1.6, radius: 6 }
  }),
  Layer.directionalLight({ x: 400, y: -1200, z: -600, targetX: 960, targetY: 540, castShadow: true }),
]);

Layer3D.sphere({ radius: 90, color: "#e8e8e8", metallic: 1, roughness: 0.15 });  // chrome
Layer3D.roundedBox({ ..., color: "#ff5a1f", roughness: 0.45 });                  // satin plastic
Layer3D.cylinder({ ..., color: "#111", emissive: "#4da3ff", emissiveIntensity: 3 }); // neon tube
```

- **Tone mapping `"neutral"` (default) keeps brand colors as authored**: orange stays orange. Use `"agx"` for a filmic roll-off.
- **Bloom only takes light well past white** (emissive ≳ 3, hot speculars), so ordinary bright surfaces don't glow. Raise `emissiveIntensity` to make something glow.
- **Shadows:** one `castShadow` directional or spot light per scene. Meshes cast by default (`castShadow: false` opts out); flat layers (planes, cards) cast only with `castShadow: true`. Everything receives.
- **Fog** fades to `fog.color` exactly, so set it to the composition background for a seamless horizon.
- **Models:** glTF materials bring base color, normal, metallic-roughness, occlusion and emissive maps.
- `emissive` / `emissiveIntensity` / `exposure` animate like any prop (`.keys("emissiveIntensity", …)`).

---

## Critical Authoring Rules & Gotchas

1. **Local Keyframe Coordinates:** Keyframes are strictly relative to the node's own timeline window (`0` = node appearance). Never offset keyframe frames by the parent's `startFrame`.
2. **Coordinate Overrides:** Animating `y` overrides the node's layout `y`. If a node is placed at `y: 400`, animate `fromTo("y", 440, 400)`, NOT `fromTo("y", 40, 0)`.
3. **No String Styles for Borders:** Use `borderColor` and `borderWidth`. CSS `border: "1px solid red"` is silently ignored.
4. **Font Registration is Mandatory:** In headless WebGPU, system fonts do not exist. Every font must be registered via `FontManager.register()` and listed in `comp.fonts`. Emoji need a color emoji font too: framefields ships none, so register one with `FontManager.registerEmojiFont("assets/fonts/NotoColorEmoji.ttf")` (a CBDT/CBLC bitmap font such as Noto Color Emoji). Without it exports draw nothing for emoji.
5. **Integer Frames Only:** Keyframe frames, start frames, and durations must be integers. Decimal frames cause schema validation errors.
6. **Relative vs. Absolute:** Providing `x` or `y` without `position: "relative"` turns the node into an absolute-positioned layer removed from flex flow.
7. **Audio Layer Duration:** Every `Layer.audio()` must be assigned `durationFrames` to prevent audio truncation in headless rendering.
8. **Premultiplied Alpha:** Alpha shaders operate with premultiplied alpha. Never use `"src-alpha"` factor in custom blends.
9. **Lint before rendering:** `comp.lint()` lists colors/gradients that would draw transparent, low-contrast text, off-canvas layers, shadow settings that do nothing and `roughness`/`metallic` without an environment. `renderVideo({ qa: true })` includes these findings.
10. **Lottie vs. Image Layers:** Use `Layer.lottie("file.json" | "file.lottie", { width, height, fit })` for Lottie vector animations. Never pass `.json` or `.lottie` to `Layer.image()`, which only decodes raster formats and throws/warns if given a vector animation.
