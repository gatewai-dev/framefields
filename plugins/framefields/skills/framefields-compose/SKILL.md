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
| `Layer.shape(type, options)` | `"shape"` | Parametric vector graphics (`"rect"`, `"circle"`, `"ellipse"`, `"polygon"`, `"star"`, `"arrow"`, `"path"`). Options: `fill` (a color or CSS gradient), `d` (SVG path data with arcs; keyframe it to morph shapes), `strokeWidth`, `strokeColor`, `trimStart`, `trimEnd`. |
| `Layer.particles(options)` | `"media"` | GPU particle system (see *GPU Particles*). |
| `Layer.vfx(options)` | `"media"` | Procedural full-frame VFX: smoke, fire, rain, snow, aurora… (see *Procedural VFX*). |
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

### Stepped timing ("on twos")

`LayerAnimation.stepped(n)` holds every animated value of the layer for `n` frames: `2` is "on twos", the choppy, hand-made feel of cel animation, stop motion and paper cut-outs. It applies to all of the layer's tracks (keyframes keep their eases; signals and wiggles step too). Mix stepped characters over a smooth camera or background for the classic look.

```typescript
puppet.animate(walkCycle, bob, LayerAnimation.stepped(2));
```

### Shape morphing

A path shape's `d` is animatable: keyframe two or more SVG paths and they morph. Any paths work (different point counts, curves, arcs, several subpaths); they are resampled and lined up so the morph does not twist. Eases apply as usual.

```typescript
Layer.shape("path", { position: "absolute", x: 0, y: 0, width: 400, height: 400, d: BLOB_A, fillColor: "#3B82F6" })
  .animate(LayerAnimation.keys("d", [[0, BLOB_A], [24, STAR, "back.out(1.4)"], [48, HEART, "expo.inOut"]]));
```

For liquid merges between separate shapes, draw them into one SVG or particle layer and add `Gooey` (blur + alpha threshold = metaballs).

---

## Blend Modes

Any layer takes `blendMode`, which sets how it mixes with what is drawn beneath it. Use it on glows, textures, light leaks, grain, color washes and type over footage.

| Mode | Use it for |
|---|---|
| `"normal"` (default) | Plain over. |
| `"screen"`, `"lighter"` (add), `"color-dodge"`, `"lighten"` | Light: glows, flares, light leaks, fire/sparks footage shot on black. |
| `"multiply"`, `"color-burn"`, `"darken"` | Shade: paper and grunge textures, shadows, ink on paper. |
| `"overlay"`, `"soft-light"`, `"hard-light"` | Contrast textures, film grain, color washes that keep the image's shading. |
| `"difference"`, `"exclusion"` | Inverting type over video, glitchy flashes. |
| `"hue"`, `"saturation"`, `"color"`, `"luminosity"` | Recolour footage with a flat color layer (`"color"` = tint, keeps the light). |
| `"mask-in"` / `"mask-out"`, `"luma-in"` / `"luma-out"`, `"source-*"`, `"destination-*"`, `"xor"` | Compositing operators: keep the base where this layer is opaque / transparent / bright / dark. Prefer `withMatte` for reveals. |

```typescript
Layer.video("assets/light-leak.mp4", { position: "absolute", x: 0, y: 0, width: W, height: H, fit: "cover", blendMode: "screen", opacity: 0.8 })
Layer.box({ position: "absolute", x: 0, y: 0, width: W, height: H, background: "#ff3d7f", blendMode: "color", opacity: 0.6 })   // duotone-ish tint
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
- **Models:** glTF materials bring base color, normal, metallic-roughness, occlusion and emissive maps; OBJ (`map_Kd`, `norm` in the `.mtl`) and FBX bring diffuse and normal maps, looked up next to the model. Textures must be PNG, JPEG, WebP, GIF, TIFF or AVIF: TGA, PSD, DDS and KTX2 are skipped with a warning (convert them). Draco / meshopt-compressed glTF files fail to load: re-export without mesh compression. Vertex colors (VOX, PLY, OFF, glTF `COLOR_0`) multiply the base color.
- **Model orientation:** the world is y-down, so a y-up model (most glTF, OBJ and FBX files) needs `rotateX: 180` to stand upright.
- `emissive` / `emissiveIntensity` / `exposure` animate like any prop (`.keys("emissiveIntensity", …)`).
- **Glass:** `material: "glass" | "acrylic" | "frosted"` on any Layer3D primitive, extruded text (`Layer3D.extrudedText`) or model refracts whatever is behind it on screen — the video, 2D layers, particles — with a rainbow fringe (`dispersion`, default 0.04), bend strength `thickness` (px, default 80) and `ior` (1.5). `color` tints the glass (deeper toward the edges); `frosted` blurs by `roughness`. Glass needs no environment: it draws its own studio reflections, and against a dark grade it reads best — skip `Lighting.*` rigs for glass-only scenes (their environment washes glass out). Glass shows only 2D content and opaque 3D drawn before it, not other glass.

---

## Physics (`Physics.world2d` / `Physics.world3d`)

Use for anything that should *fall, bounce, stack, swing or collide*: gravity drops of words or cards, UI pieces tumbling into a pile, a "jiggle" on a spring, balls rattling in a box, dominoes, physics-driven 3D products. Use keyframes instead for motion that should hit an exact designed pose at an exact frame.

A world runs **once** while the composition is built (Rapier, deterministic build: identical on every machine) and replays as per-frame signals, so frames render in any order. `simulate()` binds each body's layer (`x`, `y`, `rotation`; in 3D `x/y/z`, `rotateX/Y/Z`):

```typescript
import { Layer, LayerAnimation, Physics } from "framefields";

const world = await Physics.world2d({ fps: FPS, frames: 150 }); // gravity 2400 px/s², y down
world.walls({ width: W, height: H - 160 });                       // floor + sides (ceiling: true to close)

const cards = words.map((word, i) => {
  const card = Layer.box({ position: "absolute", x: 140, y: -300 - i * 260, width: 560, height: 170, rotation: -8, borderRadius: 28, background: EMBER /* … */ });
  world.body(card, { restitution: 0.35, startFrame: i * 6 });   // staggered drop
  return card;
});
world.simulate();

// Every body exposes signals; bind them to anything (props, effect uniforms):
glow.animate(LayerAnimation.create().signal("opacity", world.impact, { multiplier: 1.5 })); // loudest hit
stage.animate(LayerAnimation.create().signal("y", world.impact, { multiplier: 14 }));       // camera shake
```

- **Bodies come from layers** with numeric `x`, `y` and a size; the layer's pose (incl. `rotation`, `scale`, `anchorX/Y`) is the start pose. Colliders follow the layer: circles are balls, `borderRadius` rounds the box, polygons / stars / paths use their convex hull, text without a size is measured. Override with `shape: "box" | "circle" | "hull"` and `size: [w, h]`. Plain `{ x, y, width, height }` makes an invisible obstacle.
- **Body options:** `type: "dynamic" | "fixed" | "kinematic"`, `restitution` (0.3), `friction` (0.6), `density` (1), `velocity: [vx, vy]` px/s, `angularVelocity` °/s, `linearDamping`, `angularDamping`, `gravityScale` (0 floats), `lockRotation`, `ccd` (very fast bodies), `sensor`, `startFrame` (holds its pose until then), `output: "signals" | "keyframes" | "none"`.
- **Signals per body:** `x`, `y`, `rotation`, `centerX`, `centerY`, `vx`, `vy`, `speed`, `angularVelocity`, `sleeping`, `impact` (jumps on each new contact, 1 ≈ a 1500 px/s hit, decays over `impactDecay` frames). `world.impact` is the loudest body each frame. `body.collisions` / `world.collisions` list first contacts `{ frame, with, speed }`: place hit sounds or flashes at those frames.
- **Scene:** `world.ground({ y })`, `world.walls({ x, y, width, height, ceiling })`.
- **Joints:** `world.pin(body, [x, y])` (swing around a point), `world.hinge(a, b, [x, y])`, `world.weld(a, b)`, `world.spring(a, bOrPoint, { frequency: 2, dampingRatio: 0.2, length })`, `world.rope(a, bOrPoint, { length })`. Points are world px.
- **Driving the simulation:** `world.force(body, { x, y })` (px/s², mass-independent), `world.impulse(body, frame, [vx, vy])` (a kick), kinematic `follow: { x, y, rotation }`. Each of these takes a number, a signal (audio, `Signal.fromArray`) or `(frame) => value`: e.g. a floor that bounces on the kick.
- **Force fields:** `world.field((s) => [ax, ay], { bodies })` is called every solver step with a body's center `s.x`, `s.y` (px), velocity `s.vx`, `s.vy` and `s.frame`; return px/s² or nothing. Wind, vortices, attractors, flow fields — and performers (below).
- **Performers in the simulation:** `const dancer = comp.vision("dancer.mp4")` gives the clip's pose and silhouette per frame, analysed on demand (see `framefields-effects`). Make the world **live** so it steps as frames render instead of all at once: `world.live(comp)` in place of `simulate()`. Before each frame draws, the clip's vision for that frame is computed (or read from the cache) and the world advances to it — nothing is analysed up front, the preview plays at once and fills in, and export gives the identical result (same simulation, same order). Then, with `const person = dancer.person.place({ width: W, height: H, fit: "cover" })`:
  - limbs as kinematic colliders that catch and bat things: `world.body({ x, y, width: 2 * r, height: 2 * r }, { type: "kinematic", shape: "circle", follow: { x: (f) => person.point("leftWrist", f).x - r, y: (f) => person.point("leftWrist", f).y - r } })`, a few balls along each shoulder → elbow → wrist;
  - the silhouette (dress included) as a force field: `person.sample(frame, x, y)` returns `alpha` (inside > 0.5) and a gradient `gx`, `gy` pointing inward, so `world.field((s) => { const m = person.sample(s.frame, s.x, s.y); … return [-m.gx * k, -m.gy * k]; })` makes particles and props flow around a moving body.
  - Reads are synchronous and need the frame analysed: inside a live world, while rendering, or after `await dancer.ready(frame)` (e.g. `ready(0)` to lay things out around the first pose). A live world can't look ahead, so place things from early frames.
  - Layer a vision cutout of the same clip (`Layer.video(src).withVision({ mode: "matte" })`) above the particles so they pass behind the performer.
  - Live worlds bind signals only (no `bakeKeyframes()`); `await world.advanceTo(frame)` steps one without rendering (e.g. to read `collisions`).
- **Particles:** for clouds, dust, sparks, fluids and flow fields use `Layer.particles` (GPU, below), not hundreds of physics bodies. Keep physics bodies for a few dozen things that must collide and stack (cards, letters, products).
- **Keyframes instead of signals:** `world.bakeKeyframes({ tolerance: 0.25 })` in place of `simulate()` writes plain, simplified linear keyframes (editable, plain JSON).
- **3D:** `Physics.world3d` takes `Layer3D.roundedBox / sphere / cylinder` and models (convex hull of the mesh); same options with 3-vectors, `world.hinge(a, b, at, axis)`, `world.walls({ width, height, depth })`.
- **Timing:** signals are on the composition clock. In a scene that starts at frame `S`, pass `startFrame: S` to the world. Before it and after `frames` the signals hold their first/last value. Add every body, joint and force before `simulate()` (or before reading any signal): the world then locks.
- **Feel:** gravity 2400 px/s² reads snappy on a 1080p canvas; `pixelsPerMeter` (100) scales how heavy things feel. Raise `substeps` (4) for tall stacks or thin, fast bodies.
- Install note: physics uses the optional dependency `@dimforge/rapier2d-deterministic-compat` / `rapier3d-deterministic-compat` (installed by default with framefields).

---

## GPU Particles (`Layer.particles`)

Tens of thousands of particles simulated in a compute shader and drawn in one call — sparks, embers, dust, snow, smoke, ink, flow fields, light painting, a fluid a performer moves through. A particle layer is a box in composition px; positions inside it are layer px.

```typescript
comp.add(Layer.particles({
  width: W, height: H, max: 20000, seed: 7,
  emitter: { shape: "rect", x: 0, y: H * 0.6, width: W, height: 200, rate: 3000 },  // point | line | rect | circle | ring; radial
  lifetime: [4, 6], speed: [0, 40], direction: -90, spread: 360,
  gravity: 20, drag: 1.5,                                      // px/s², per second
  noise: { strength: 260, scale: 170, speed: 0.25 },          // curl-noise flow: smoke, ink, flow fields
  attractors: [{ x: W / 2, y: H / 2, strength: 900, radius: 200 }],   // negative strength repels
  push: { person, strength: 9000, sweep: 120000 },             // a performer's silhouette pushes them (comp.vision)
  floor: H - 60, bounce: 0.2, bounds: "none",                  // none | kill | bounce | wrap
  size: [10, 4], sizeJitter: 0.5, fade: [0.1, 0.3],
  shape: "circle",                                             // circle | soft (glow) | square | spark (streaks along motion)
  color: ["#ffd23f", "#ff5a1f", "#7a2e14"],                    // over life, or by speed with colorBySpeed: 600
  blend: "normal",                                             // add for glows and light painting
  prewarm: 3,                                                  // seconds simulated before frame 0: starts full
}));
```

- `emitter.x` / `emitter.y`, `rate`, `gravity`, `drag`, `noise.strength`, attractor positions/strengths and `push` strengths take a number, a signal (audio, physics `impact`) or `(frame) => value`, read every frame: bursts on the beat, wind gusts, an attractor following a tracked hand (`person.point("rightWrist", f)`). `emitter.bursts: [{ frame, count }]` adds one-off explosions.
- Recipes: **light painting** an additive `"soft"` point emitter whose `x`/`y` follow a tracked wrist (`(f) => person.point("rightWrist", f).x`), lifetime ~1 s, small speed, births spread along the hand's path so fast moves stay continuous; **sparks/fountain** `shape: "spark"`, `blend: "add"`, gravity, `floor`; **smoke/ink** `shape: "soft"`, low opacity, `noise`, sizes growing; **snow/dust** `rect` emitter above the frame, small gravity, `noise`, `bounds: "wrap"`; **swirl** `ring` emitter + attractor + `colorBySpeed`; **fluid around a dancer** `push: { person }` + `drag` 2 + gentle noise, and a vision cutout of the clip above the particle layer.
- The system steps as frames render and snapshots itself every 24 frames, so scrubbing back restores instead of replaying from the start; the same GPU gives the same frames.

---

## Procedural VFX (`Layer.vfx`)

Full-frame procedural looks drawn by one shader, transparent where there is no effect. Stack them above or below footage, and set a `blendMode` (usually `"screen"`) for light effects.

```typescript
Layer.vfx({ effectType: "Aurora", width: W, height: H, colorStart: "#2bff88", colorEnd: "#7a3cff", density: 0.7, speed: 1 })
```

`effectType`: `Smoke`, `Fire`, `Rain`, `Sparks`, `Snow`, `Dust`, `Lightning`, `Magic`, `LensFlare`, `Embers`, `EnergyBeam`, `Aurora`. Shared knobs: `density`, `scale`, `speed`, `intensity` and `seed` (numbers or signals), plus `colorStart` / `colorEnd`. For particles that react to physics, a performer or attractors, use `Layer.particles` instead.

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
11. **AI-generated media are assets, not build steps:** Images, clips, music or voice made with `ai` (from `framefields`) are generated once by a separate script into `assets/generated/` and loaded like any other file. Never call `ai` from `buildFilm()` or a scene function: it would spend money and change the film on every render, preview and test. The `framefields` skill (section 6) covers the key, the script and the model catalog.
