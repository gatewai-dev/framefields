---
name: gitframes-effects
description: Apply, configure, and modulate WebGPU post-processing shaders, cinematic color grading, tone mapping, procedural VFX, and YOLO neural vision conditioning in gitframes. Use when adding blur, grain, LUTs, relighting, curves, greenscreen color keying, or subject segmentation in gitframes compositions.
---

# gitframes-effects

## Overview
`gitframes` features a native WebGPU shader execution pipeline for 2D VFX, tonal grading, cinematic lens simulation, spatial relighting, and real-time neural vision conditioning.

Effects in gitframes are strongly typed `Effect` subclasses whose uniform properties can be driven by static values, time-varying keyframes, reactive `Signal` instances, or audio extraction pipelines.

See [references/effects-catalog.md](references/effects-catalog.md) for the generated prop-level catalog, defaults, and type bounds.

---

## Attaching Effects

There are 4 main attachment modes in the engine:

### 1. Layer-Level Effect Pipeline
Attach one or more effects to an individual media, box, or text layer:
```typescript
import { Layer, Curves, Vignette, Blur } from "gitframes";

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
import { Composition, FilmGrain, ColorBalance } from "gitframes";

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
import { Media, ApplyLUT, Crop } from "gitframes";

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

### 3. 3D Spatial Lighting & Materials
- **`Relight3D`**: Screen-space normal map relighting with point, spot, and directional lights, specular highlights, roughness, and metallic uniforms.
- **`SSAO`**: Screen-space ambient occlusion generating contact shadows from depth buffers.
- **`PBRGlass`**: Physically-based transmission, index of refraction (IOR), optical dispersion, and Fresnel reflections.
- **`DepthOfField`**: Camera lens simulation with aperture size, focal length, focus plane distance, and circle-of-confusion (CoC) blur.

### 4. Matte, Keying & Edge Operations
- **`ColorKey`**: Studio greenscreen/bluescreen keyer with spill suppression and smoothness controls.
- **`Crop`**: Rectangular, circular, or arbitrary polygon path cropping with corner rounding.

---

## YOLO11 Neural Vision Conditioning

`gitframes` integrates native WebGPU YOLO11 neural conditioning directly into the rendering pipeline. Models are downloaded and loaded lazily upon first invocation.

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
Smoothly reframes landscape video into vertical shorts by tracking the focal subject with virtual camera damping:
```typescript
comp.addSmartFraming({
  source: "assets/action.mp4",
  targetAspect: 9 / 16,
  damping: 0.15,
  leadHeadroom: 0.1
});
```

### 3. Subject Outline Glow & Neon Pulse
Strokes the segmented subject boundary with an audio-reactive contour glow:
```typescript
comp.addSubjectOutline({
  source: "assets/character.mp4",
  color: "#FF5A1F",
  width: 6,
  blur: 12
});
```

### 4. Tracked Region Blur
Automatically blurs faces, license plates, or specific detected classes:
```typescript
const runner = await comp.analyzeVisionSequence("assets/street.mp4", {
  tasks: ["detect"],
  categories: ["person"]
});

// Primary detected track automatically blurred
const primaryTrack = runner.tracks[0];
layer.blurRegion(primaryTrack, { strength: 30 });
```

---

## Reactive Signal Modulation

Uniforms on any `Effect` accept reactive `Signal` instances instead of static values. When the signal changes, the GPU uniform buffer updates automatically without rebuilding the pipeline:

```typescript
import { Layer, Blur, sineSignal, computed } from "gitframes";

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
