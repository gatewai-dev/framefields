---
name: framefields-effects
description: Apply, configure, and modulate WebGPU post-processing shaders, stylized looks (pixel art, ASCII, VHS, comic, watercolor, risograph, holographic — and which look fits which request), cinematic color grading, tone mapping, and procedural VFX in framefields. Use when adding blur, grain, LUTs, relighting, curves, greenscreen color keying, or effects driven by vision signals in framefields compositions; detection, cutouts, pose and SAM tracking themselves are in framefields-vision.
---

# framefields-effects

Effects are typed `Effect` classes imported from [`framefields`](https://www.npmjs.com/package/framefields) (grading, lens, texture, stylize, keying, temporal). Every prop takes a value or a `Signal`. No project yet: see the `framefields` skill.

**Look every prop up in [references/effects-catalog.md](references/effects-catalog.md) before setting it** (generated: every class, prop, default and range). Scales differ per effect, and a value on the wrong scale renders as nothing, without an error.

## Attaching effects

```typescript
import { ApplyLUT, Blur, Crop, Curves, FilmGrain, Layer, Media, Vignette } from "framefields";

// 1. A layer (box, flex, shape, text, media): withEffect / withEffects
Layer.video("assets/footage.mp4", { fit: "cover" })
  .withEffect(new Curves({ master: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.52 }, { x: 1, y: 0.95 }] }))
  .withEffect(new Vignette({ strength: 40, radius: 0.85, softness: 0.6 }));

// 2. The whole composition
comp.apply(new FilmGrain({ strength: 18, size: 1.5, monochrome: true }));

// 3. A region (rectangle or tracked object) of a plate
comp.section({ source: "assets/interview.mp4", x: 400, y: 200, width: 300, height: 300, borderRadius: 150,
  effects: [new Blur({ strength: 25, blurType: "Gaussian" })] });

// 4. A clip outside the layout tree
const clip = Media.video("assets/raw_log.mp4")
  .apply(new ApplyLUT({ lutUrl: "assets/luts/cinematic.cube", intensity: 1 }))
  .apply(new Crop({ cropType: "rect", topPercentage: 10, heightPercentage: 80 }));
await clip.renderFrame({ atMs: 1500 });
```

## Effects

### Grading
- **`Curves`**: master/RGB tone curves plus hue and saturation curves (`hueVsHue`, `hueVsSat`, `lumVsSat`, `satVsSat`).
- **`ColorBalance`**: shadows/midtones/highlights shifts, `preserveLuminosity`.
- **`Levels`**: black/white points and gamma, master or per channel.
- **`SelectiveColor`**: CMYK-style adjustments per color range (reds … blacks).
- **`GradientMap`**: gradient remap (`stops: [{ position: 0, color: "#000" }, { position: 1, color: "#FFF" }]`).
- **`ShadowsHighlights`**: shadow lift and highlight recovery.
- **`ApplyLUT`**: 1D/3D `.cube` LUTs.
- **`Modulate`**: `hue`, `brightness`, `contrast`, `exposure`, `saturation`, `sepia`.

### Optics and texture
- **`FilmGrain`**: grain with size, tonal masking, animation speed.
- **`Vignette`**: lens falloff: center, roundness, softness.
- **`Blur`**: `"Gaussian"`, `"Box"`, `"Median"`, `"Motion"`, `"Bilateral"`, `"Edge-preserving"`, `"Radial"`, `"Zoom"`; partial regions and tracked boxes.
- **`UnsharpMask`**: sharpen with threshold.
- **`HighPass`**: frequency isolation.
- **`HalftoneScreen`**: print screen: `"Circle"`, `"Diamond"`, `"Line"`, or `"Square"` dots in `"Monochrome"` or `"CMYK"` angles.
- **`TileOffset`**: UV wrap: `"wrap"`, `"clamp"`, `"mirror"`, or `"transparent"`.
- **`MotionBlur`**: directional shutter blur.
- **`TemporalDeflicker`**: optical-flow blend that removes flicker (AI clips, high-speed footage).

### Temporal (with memory)
- **`Trails`**: the layer over a decaying copy of its own past. `mode: "blend"` (default; echoes on full-frame footage), `"over"` (cutouts and text), `"add"` (light painting on dark scenes), `"max"` (light trails). `decay` 0.8 short echo → 0.97 long trails; per-frame `zoom` (1.02 = tunnel), `rotation`, `offsetX/Y`, `hueShift` (psychedelic cycling).
- **`Datamosh`**: the previous picture dragged along the new frame's optical flow instead of being refreshed, until a `keyframes` frame (I-frame) shows the clean picture. Put keyframes where you want it clean; leave a cut out to smear one shot with the next one's motion. `strength`, `bleed` (clean picture mixed back per frame).
- Both step as frames render; after a jump (scrubbing, a single `renderFrame`) they replay the last frames (`warmup`) to rebuild the history.

### Screen-space 3D
- **`Relight3D`**: screen-space normal relighting (point, spot, directional).
- **`SSAO`**: contact shadows from depth.
- **`PBRGlass`**: refraction, IOR, dispersion, Fresnel.
- **`DepthOfField`**: aperture, focal length, focus distance.

### Keying and crop
- **`ColorKey`**: green/bluescreen keyer with spill suppression.
- **`Crop`**: `cropType: "rect"` (percent edges, `roundness` for rounded or circular corners) or `"path"` (`pathPoints` polygon); `mode: "rest"` keeps the outside instead.

### Stylized looks (`Styles.*`)

**When someone names a style** ("VHS", "8-bit", "comic", "liquid logo"), read [references/style-guide.md](references/style-guide.md): it maps requests to presets, effects and techniques.

`Styles.<name>(options?)` returns an effect stack: `layer.withEffects(Styles.vhs())`. Presets: `pixelArt`, `gameBoy`, `teletext`, `ledWall`, `ascii`, `oneBit`, `risograph`, `comic`, `cartoon`, `thermal`, `vhs`, `crt`, `glitch`, `oilPainting`, `watercolor`, `topographic`, `kaleidoscope`, `opArt`, `holographic`, `noir`, `film`.

The effects behind them, for finer control:
- **`Pixelate`**: big pixels; `shape: "square" | "circle" | "diamond"` (LED wall), `gap`.
- **`Posterize`**: fewer colors, or snap to a `palette` (`gameboy`, `teletext`, `cga`, `pico8`, `c64`, `grayscale`, `sepia`, `custom` + `colors`) with Bayer `dither` and `pixelSize`.
- **`Dither`**: `bayer` / `noise` / `halftone`; 1-bit duotone (`dark` / `light`) or per-channel `levels`.
- **`Ascii`**: glyphs by brightness; `colorMode: "mono" | "source" | "green"`, `cellSize`, `fg` / `bg`, `invert`.
- **`Toon`**: brightness bands plus Sobel ink lines (`edgeColor`, `edgeWidth`, `edgeThreshold`).
- **3D ink and cel shading** are scene features, not this image effect: `Layer.environment(..., { outlines })` and `material: "toon"` (see `framefields-compose`, *3D Look*).
- **`RGBSplit`**: chromatic aberration along `angle` or `radial`.
- **`CRT`**: curvature, scanlines, aperture mask, noise, flicker, vignette; `tracking` and `chroma` give VHS wobble and colour bleed.
- **`Painterly`**: Kuwahara `oil` / `watercolor` (pigment edges, paper grain).
- **`Contour`**: topographic isolines over the `source`, a `flat` paper colour, or nothing.
- **`Kaleidoscope`**: mirror `segments` around a center; animate `rotation` / `zoom`.
- **`OpArt`**: stripes / rings / checker / waves bent and thickened by the image.
- **`Iridescence`**: thin-film rainbow from brightness or relief; animate `shift`.
- **`Gooey`**: blur + alpha threshold (metaballs). Use it on layers with transparency (SVG, particles), not on opaque footage.

---

## Signals and vision

Any numeric prop takes a `Signal` sampled every frame: audio envelopes, physics impacts, vision bounds, `sineSignal({ frequency: 0.5, min: 0, max: 20 })`. Detection, cutouts, pose and SAM tracking live in `framefields-vision`; effects consume their signals, e.g. `layer.blurRegion(vision.objects.byCategory("person"))` or a uniform driven by `clip.signals.objects.get(1).bounds`.

## Rules of thumb

1. **Check the scale in the catalog.** `FilmGrain` and `Vignette` `strength` run 0–100 (defaults 15 and 50), `Blur` `strength` 0–100, while `Blur` `radius` is the 0–1 size of a *partial* blur region.
2. **Restraint:** `FilmGrain` around 10–25, `Vignette` 25–45.
3. **Order:** tonal grading (`Curves`, `ColorBalance`) before optics (`Blur`, `DepthOfField`); grain outermost.
4. **Stills:** `animated: false` on `FilmGrain` keeps grain fixed on a held image.
