---
name: framefields-compose
description: Design, structure, and animate code-first video compositions using the framefields WebGPU SDK. Use when writing or changing a framefields film — scenes and transitions, layout trees, keyframes and easing, kinetic typography, shapes and morphs, charts, blend modes and mattes, 3D scenes (cameras, lights, materials, outlines, models), physics, GPU particles, procedural VFX layers, time remapping, or audio-synchronized motion.
---

# framefields-compose

Import everything from [`framefields`](https://www.npmjs.com/package/framefields) (no project yet: the `framefields` skill). A composition is a tree of layout nodes (Yoga flexbox, GPU vector text, 3D, physics, particles, signals) compiled into a deterministic `(composition, frame) → pixels`.

## Structure

### Composition

```typescript
import { Composition, Layer, FontManager } from "framefields";

// Register fonts before building text layers (the composition picks them up)
await FontManager.register({ family: "Inter", source: "assets/fonts/Inter.ttf" });

const comp = new Composition({
  width: 1920,
  height: 1080,
  fps: 30,
  durationMs: 10000, // or computeDuration()
  backgroundColor: "#0E0D0C",
});

comp.add(Layer.box({ /* ... */ }));
comp.add(Layer.audio("assets/score.mp3", { volume: 1, durationFrames: 300 }));
```

### Scenes (films, ads, multi-shot)

- **`theme.ts`:** palette, type, eases and a tempo-locked beat grid (`BEAT = Math.round(fps * 60 / BPM)`). No ad-hoc margins or hex codes elsewhere.
- **`scenes/<name>.ts`:** each returns a full-frame root box with `startFrame` / `durationFrames`; children key from the scene's frame 0.
- **`film.ts`:** mounts the scenes (`comp.add(scene())` or `Layer.sequence`), the soundtrack and composition-level grade/grain.

`Scene` / `Sequence` windows are half-open `[startFrame, startFrame + durationFrames)`. A root layer starting at local frame 30 of a 60-frame scene defaults to 30 frames; explicit windows must fit the scene (overflow throws with the IDs). Overlaps can't exceed either neighbour; the last scene's outgoing overlap doesn't shorten the timeline. `calculateTimeline().totalFrames` is the last exclusive scene end.

```typescript
// theme.ts
import { Layer, type LayoutNode } from "framefields";

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const BEAT = 18; // 100 BPM at 30 fps
export const beats = (n: number) => Math.round(n * BEAT);

export const INK = "#0E0D0C";
export const PAPER = "#EEE9E0";
export const EMBER = "#FF5A1F";

export function scene(options: { id: string; from: number; to: number; children: LayoutNode[] }) {
  return Layer.box({
    id: options.id,
    position: "absolute",
    x: 0,
    y: 0,
    width: W,
    height: H,
    startFrame: options.from,
    durationFrames: options.to - options.from,
    children: options.children,
  });
}
```

---

## Layer Primitives (`Layer.*`)

All `Layer.*` builders return `AnimatableNode<T>` instances with chainable `.animate()`, `.apply()`, and effect methods.

| Builder | Node `kind` | Description & Key Options |
|---|---|---|
| `Layer.text(content, options)` | `"text"` | Slug GPU vector text. Options: `fontSize`, `fontFamily`, `fontWeight`, `fontVariations` (variable font axes, e.g. `{ wdth: 68 }` for a condensed cut; spans inherit them), `fill`, `letterSpacing`, `lineHeight`, `align`, `direction`, `animators`, `spans`. Arabic, Hebrew and Persian are shaped and laid out right to left automatically (`direction: "auto"`); set `"rtl"`/`"ltr"` to force it. `align: "start"`/`"end"` follow the direction. |
| `Layer.box(options)` | `"box"` | Rectangular container / card. Options: `background`, `borderRadius`, `borderColor`, `borderWidth`, `overflow` (`"visible"` by default; `"hidden"` clips children to the box and its rounded corners), `padding`, `children`. |
| `Layer.flex(options)` | `"flex"` | Auto-layout container (Yoga). Options: `dir: "row" \| "column"`, `gap`, `justify`, `align`, `padding`, `wrap`, `children`. |
| `Layer.video(src, options)` | `"media"` | Video layer decoded via mediabunny. Options: `fit: "cover" \| "contain"`, `trimStartSec`, `muted`, `volume`. |
| `Layer.image(src, options)` | `"media"` | Static raster image (`.png`, `.jpg`, `.webp`). Options: `fit: "cover" \| "contain"`. For vector animations (`.json`, `.lottie`), use `Layer.lottie`. |
| `Layer.svg(src, options)` | `"media"` | Vector SVG asset. Options: `fit: "contain"`. |
| `Layer.lottie(src, options)` | `"media"` | Lottie vector animation file (`.json`, `.lottie`). Decoded and rendered via ThorVG. Options: `fit: "contain" \| "cover" \| "fill"`, `width`, `height`. |
| `Layer.audio(src, options)` | `"media"` | Audio track layer. Options: `volume`, `startFrame`, `durationFrames`. |
| `Layer.shape(type, options)` | `"shape"` | Parametric vector graphics (`"rect"`, `"circle"`, `"ellipse"`, `"polygon"`, `"star"`, `"arrow"`, `"path"`). Options: `fill` (a color or CSS gradient), `d` (SVG path data with arcs; several subpaths fill by the nonzero rule, so holes and islands work; keyframe it to morph shapes), `strokeWidth`, `strokeColor`, `strokeDashArray` (SVG syntax, `"12 8"`), `trimStart`, `trimEnd`. |
| `Layer.particles(options)` | `"media"` | GPU particle system (see *GPU Particles*). |
| `Layer.vfx(options)` | `"media"` | Procedural full-frame VFX: smoke, fire, rain, snow, aurora… (see *Procedural VFX*). |
| `Layer.shader(options)` | `"media"` | A layer drawn by your own WGSL fragment (see *Custom Shaders*). |
| `Layer.caption(src, options)` | `"media"` | SRT-driven synchronized subtitle engine. Bottom-anchored auto-wrapping cues. |
| `Layer.chart(options, props)` | `"box"` | Charts built from native nodes (d3 scales and geometry). `type`: `"line" \| "area" \| "bar" \| "scatter" \| "candlestick" \| "pie" \| "donut"`. Options: `width`, `height`, `series: [{ name, data, color, type, curve, pointRadius }]` or `data`, `categories`, `stacked`, `xAxis`/`yAxis` (`min`, `max`, `ticks`, `grid`, `format`: a d3-format string like `"$,.0f"`), `legend`, `valueLabels`, `fontFamily`, `fontSize`, `colors`, `animate: { start, duration, stagger, ease } \| false`. `props` positions the chart box. Children get ids `<id>-bar-<series>-<i>`, `<id>-line-<series>`, `<id>-slice-<i>`. Keep scatter charts to a few hundred points: each point is a node. |
| `Layer.camera(options)` | `"camera"` | 3D scene camera with FOV, lens rack focus, and orbital coordinates. |
| `Layer.light(options)` | `"light"` | 3D lighting primitive (`ambient`, `directional`, `point`, `spot`); also `Layer.ambientLight` / `directionalLight` / `pointLight` / `spotLight` and `Light.*`, all taking one options object. Directional and spot take `castShadow: true`, `shadowSoftness`, `shadowDarkness`. |
| `Layer.environment(preset, options)` | `"light"` | The 3D scene's world: studio image-based light, exposure, tone mapping, fog, bloom. **Adding one switches the scene to physically based shading.** See *3D Look* below. |
| `Layer.sequence(entries, options)` | `"box"` | Scenes back to back with `Transition`s between them; returns a box whose `totalFrames` is the length. See *Scenes & Transitions*. |
| `Layer.model(options)` | `"model3d"` | 3D mesh loader (`.gltf`, `.glb`, `.obj`, `.fbx`, `.stl`, `.ply`). Supports skinning and audio deformation compute shaders. |
| `Layer3D.roundedBox / sphere / cylinder / capsule / torus / ring / prism / pyramid / polyhedron / icosahedron / icosphere / shard(options)` | `"model3d"` | Procedural solid meshes, centered on `x`/`y`/`z` (y is down, so "top" is -y). `roundedBox`: `width`, `height`, `depth`, `radius`, `segments`, `taper`. `sphere`: `radius`. `cylinder`: `radius` or `radiusTop`/`radiusBottom`, `height` (required), `openEnded`, `flatShaded`. `capsule`: `radius`, `length` (straight shaft; total height is `length + 2 * radius`). `torus`: `radius`, `tube` (tube radius), `arc`. `ring`: flat annulus (`innerRadius`, `outerRadius`). `prism` / `pyramid`: solid capped flat-shaded N-gon prism or pyramid (`sides`, `radius`, `height`). `polyhedron` (`type: "tetrahedron" \| "octahedron" \| "dodecahedron" \| "icosahedron"`), `icosahedron`, `icosphere` (`radius`, `detail`, `flatShaded`). `shard`: procedural flat-faceted polyhedron rock/crystal (`radius` or `size: [x, y, z]`, `facets`, `irregularity`, `seed`). Surface: `color`, `tint`, `roughness`, `metallic`, `emissive`, `emissiveIntensity`, `material` (`"lit" \| "glass" \| "acrylic" \| "frosted"`), `castShadow`, `wireframe`. Shared GPU buffers cache identical shapes. |
| `Layer3D.extrude / lathe / tube / line / points(options)` | `"model3d"` | Custom & path-driven 3D geometry. `extrude`: extrude a 2D SVG path `d` (with holes) or `contour`/`holes` (`depth`, `bevelThickness`, `bevelSize`, `bevelSegments`, `bevelColor`). `lathe`: revolve a 2D `points` profile `[r, y][]` around the Y axis (`segments`, `phiStart`, `phiLength`, `closed`, `flatShaded`). `tube`: sweep a solid or thick-walled hollow pipe (`radius`, `innerRadius`, `radiusTaper`, `closed`, `capped`) along a `Path3D` or 3D control `points` using rotation-minimizing frames. `line`: 3D polyline (`points` or `Path3D`, `dashSize`, `gapSize`, per-vertex `colors`). `points`: 3D point cloud (`points`, `pointSize` for lit sphere dots or `0` for `point-list`, per-point `colors`). |
| `Layer3D.instances(options)` | `"model3d"` | One draw call for many copies: `count`, `mesh` / `meshes` (variants), `instanceAt(index, frame): { position, rotation, scale, color, emissive }`, or `bodies: Body3D[]` from `Physics.world3d` with `emissiveBySpeed`, `colorRamp`. |
| `Layer3D.swarm(options)` | `"model3d"` | GPU 3D shard swarm: curl turbulence, vortex (`swirl`, `pull`, `axial`), ground collisions with friction and roll, heat glow. |
| `Layer3D.terrain(options)` | `"model3d"` | Procedural landscape, closed underneath. `width`, `depth`, `height` (relief px above the node's y, the valley floor), `segments`, `noise: { seed, scale, octaves, persistence, lacunarity, ridgeMode: "fbm" \| "ridged" \| "terrace", terraceSteps }`, or `heightFn(u, v) => 0..1` / `heights`, `overhangWarp`, `colorByElevation: { lowColor, midColor, highColor, cliffColor, cliffThreshold, bands }`, `flatShaded`. Returns a node with `heightAt(x, z)`, `normalAt(x, z)`, `elevationAt(x, z)` to stand cameras, lights, video screens and models on the ground. Static `Physics.world3d` bodies collide with its exact triangles. |
| `Layer3D.sdf(options)` | `"model3d"` | Boolean sculpture: `primitives: [{ shape: "sphere" \| "box" \| "cylinder" \| "capsule" \| "torus" \| "gyroid", op: "union" \| "subtract" \| "intersect", smoothness (px blend), center, rotation, color, …size }]` meshed watertight inside `bounds: [w, h, d]` at `resolution` (16..160). Colors blend across smooth joins; a colored cutter paints its cut. |
| `Layer3D.scatter(options)` | `"model3d"` | Scatter `mesh` (one or an array of variants, any Layer3D mesh or `Layer.model`) over `surface` (terrain, sdf, primitive or model file): `count`, `minDistance` (Poisson spacing), `seed`, `slopeRange` (deg from level), `elevationRange` (0..1), `alignToNormal`, `scaleRange`, `randomYaw`, `exclude: [{ x, z, radius, falloff }]`, `sink`, `wind`. Deterministic, one draw call per variant; `.points()` returns where they stand. |

---

## Media time remapping

Video and audio layers accept `timeRemap` with an explicit `durationFrames`. Map frames are layer-local; `sourceSec` is absolute source time. Increasing source times play forward; decreasing source times play in reverse; equal source times hold the picture and silence the audio. Rate changes also change audio pitch. Do not combine this with `trimStartSec`.

```ts
const clip = Layer.video("assets/clip.mp4", {
  durationFrames: 90,
  timeRemap: { kind: "keyframes", keyframes: [
    { frame: 0, sourceSec: 1, interpolation: "smooth" },
    { frame: 30, sourceSec: 2 }, { frame: 45, sourceSec: 2 },
    { frame: 90, sourceSec: 1 },
  ] },
});
comp.add(clip);
const vision = comp.vision(clip);
// Or: timeRemap: { kind: "rate", sourceStartSec: 3, rate: -0.5 }
```

A signal can drive the clock instead: `{ kind: "signal", mode: "speed", signal, sourceStartSec }` integrates playback rate (source seconds per second; negative reverses, 0 holds), and `mode: "source-time"` reads absolute source seconds. `signal` is a `Signal` or the name of a composition signal (`comp.addSignal`), read on the composition clock at every layer frame boundary and interpolated between them, so picture, audio and `comp.vision` share one clock.

```ts
const speed = Signal.state(1);
comp.onRequestFrame((ctx) => speed.set(ctx.frame < 48 ? 1 : 0.25));
comp.add(Layer.video("assets/clip.mp4", {
  durationFrames: 96,
  timeRemap: { kind: "signal", mode: "speed", signal: speed },
}));
```

Without frame hooks (`onRequestFrame`, `onPrepareFrame`, `comp.vision`, physics) the signal is sampled up front; with them it is recorded live, once per frame after its hooks, never ahead (seeks forward run skipped hooks, seeks back reuse history). A signal reading its own layer's source time is a circular dependency.

Keyframes start at 0, end at `durationFrames` and increase. `interpolation` (on a segment's first key): `"linear"` (default), `"ease-in"`, `"ease-out"`, `"smooth"`; all monotonic, no overshoot. `comp.vision(layer)` needs the layer added first and samples on the mapped clock; effects stay on the composition clock. Audio resamples (no pitch-preserving stretch). Reverse video seeks, so renders slower.

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

Until its first key a track holds that key's value, and after its last key the last: `keys("opacity", [[40, 0], [48, 1]])` keeps a layer hidden until frame 40, with no hold key at 0 needed. Keyframes past the layer's `durationFrames` never play; the render warns (`animation_truncated`) and `renderVideo({ qa: true })` reports it.

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

**Cube cameras.** `lens.projection`: `"perspective"` (default), `"equirectangular"` (360 × 180 for VR; `fov` ignored) or `"fisheye"` (equidistant; `fov` = full angle across the height, up to 360°). Non-perspective renders six 90° faces and remaps them (~6× cost); `lens.cubeSize` overrides the face size (default matches output sharpness, ≤ 4096).

**Relativity.** `relativity: { speed, direction?, doppler?, beaming?, exposure? }` films the scene from a camera moving at `speed` × c (0–0.9999) along `direction` (default: the view). Physical: aberration crowds the view forward, spectral Doppler shifts blue ahead and red behind, beaming brightens ahead. `exposure: "auto"` (default) meters the centre; a number is fixed stops (`0` = true, often blinding light). Animate `relativitySpeed`, e.g. `CameraAnimation.camera().fromTo("relativitySpeed", 0, 0.99, { start: 0, end: 90, ease: "expo.in" })`. A relativity camera is always a cube camera.

```typescript
Layer.camera({
  x: 0, y: -170, z: 0, targetX: 0, targetY: -170, targetZ: 1000,
  lens: { fov: 90 },
  relativity: { speed: 0.9 },
});
```

Cube cameras draw outlines, shadows, floor reflections, volumetric fog and bloom, but not depth of field, motion blur, SSR or GI (`lint` reports `camera_cube_dof`, `camera_cube_motion_blur`, `camera_cube_screen_space`; rendering throws). Their glass refracts only the 3D scene.

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

`.signal()` / `.colorSignal()` set the prop to `value × multiplier + offset` each frame. A signal object is registered automatically (as `inline_signal_N`, keeping the spec plain JSON); a string names a `comp.addSignal` signal; anything else throws. Signals sample the **composition** frame by default (needed for shared and audio signals); `{ clock: "layer" }` samples the layer's own frame, so per-scene motion plays right inside `Layer.sequence`.

`AudioSignal` (GPU; audio or video files): `extract(src, { fps })` gives `primary`, `beat`, `bass`, `energy`; `pitch(src, { fps, minHz, maxHz })` gives `hz` (interpolated over gaps), `confidence`, `voiced` and raw `samples`. Gaps in `voiced` mark gear shifts and note onsets; a 4-stroke engine's cycle pitch is RPM / 120.
```typescript
const engine = await AudioSignal.pitch("assets/onboard.mp4", { fps, minHz: 50, maxHz: 400 });
const rpm = engine.samples.hz.map((hz) => hz * 120);
const needle = LayerAnimation.create().signal("rotation", engine.hz, { multiplier: 1.2, offset: -120 });
```

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
Layer.shape("path", { position: "absolute", x: 0, y: 0, width: 400, height: 400, d: BLOB_A, fill: "#3B82F6" })
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

### Relief: footage as a 3D surface

`node.withRelief(heightLayer, { amount })` turns a 3D layer into a surface: the brightness of `heightLayer` (laid out and timed like a matte, drawn flat over the node's box) pushes it up to `amount` px toward the camera. It moves along the **default camera's** rays, so from that lens the surface is pixel for pixel the flat layer; move the camera and the footage has real parallax, takes the scene's lights, and hides 3D objects that pass behind its raised parts. With a video's own depth it puts the footage in the 3D scene:

```typescript
const plate = { position: "absolute", x: 0, y: 0, width: W, height: H, fit: "cover", muted: true } as const;
Layer.video("assets/table.mp4", { ...plate, is3D: true })
  .withRelief(Layer.video("assets/table.mp4", plate).withVision({ mode: "depth" }), { amount: 300 });
```

Where depth jumps (an object's outline) the surface stretches across with the edge pixels: footage never saw those sides. Keep camera moves within about 15° of the original lens, or hide the outlines.

---

### Motion blur (3D)

`Layer.camera({ ..., motionBlur: true })` (or `{ shutter: 180, samples: 20, maxBlur: 48 }`) streaks every mesh by its own motion plus the camera's: skinning, morphs, audio deformation, crowds, swarms, wind, fracture pieces, 3D cards and glyphs of 3D text. Seeks render identically. `shutter` in degrees (180 = film), `maxBlur` in px. A layer's `motionBlurShutter` streaks a flat layer by its position; use the camera's for 3D.

### Characters: blending, IK, look-at, springs, crowds

glTF characters (`Layer.glb` / `Layer.gltf`) take layered clips and procedural constraints. Joint names come from the file. Targets are scene coordinates: a point, keys `[[frame, x, y, z]]`, or `(frame) => [x, y, z]`.

```ts
const hero = Layer.glb("hero.glb", {
  x: 960, y: 900, z: 0, rotateX: 180, scale: 3,
  animationLayers: [
    { clip: "Walk" },
    { clip: "Run", weight: [[0, 0], [48, 1]] },             // crossfade walk → run
    { clip: "Wave", mask: ["Spine2"], weight: 0.8 },        // upper body only
  ],
  lookAt: [{ joint: "Head", target: (f) => [700 + f * 4, 600, -200], maxAngleDeg: 60 }],
  ik: [{ chain: ["UpperArm.R", "LowerArm.R", "Hand.R"], target: [1100, 650, -80], poleTarget: [1200, 800, 200] }],
  springBones: [{ joints: ["Tail1", "Cape"], stiffness: 4, damping: 0.6, gravity: [0, 980, 0] }],
});
// 3,000 walkers in one draw call per mesh, each at its own phase and speed:
const extras = Layer3D.scatter({
  surface: land, mesh: Layer.glb("walker.glb", { rotateX: 180, scale: 2 }), count: 3000, minDistance: 40,
  crowd: { clips: ["Walk", "Idle"], speedRange: [0.8, 1.2] },
});
```

**Joint drivers** (`drive`): `{ joint, from, rotate: { x?, y?, z? } }` turns a joint by a share of another joint's turn from its rest, per local axis, after look-ats and before IK: lids following eyes, twist bones sharing a forearm's roll, correctives. Model files can carry their own (in the scene's `extras.framefields.drivers`); a layer's `drive` adds to them.

**Posing joints directly** (`pose`, by joint name; namespace prefixes and case are ignored, so `"LeftArm"` finds `"mixamorig:LeftArm"`): local Euler degrees `rotateX/Y/Z` (Z, then Y, then X, like layers) and offsets `x/y/z`, on top of the clips (`mode: "additive"`, default) or of the rest pose (`"rest"`: clips stop moving that joint), with a `weight`. Every value is a track: a number, `[[frame, v]]` keys, `(frame) => v`, or a signal (audio, physics, vision, `Signal.*`), so a head can sway on a sine or flinch at a physics hit:

```ts
Layer.glb("hero.glb", {
  pose: {
    Head: { rotateY: Signal.sine({ min: -20, max: 20, period: 48 }) }, // a signal
    Neck: { rotateX: 30, weight: ball.impact },                     // flinch by a physics hit
    "LeftForeArm": { rotateZ: [[0, 0], [24, -70]], weight: 0.8 },   // keys
    Spine: { rotateY: (f) => 15 * Math.sin(f / 12), mode: "rest" }, // a function, over rest
  },
});
```

**Aiming and retargeting** (`aim`): `{ joint, direction }` turns a bone (toward its first child, or a local `axis`) along a scene direction, parents first; direction axes are tracks too (`[1, signal, 0]`). A performer's 2D pose drives a character with `person.retarget({ rig: "mixamo" | "humanoid" | "rigify" | { leftUpperArm: "…", … }, bones?, mirror?, minVisibility?, weight? })` on a placed vision person (or `retargetPose(source, options)` for any source with `point(name, frame)`):

```ts
const dancer = comp.vision("dance.mp4").person.place({ width: W, height: H, fit: "cover" });
Layer.glb("robot.glb", {
  x: dancer.signals("leftHip").x, y: dancer.signals("leftHip").y,   // root follows (signals)
  aim: dancer.retarget({ rig: "mixamo", bones: ["leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm"] }),
  animationLayers: [{ clip: "Walk" }],                              // legs keep walking
});
```

Order of evaluation: clips, `pose`, `aim`, `lookAt`, `ik` (so IK can still plant the feet), then springs. Retargeting is 2D: limbs swing in the plane facing the camera (no depth from one view); unsure keypoints (below `minVisibility`, default 0.3) hand their bone back to the animated pose. Use `mirror: true` for a character seen from behind. Functions and signals are in-process only; JSON keeps numbers and keys.

Rules: a crowd mesh keeps its own `rotateX` / `scale` under each instance (y-up glTF: `rotateX: 180`). Spring bones follow the clip and the model's orientation, not the layer's keyframed travel. Per-instance `clip`, `animOffset`, `animSpeed` in `transforms` / `instanceAt` override the crowd's seeded choices.

**Morph targets by name** (`morphs`, case-insensitive): a number, keys or a signal each; unnamed targets keep the clip's weights.

```ts
Layer.glb("head.glb", { morphs: { jawOpen: [[0, 0], [12, 0.6]], mouthSmileLeft: 0.8, eyeBlinkLeft: blink } });
```

### Procedural worlds: terrain, sculptures, scatter

Terrain, SDF sculptures and scatters are ordinary model nodes: they take materials, lights, shadows, SSR/GI, physics, keyframes and a `texture` that can be any layer (an image path, `Layer.video`, a layout tree) drawn fresh each frame.

```ts
const land = Layer3D.terrain({
  x: 960, y: 900, z: 0, width: 4000, depth: 4000, height: 600,
  noise: { seed: 3, ridgeMode: "ridged" },
  colorByElevation: { lowColor: "#3d6b2a", midColor: "#7a6a4f", highColor: "#f4f4f4", cliffColor: "#5a5048" },
});
const pines = Layer3D.scatter({
  surface: land, mesh: [Layer.gltf("pine.glb"), Layer3D.capsule({ radius: 8, length: 60, color: "#2f5d2a" })],
  count: 800, minDistance: 60, slopeRange: [0, 30], elevationRange: [0.05, 0.6],
  exclude: [{ x: 960, z: 0, radius: 300, falloff: 120 }], wind: { amplitudeDeg: 6 },
});
// Stand any layer on the ground: a video screen in the clearing.
const screen = Layer3D.plane({ x: 960, y: land.heightAt(960, 0) - 160, z: 0, width: 480, height: 270, children: [Layer.video("clip.mp4", { width: 480, height: 270 })] });
```

Rules: the terrain's y is its valley floor, peaks rise `height` px above it (up is -y); `heightAt` follows the node's position and scale but not its rotation. Scatter reads the surface's static transform, so don't keyframe the surface. Make a terrain or sculpture `type: "fixed"` in `Physics.world3d` for exact-triangle collisions. `lint()` warns when `slopeRange` / `elevationRange` reject the whole surface.

## Scenes & Transitions

`Layer.sequence` places full-frame scenes end to end, overlapping each pair by its transition, and writes the scenes' `startFrame` / `durationFrames` for you (each scene keys from its own frame 0). Transitions are ordinary keyframes and mattes merged into the scenes.

**3D scenes:** a box with a fixed `width`/`height` that holds a `Layer.camera` and the layers it films is a 3D scene of its own (a box holding only a camera stays a shot in a camera cut list over the shared world): its camera, lights and environment see only its layers, it renders on its own clock, and the box is placed like a picture. So a crossfade, whip or iris between two 3D scenes blends two finished pictures, each through its own camera. Give layer ids a per-scene prefix when the same scene code builds several scenes (`comp.lint()` reports `duplicate_id`).

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
    volumetricFog: { density: 0.025, anisotropy: 0.6, noise: { strength: 0.4, speed: [18, -6, 10] } }, // participating medium + god rays
    bloom: true,                       // or { intensity: 0.3, threshold: 1.6, radius: 6 }
    floor: { y: 200, color: "#111115", reflectivity: 0.8, roughness: 0.25, fadeDistance: 800 }, // glossy floor reflection
    ssr: true,                         // screen-space reflections on glossy surfaces
    gi: { intensity: 1.2 },            // contact occlusion + one bounce of visible light
  }),
  Layer.directionalLight({ x: 400, y: -1200, z: -600, targetX: 960, targetY: 540, castShadow: true }),
  Layer.rectLight({ x: 960, y: -300, z: -400, targetX: 960, targetY: 540, width: 320, height: 140, intensity: 2, castShadow: true }),
]);

Layer3D.sphere({ radius: 90, color: "#e8e8e8", metallic: 1, roughness: 0.15 });  // chrome
Layer3D.roundedBox({ ..., color: "#ff5a1f", roughness: 0.45 });                  // satin plastic
Layer3D.cylinder({ ..., height: 400, color: "#111", emissive: "#4da3ff", emissiveIntensity: 3 }); // neon tube
```

- **Tone mapping `"neutral"` (default) keeps brand colors as authored**: orange stays orange. Use `"agx"` for a filmic roll-off.
- **Bloom only takes light well past white** (emissive ≳ 3, hot speculars), so ordinary bright surfaces don't glow. Raise `emissiveIntensity` to make something glow.
- **Shadows:** `directional`, `spot`, `rect` (`Layer.rectLight` / `Light.rect`), and omnidirectional `point` (`Layer.pointLight` / `Light.point`, 6-face cube shadow map) lights can each cast shadows, subject to device texture-array limits. Meshes cast by default (`castShadow: false` opts out); flat layers (planes, cards) cast only with `castShadow: true`. Everything receives.
- **Rect lights** (`Layer.rectLight` / `Light.rect`): softboxes and LED panels; `width`, `height`, `twoSided`, `rotation`, position/target, `intensity`, `radius`, `decay`, `castShadow`. Numeric light props take `Signal`s (`intensity: bass`).
- **Volumetric fog** (`volumetricFog: true | { density, anisotropy, heightFalloff, baseHeight, color, lightIntensity, ambientIntensity, maxDistance, steps, noise: { scale, strength, speed, octaves } }`): half-res raymarched medium; every shadow-casting light carves god rays. `density`, `anisotropy`, `noise.strength` take signals.
- **Model files bring their own lobes:** glTF `KHR_materials_clearcoat`, `_sheen`, `_anisotropy`, `_iridescence`, `_transmission` (glass, with `_ior`; `_volume` thickness scales the bend) and `extras.framefields.subsurface`; layer props override them. Subsurface wraps light past the terminator per channel (`subsurfaceColor`, e.g. `"#ff5a3c"` for skin); thin parts glow back-lit.
- **Substrate lobes (need an environment):** every `Layer3D.*` mesh, `Layer.model` and 3D card accepts `clearcoat` / `clearcoatRoughness` (car paint, lacquer), `anisotropy` (-1..1) / `anisotropyRotation` (deg; brushed metal), `subsurface` / `subsurfaceColor` (wax, jade, skin), `sheen` / `sheenColor` / `sheenRoughness` (velvet, cloth), `iridescence` (0..1 or `{ intensity, thickness, ior }`; soap, oil, beetle shell) with `iridescenceThickness` (nm) / `iridescenceIor`, and `triplanar: true | { scale, sharpness }` for world-space textures on UV-less meshes. Numeric lobes take numbers or live `Signal`s (`clearcoat: bass`). Example: `Layer3D.sphere({ radius: 90, color: "#8a0f1c", metallic: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 })`.
- **HDRI environments:** pass a `.hdr` or `.exr` path instead of a preset: `Layer.environment("assets/hdri/studio.exr", { intensity: 1.2, rotation: 90 })` (or `{ hdri: path }`). The panorama lights and reflects every physical surface; preset names keep working; relative paths resolve from the working directory. EXR files must use lossless compression (NONE, RLE, ZIPS, ZIP, PIZ or PXR24); re-save B44/DWA files as ZIP.
- **Screen-space reflections & GI (`ssr`, `gi`):** `Layer.environment("night", { ssr: true, gi: true })`. `ssr` (`{ intensity, maxRoughness, thickness, steps }`) reflects nearby geometry and emissives in glossy surfaces: chrome, wet floors, lacquer, walls. `gi` (`{ intensity, radius, samples }`) adds contact occlusion and color bleeding from visible surfaces, e.g. a neon sign tinting the floor. Each costs a second 3D pass; only what is on screen can be reflected or bounce, so keep key reflected objects in frame. Use `floor` for a planar mirror that also shows off-screen objects.
- **Toon:** `material: "toon"` on meshes, 3D cards and 3D text; `toon: { shadowColor (#80808c), lightColor (white), threshold (0.075), softness (0.25), diffuse (0 flat … 1 Lambert) }`. Uses every scene light and real shadows; exposure, tone mapping, fog and bloom still apply. Lower `threshold` wraps light further.
- **Ink outlines:** `outlines: true | { color, width, referenceHeight: 1080, creaseAngle: 45, depthThreshold: 0.01, opacity }` on the environment. `width` is px at `referenceHeight` (start near 1). Ink comes from depth and normals (textures and shadows get none; `creaseAngle: 180` = silhouettes only). `outline: false` on a layer excludes it but keeps it occluding. Ink runs before depth blur and bloom. `Layer3D.cube` faces inherit the cube's `toon`, `outline`, emissive and shadow settings. Distinct from the 2D `Toon` effect.
- **3D pivots:** `anchorX/Y` choose the point held fixed during scale/rotation; changing an anchor at identity transform leaves the layer in place. Use `anchorY: 1` to keep a character's feet planted while scaling.
- **Fog** fades to `fog.color` exactly, so set it to the composition background for a seamless horizon.
- **Models:** glTF base color, normal, metallic-roughness, occlusion and emissive maps (own UV sets, samplers, `KHR_texture_transform`); OBJ (`map_Kd`, `norm`) and FBX diffuse and normal maps. PNG, JPEG, WebP, GIF, TIFF, AVIF, KTX2 (Basis); TGA, PSD, DDS are skipped with a warning. Draco and meshopt decode. Morphs run on the GPU before skinning and sparse targets stay sparse (hundreds of correctives fit); skins take up to eight influences (`JOINTS_1` / `WEIGHTS_1`). Unknown required extensions fail clearly. Vertex colors multiply the base color.
- **Model orientation:** the world is y-down, so a y-up model (most glTF, OBJ and FBX files) needs `rotateX: 180` to stand upright.
- **Reflective floor:** `floor: { y, color, reflectivity, roughness, fadeDistance, opacity }` mirrors the scene; `roughness` blurs the reflection, which also fades with distance and strengthens at grazing angles.
- `emissive` / `emissiveIntensity` / `exposure` animate like any prop (`.keys("emissiveIntensity", …)`).
- **Transparent meshes** (glTF `BLEND`, reduced opacity) draw after opaque ones, sorted back to front by bounds center; intersecting meshes may mis-sort.
- **Glass:** `material: "glass" | "acrylic" | "frosted"` on any Layer3D solid, `Layer3D.extrudedText` or model refracts what's behind it (3D objects, video, 2D layers, particles; not other glass) with `dispersion` (0.04), `thickness` (px, 80), `ior` (1.5); `color` tints toward the edges, `frosted` blurs by `roughness`. It needs no environment and reads best on a dark grade; skip `Lighting.*` rigs for glass-only scenes.

---

## Physics (`Physics.world2d` / `Physics.world3d`)

For things that *fall, bounce, stack, swing or collide* (dropped words, tumbling UI, springs, dominoes, 3D products); keyframes for exact designed poses. A world runs **once** at build time (Rapier, deterministic on every machine) and replays as per-frame signals, so frames render in any order. `simulate()` binds each body's layer (`x`, `y`, `rotation`; 3D `x/y/z`, `rotateX/Y/Z`):

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
- **Performers in the simulation:** with `const dancer = comp.vision("dancer.mp4")` (`framefields-vision`), call `world.live(comp)` instead of `simulate()`: the world steps as frames render, each after that frame's vision, so the preview starts at once and the export is identical. With `const person = dancer.person.place({ width: W, height: H, fit: "cover" })`:
  - limbs as kinematic colliders that catch and bat things: `world.body({ x, y, width: 2 * r, height: 2 * r }, { type: "kinematic", shape: "circle", follow: { x: (f) => person.point("leftWrist", f).x - r, y: (f) => person.point("leftWrist", f).y - r } })`, a few balls along each shoulder → elbow → wrist;
  - the silhouette (dress included) as a force field: `person.sample(frame, x, y)` returns `alpha` (inside > 0.5) and a gradient `gx`, `gy` pointing inward, so `world.field((s) => { const m = person.sample(s.frame, s.x, s.y); … return [-m.gx * k, -m.gy * k]; })` makes particles and props flow around a moving body.
  - Reads are synchronous and need the frame analysed: inside a live world, while rendering, or after `await dancer.ready(frame)` (e.g. `ready(0)` to lay things out around the first pose). A live world can't look ahead, so place things from early frames.
  - Layer a vision cutout of the same clip (`Layer.video(src).withVision({ mode: "matte" })`) above the particles so they pass behind the performer.
  - Live worlds bind signals only (no `bakeKeyframes()`); `await world.advanceTo(frame)` steps one without rendering (e.g. to read `collisions`).
- **Particles:** for clouds, dust, sparks, fluids and flow fields use `Layer.particles` (GPU, below), not hundreds of physics bodies. Keep physics bodies for a few dozen things that must collide and stack (cards, letters, products).
- **Keyframes instead of signals:** `world.bakeKeyframes({ tolerance: 0.25 })` in place of `simulate()` writes plain, simplified linear keyframes (editable, plain JSON).
- **3D:** `Physics.world3d` takes `Layer3D` solids (`roundedBox`, `sphere`, `cylinder`, `capsule`, `torus`, `ring`, `prism`, `pyramid`, `polyhedron`, `icosahedron`, `icosphere`, `shard`) and models (convex hull of the mesh); same options with 3-vectors, `world.hinge(a, b, at, axis)`, `world.walls({ width, height, depth })`. Use `Layer3D.instances({ count: bodies.length, mesh: Layer3D.shard({ radius: 24 }), bodies, emissiveBySpeed: { speedThreshold: 200, maxSpeed: 1200, color: "#ff5511", intensity: 4 } })` to render hundreds of physics bodies in a single GPU draw call.
- **Destruction:** `const broken = world.fracture(statue, { cells: 48, impactPoint: [x, y, z], fractureFrame: "onImpact" | frame, explosionSpeed: 300, interiorColor: "#e9dcc0" })` cuts a `Layer3D` solid, extruded text or model (with `modelData`) into Voronoi pieces. It looks whole (a fixed collider of its own shape) until the frame or the first body that hits it, which carries on through, then the pieces fall as rigid bodies (`broken.pieces`, `broken.frame` after simulating). The node changes in place: add it as usual. One draw call per material; pieces crowd around `impactPoint`. An animated layer (position, rotation) collides along its path while whole and breaks where it is, its pieces carrying its motion; inside a 3D group the pieces fly in the group's space, like other bodies. Its scale must not animate (rigid pieces). Needs `simulate()` (not `live()`).
- **Timing:** signals are on the clock of the composition that reads them. In a flat scene that starts at frame `S`, pass `startFrame: S` to the world. A 3D scene box (a box holding its own `Layer.camera`) renders on its own clock, so a world for its bodies starts at the scene's frame 0 (no `startFrame`). Before it and after `frames` the signals hold their first/last value. Add every body, joint and force before `simulate()` (or before reading any signal): the world then locks.
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
- For 3D debris, tumbling rocks, and glowing sparks interacting with a floor plane and 3D vortex forces, use `Layer3D.swarm` to simulate and render polyhedral shards directly on the GPU.

---

## Custom Shaders (`Layer.shader`)

When no layer or effect draws what you need (ray marching, a simulation, a procedural field), write the fragment yourself. `fragment` is WGSL that defines `shade`; the layer supplies the vertex stage and a uniform block `u`:

```typescript
Layer.shader({
  width: W, height: H,                       // x, y, id, startFrame, durationFrames, zIndex as usual
  uniforms: { zoom: 2, pulse: kick, sweep: (ctx) => ctx.frame / 90 },  // number | Signal | (ctx) => number
  fragment: `
fn shade(uv : vec2<f32>) -> vec4<f32> {     // uv: 0,0 top-left → 1,1 bottom-right
  let p = (uv - 0.5) * vec2<f32>(u.resolution.x / u.resolution.y, 1.0) * u.zoom;
  let ring = smoothstep(0.02, 0.0, abs(length(p) - 0.3 - 0.1 * u.pulse));
  return vec4<f32>(vec3<f32>(ring) * u.sweep, 1.0);   // premultiplied RGBA
}`,
});
```

- `u.time` is seconds since the layer started, `u.frame` its frame, `u.resolution` its size in px; every entry of `uniforms` is one `f32` read as `u.<name>` (signals and functions are sampled at the composition frame).
- Return premultiplied color in display space (apply your own tone mapping and gamma); alpha below 1 lets layers underneath show.
- A fragment that does not compile throws with line numbers counted in your own source.
- It is a media layer: animate `opacity`, position it, add effects, use it as a matte. `examples/41_hawking_radiation` ray traces a black hole this way.

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
4. **Register every font** with `FontManager.register()` before building text: there are no system fonts. Emoji need `FontManager.registerEmojiFont("assets/fonts/NotoColorEmoji.ttf")` (CBDT/CBLC) or draw nothing.
5. **Integer Frames Only:** Keyframe frames, start frames, and durations must be integers. Decimal frames cause schema validation errors.
6. **`x`/`y` mean absolute:** a node with `x` or `y` and no `position` is absolutely positioned (out of flex flow), relative to its parent's content box.
7. **Audio Layer Duration:** Every `Layer.audio()` must be assigned `durationFrames` to prevent audio truncation in headless rendering.
8. **Lint before rendering:** `comp.lint()` lists colors/gradients that would draw transparent, low-contrast text, off-canvas layers, shadow settings that do nothing and `roughness`/`metallic` without an environment. `renderVideo({ qa: true })` includes these findings.
9. **Lottie vs. Image Layers:** Use `Layer.lottie("file.json" | "file.lottie", { width, height, fit })` for Lottie vector animations. Never pass `.json` or `.lottie` to `Layer.image()`, which only decodes raster formats and throws/warns if given a vector animation.
10. **AI media are assets, not build steps:** generate with `ai` once in a separate script into `assets/generated/` (`framefields` skill); never call it from `buildFilm()` or a scene.
11. **Zoomed flat layers stay sharp:** text, shapes, images and SVGs rasterize at their on-canvas scale (≤ 4×). A leaf stays at layout resolution (softens when magnified) if it is 3D, deflickered, media with `effects`/`crop`, or carries an effect other than `LayerStyle` or Gaussian/box `Blur`.
