---
name: framefields-effects
description: Apply, configure, and modulate WebGPU post-processing shaders, stylized looks (pixel art, ASCII, VHS, comic, watercolor, risograph, holographic — and which look fits which request), cinematic color grading, tone mapping, and procedural VFX in framefields. Use when adding blur, grain, LUTs, relighting, curves, greenscreen color keying, or effects driven by vision signals in framefields compositions; detection, cutouts, pose and SAM tracking themselves are in framefields-vision.
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
Attach one or more effects to any layer (`box`, `flex`, `shape`, `text`, `media`) directly via `.withEffect(effect)` or `.withEffects([...])`:

```typescript
import { Layer, Curves, Vignette, Blur, Pixelate } from "framefields";

// Media layer with color grade and lens effects
const videoLayer = Layer.video("assets/footage.mp4", { fit: "cover" })
  .withEffect(new Curves({
    master: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.52 }, { x: 1, y: 0.95 }]
  }))
  .withEffect(new Vignette({ strength: 0.4, radius: 0.85, softness: 0.6 }))
  .withEffect(new Blur({ strength: 8, blurType: "Gaussian" }));

// Styled container box with blur
const cardLayer = Layer.box({ width: 400, height: 300, background: "#1e1e24" })
  .withEffect(new Blur({ radius: 12 }));

// Kinetic text with pixelation
const titleLayer = Layer.text("CYBERPUNK", { fontSize: 72 })
  .withEffect(new Pixelate({ size: 8 }));
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

## Vision-driven effects

Cutouts, subject mattes, tracked boxes, pose, smart re-framing, subject outlines, tracked region blur, and prompted tracking of a specific person or several people (SAM 2.1 / SAM 3) live in the `framefields-vision` skill. Effects here consume its signals: for example `layer.blurRegion(vision.objects.byCategory("person"))`, or an effect uniform driven by `clip.signals.objects.get(1).bounds`.

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
