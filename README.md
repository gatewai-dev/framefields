# Gitframes

> **High-Performance WebGPU Rendering Engine & SDK for Programmatic Video, Motion Graphics, Audio DSP, and Neural Conditioning.**

Gitframes is a code-first video composition engine built directly on native WebGPU and modern JavaScript Signals. It brings Photoshop-grade 2D image processing, After Effects-grade kinetic typography, unified 3D spatial camera motion, procedural audio DSP, and real-time neural vision pipelines into a single, deterministic rendering pipeline.

Unlike browser-dependent frameworks that run inside headless Chromium, Gitframes executes directly on GPU hardware via Dawn / WebGPU / Vulkan / Metal in Node.js and in modern WebGPU-enabled browsers—delivering 60–120 FPS rendering speeds with a tiny resource footprint.

> **Using an AI coding agent?** Install the gitframes skills in **Claude Code** with `/plugin marketplace add gatewai-dev/gitframes` → `/plugin install gitframes@gitframes-plugins`, or in **Codex** with `codex plugin marketplace add gatewai-dev/gitframes`. See [Agent Skills & Plugins](#agent-skills--plugins).

---

## Table of Contents

- [Core Value Proposition](#core-value-proposition)
- [Architectural Comparison: Gitframes vs. Remotion vs. Hyperframes](#architectural-comparison-gitframes-vs-remotion-vs-hyperframes)
  - [Detailed Comparison Matrix](#detailed-comparison-matrix)
  - [Why Gitframes? Deep Architectural Analysis](#why-gitframes-deep-architectural-analysis)
- [Key Features & Capabilities](#key-features--capabilities)
  - [1. Slug GPU Vector Typography & AE Parity](#1-slug-gpu-vector-typography--ae-parity)
  - [2. Photoshop-Grade WebGPU 2D VFX (50+ Shaders)](#2-photoshop-grade-webgpu-2d-vfx-50-shaders)
  - [3. Unified 3D Scene Graph, Camera & Mesh Shading](#3-unified-3d-scene-graph-camera--mesh-shading)
  - [4. Audio Layers, Procedural SFX & Reactive Signals](#4-audio-layers-procedural-sfx--reactive-signals)
  - [5. WebGPU ChartGPU Bridge](#5-webgpu-chartgpu-bridge)
  - [6. Neural Tensor & MediaPipe AI Conditioning](#6-neural-tensor--mediapipe-ai-conditioning)
  - [7. Headless Conformance & FrameGrid Testing](#7-headless-conformance--framegrid-testing)
- [Monorepo Architecture](#monorepo-architecture)
- [Quickstart Guide](#quickstart-guide)
  - [Installation](#installation)
  - [1. Basic Composition & Kinetic Auto-Layout](#1-basic-composition--kinetic-auto-layout)
  - [2. Unified 3D Scene with Camera & 3D Model](#2-unified-3d-scene-with-camera--3d-model)
  - [3. Audio Soundtrack, Procedural SFX & Reactive Signals](#3-audio-soundtrack-procedural-sfx--reactive-signals)
  - [4. Chained WebGPU Post-Processing VFX](#4-chained-webgpu-post-processing-vfx)
  - [5. Headless Video & FrameGrid Rendering](#5-headless-video--framegrid-rendering)
- [Engineering Doctrines & Best Practices](#engineering-doctrines--best-practices)
- [Agent Skills & Plugins](#agent-skills--plugins)
  - [Claude Code](#claude-code)
  - [Codex](#codex)
  - [Any other agent (skills only)](#any-other-agent-skills-only)
- [Reference Showcase Examples](#reference-showcase-examples)
- [Development & Building](#development--building)

---

## Core Value Proposition

Modern automated video generation workflows are often constrained by the architectures of general-purpose web browsers: heavy process overhead, non-deterministic DOM layout reflows, and slow screenshot capture bottlenecks. Gitframes treats **video composition as pure software engineering**:

1. **Zero Headless Browser Overhead**: Eliminates Puppeteer, Chromium IPC serialization, and `page.screenshot()` transfers. Gitframes connects directly to native GPU devices via Dawn (`webgpu`) in Node.js and `@napi-rs/webcodecs` hardware encoding.
2. **Deterministic Frame-Accurate Clock**: Compositions run against absolute frame clocks, discrete sample points, and frame-accurate audio BeatGrids. No floating timers, drift, or dropped frames.
3. **Analytic Resolution-Independent Typography**: Powered by the Slug algorithm in WebGPU WGSL shaders. Glyph contours are mathematically evaluated on the GPU per-pixel without texture atlases, memory bloat, or scaling artifacts.
4. **Photoshop-Grade Tonal & Spatial VFX**: 50+ modular GPU shader operations including Curves, Levels, Selective Color, 3D LUTs, Halftone Screens, Film Grain, Unsharp Mask, Mesh Warping, and Screen-Space Relighting.
5. **Unified 3D & 2D Depth Compositing**: Seamlessly nest 2D flex/box layout trees inside 3D homography planes, multiplane camera rigs, 3D meshes (OBJ, FBX, glTF/GLB, STL, PLY, VOX, 3DS, OFF), PBR glass refraction, and SSAO contact shadows.
6. **Built-in Procedural Audio DSP**: Renders multi-track soundtracks, deterministic procedural transition effects (whoosh, impact, riser), and drives visual keyframes reactively.
7. **Cloud-Native & CI/CD Ready**: Extremely low RAM usage (~200–400 MB per worker vs. 2–4 GB for Chromium), making it ideal for high-throughput serverless rendering clusters (AWS G4/G5, Modal, RunPod, Kubernetes).

---

## Architectural Comparison: Gitframes vs. Remotion vs. Hyperframes

Developers generating video programmatically commonly consider **Remotion** (React/Chromium) or **Hyperframes** (Canvas2D/SVG web animation). The table below details how Gitframes compares across fundamental engineering dimensions.

### Detailed Comparison Matrix

| Capability / Dimension | **Gitframes** | **Remotion** | **Hyperframes** |
|---|---|---|---|
| **Underlying Engine** | **Native WebGPU** (WGSL Compute & Render Pipelines via Dawn / Metal / Vulkan) | **Chromium / Puppeteer** (React DOM, HTML/CSS layout engine) | **Canvas2D / WebGL / SVG** (Browser or Node Skia runtime) |
| **Rendering Architecture** | Direct hardware GPU framebuffer rendering & hardware video encoding ([`@napi-rs/webcodecs`](file:///Users/okanaslankan/gitframes/packages/renderer/package.json#L49)) | Spawns headless Chrome instances; captures frames via CDP / `page.screenshot()` | Software or hardware 2D canvas context execution |
| **Rendering Speed & FPS** | **60–120+ FPS** (Real-time to faster-than-real-time GPU execution) | **5–20 FPS** (Bottlenecked by DOM reflow, IPC serialization, and rasterization) | **20–40 FPS** (Bottlenecked by CPU canvas draw commands or JS execution) |
| **Memory Footprint** | **~200–400 MB** per render process (zero browser overhead) | **1.5–4.0 GB+** per render worker (Full Chromium instance + V8 DOM heap) | **~500 MB–1 GB** (Depends on Skia/Canvas node bindings) |
| **Typography Engine** | **Slug GPU** (Analytic cubic/quadratic Bezier evaluation in WGSL; infinite zoom; After Effects parity selectors) | **Browser DOM Text** (CSS fonts; rasterized to bitmap; blurry under 3D transforms) | **Canvas2D / Path Text** (CPU rasterized glyph curves or standard text rendering) |
| **2D VFX & Post-Processing** | **50+ WebGPU Shaders** (Curves, Levels, Selective Color, 3D LUT, Film Grain, Halftone, Liquify, PBR Glass, Relighting) | Limited to **CSS Filters** (`filter: blur(...)`) or custom WebGL canvas wrappers | Basic Canvas2D composite operations and simple 2D filters |
| **3D Graphics & Spatial Depth** | **Native 3D Scene Graph** (LookAt/Turntable camera, multiplane depth, mesh skinning for OBJ/FBX/glTF, SSAO, PCSS shadows, DoF) | **None built-in** (Requires embedding Three.js/Fiber inside canvas inside React DOM) | Minimal 2.5D canvas layers; no unified 3D mesh pipeline |
| **Motion Blur & Physics** | **Physical Shutter Motion Blur** ($180^\circ$ shutter velocity buffers in MRT) + closed-form spring kinematics | CSS transitions or JS interpolations; synthetic CSS blur hacks | Frame interpolation or manual multi-pass rendering |
| **Audio Engine & DSP** | **Native WebGPU Audio DSP & Procedural SFX** (Audio layers, multi-track mixing, procedural SFX triggers, reactive signals) | `<Audio>` component for static audio playback; basic volume curves | Basic static audio playback |
| **Live Charting & Telemetry** | **ChartGPU Bridge** (Hardware-accelerated line, bar, OHLC, area charts rendered directly to GPU textures) | HTML/SVG chart libraries (Recharts, Chart.js) rendered in DOM | Custom canvas draw operations |
| **AI & Computer Vision** | **WebGPU Tensor Pipelines & MediaPipe** (Canny, Depth-to-Normals, Optical Flow, 52-blendshape facial tracking) | External pre-rendered assets; no native GPU tensor conditioning | External pre-rendered assets |
| **Headless Verification** | **FrameGrid contact sheets**, single-frame snapshots, and Skia MSE mathematical pixel invariant assertions | Visual snapshot testing via Playwright/Puppeteer | Manual frame inspection or canvas pixel diffing |
| **Docker / Cloud Portability** | **Compact Docker Container** (~500 MB Alpine/Debian slim with native GPU/Vulkan drivers) | **Heavy Docker Container** (~2–3 GB with Chromium, fonts, and X11/Mesa dependencies) | Moderate container size |

---

### Why Gitframes? Deep Architectural Analysis

#### 1. Why Not Remotion for High-Performance Pipelines?
Remotion deserves credit for pioneering the "video in React" paradigm. For developers building basic marketing templates using existing web UI components, Remotion provides an accessible bridge. However, because Remotion is coupled to **headless Chromium**:
- **Scalability Ceiling**: Chromium is an interactive document browser, not a real-time compositor. Every frame requires DOM style recalculation, layout reflow, paint tree traversal, and cross-process image buffer copying over Chrome DevTools Protocol (CDP).
- **GPU Inefficiencies**: WebGL inside headless Chromium operates within sandbox constraints and cannot leverage modern compute shaders, storage buffers, or native WebGPU multi-render targets (MRT) efficiently.
- **Server Infrastructure Cost**: Scaling Remotion in production requires high-memory CPU instances to prevent Chromium OOM crashes, driving cloud rendering bills significantly higher.

**Gitframes eliminates the browser entirely.** By executing directly on the GPU via native WebGPU, Gitframes operates with the architecture of a AAA game engine or digital audio workstation (DAW), yielding massive throughput improvements.

#### 2. Why Not Hyperframes or Traditional Canvas2D?
Hyperframes and standard 2D canvas engines improve on DOM overhead by drawing directly to canvas surfaces. However:
- **CPU Bottlenecks**: Canvas2D API calls (`ctx.arc`, `ctx.bezierCurveTo`) are largely evaluated on the CPU. Under complex scenes with hundreds of animated typography layers or vector paths, CPU rasterization quickly stalls.
- **Shallow Post-Processing**: Canvas2D lacks multi-pass fragment shader pipelines. Professional tonal grading (3D LUT color cubes, selective color isolation, bilateral SSAO, optical depth-of-field bokeh) is virtually impossible without native shaders.
- **Audio Disconnect**: Canvas frameworks treat audio as an external soundtrack. Gitframes unifies audio synthesis and visual animation through frame-accurate reactive signals and stem extraction.

---

## Key Features & Capabilities

### 1. Slug GPU Vector Typography & AE Parity
Traditional text rendering relies on CPU font rasterization or low-resolution signed distance field (SDF) glyph atlases that become soft under 3D camera sweeps. Gitframes integrates the **Slug algorithm** ([`SlugPipeline`](file:///Users/okanaslankan/gitframes/packages/webgpu-renderers/src/slug/slug-pipeline.ts)):
- **Analytic GPU Evaluation**: WGSL fragment shaders evaluate exact cubic and quadratic Bezier curves per-pixel. Glyphs remain razor-sharp at $10\text{px}$ or $10,000\text{px}$ with zero CPU re-rasterization.
- **After Effects-Parity Text Animators**: Full parity with After Effects range selectors (`square`, `ramp_up`, `ramp_down`, `triangle`, `smooth`), non-linear `easeHigh`/`easeLow` curves, and seeded PRNG character shuffling ([`TextAnimator`](file:///Users/okanaslankan/gitframes/packages/gitframes/src/index.ts#L250)).
- **Human Typing Cadence**: Dynamic typewriter simulation with weighted punctuation delays (commas $3\times$, sentence ends $5.5\times$, newlines $7\times$) and trailing scramble character resolution ([`TypewriterAnimator`](file:///Users/okanaslankan/gitframes/packages/gitframes/src/index.ts#L275)).
- **3D Volumetric Text Formations**: Map text onto 3D cylindrical drums, logarithmic vortex spirals, and double-helix DNA ribbons with surface-normal banking ([`evaluateVolumetricFormation`](file:///Users/okanaslankan/gitframes/packages/gitframes/src/index.ts#L198)).
- **Dynamic Leading & Skew**: Area-preserving unimodular shear matrices and accordion line leading anchored to baseline, center, or top edges.

### 2. Photoshop-Grade WebGPU 2D VFX (50+ Shaders)
Gitframes houses a comprehensive suite of professional image and video processing shader nodes in [`nodes/`](file:///Users/okanaslankan/gitframes/nodes) and [`packages/webgpu-renderers`](file:///Users/okanaslankan/gitframes/packages/webgpu-renderers):
- **Tonal Grading**: Curves (RGB, R, G, B spline interpolation), Levels (black/white point, gamma, output levels), Shadows/Highlights, Selective Color (CMYK color gamut isolation), and 3D Cube LUT grading ([`ApplyLUT`](file:///Users/okanaslankan/gitframes/packages/gitframes/src/index.ts#L392)).
- **Stylization & Grain**: Film Grain (Gaussian film emulsion with spatial seed variation), Halftone Screen (monochrome, RGB, or CMYK with adjustable dot shapes and angles), Gradient Map, and High Pass filtering.
- **Optics & Lens**: Bilateral Gaussian Blur, Unsharp Mask, Vignette, Refraction Caustics, and PBR Glassmorphism with chromatic dispersion ([`PBRGlass`](file:///Users/okanaslankan/gitframes/packages/gitframes/src/index.ts#L434)).
- **Distortion & Warping**: Displacement Maps, Liquify, Mesh Warping, and Corner Pin homography.

### 3. Unified 3D Scene Graph, Camera & Mesh Shading
- **Calibrated 3D Camera Rig**: LookAt and Turntable cameras ([`Camera3D`](file:///Users/okanaslankan/gitframes/packages/webgpu-renderers/src/math3d/camera3d.ts#L80)) calibrated so that $z=0$ matches 2D canvas pixel coordinates $1:1$.
- **3D Layout Primitives**: Native containers for [`Layer3D.cube`](file:///Users/okanaslankan/gitframes/packages/gitframes/src/shapes3d.ts#L204), `Layer3D.carousel`, `Layer3D.prism`, `Layer3D.plane`, and `Layer3D.grid` with unified depth buffer testing.
- **Zero-Dependency 3D Model Parsers**: Built-in parsers for **OBJ, FBX, glTF/GLB, STL, PLY, VOX, 3DS, and OFF** files.
- **Skeletal Animation & Shading**: 128-bone Linear Blend Skinning (LBS), multi-light Blinn-Phong and PBR shading, directional contact soft shadows (PCSS / Poisson PCF), Screen-Space Ambient Occlusion (SSAO), and optical Depth of Field (DoF).
- **Physical Motion Blur**: $180^\circ$ standard physical camera shutter motion blur powered by per-vertex velocity vectors packed into `rg16float` MRT buffers ([`MotionBlurPipeline`](file:///Users/okanaslankan/gitframes/packages/webgpu-renderers/src/index.ts)).

### 4. Audio Layers, Procedural SFX & Reactive Signals
Gitframes provides deterministic audio handling and transition sound design:
- **Soundtrack Audio Layers**: Load and mix soundtrack audio directly via `Layer.audio` with frame-exact lifecycle control.
- **Procedural Transition SFX**: Deterministic CPU-synthesized whooshes, impacts, risers, downshifters, and glitches placed precisely on the bar/beat grid (`renderSfx`, `mixSfxInto`, `softLimit`).
- **Multi-Track Mixing**: Combine and master audio tracks headlessly with `mixAudioTracks` and `encodeStereoWav`.
- **Reactive Signals**: Drive layer transformations, scales, borders, or shader uniforms directly from procedural tempo signals (`Signal.builder`) or audio analysis.

### 5. WebGPU ChartGPU Bridge
Through native integration with [`ChartGPU`](file:///Users/okanaslankan/gitframes/packages/webgpu-renderers/src/chartgpu/chartgpu-bridge.ts):
- Render real-time financial, scientific, and metric charts (line, bar, candlestick/OHLC, area, scatter) directly onto offscreen GPU textures.
- Composite live charts directly into 3D floating perspective cards, flex layouts, or HUD overlays without canvas DOM elements.

### 6. Neural Tensor & MediaPipe AI Conditioning
Native WebGPU compute pipelines in [`@gitframes/tensor-webgpu`](file:///Users/okanaslankan/gitframes/packages/tensor-webgpu) and [`@gitframes/mediapipe`](file:///Users/okanaslankan/gitframes/packages/mediapipe):
- **WebGPU Tensor Conditioning**: Real-time Canny edge detection, Monocular Depth-to-Normals, Optical Flow, and Temporal Deflicker pipelines for ControlNet and video generation pipelines.
- **Zero-Copy Vision Tracking**: MediaPipe Face Mesh and Pose tracking. Extracts 52 facial blendshapes directly into reactive signals to drive 3D avatars, digital humans, or pinned UI elements in GPU memory without disk I/O.

### 7. Headless Conformance & FrameGrid Testing
- **Pixel-Sampling Invariant Assertions**: Test compositions in Vitest headlessly using `skia-canvas` to verify shader mathematics, font coverage, and Mean Squared Error (MSE) temporal frame deltas.
- **FrameGrid Visual Contact Sheets**: Call `comp.renderFrameGrid(...)` to output contact sheets of sequential frames across a timeline, enabling instant visual review of easing curves, kinetic typography, and transitions.

---

## Monorepo Architecture

Gitframes is structured as a modular monorepo managed with `pnpm` and `turbo`:

```
gitframes/
├── packages/
│   ├── gitframes/              # Primary unified SDK (Composition, Layer, LayerAnimation, Signal)
│   ├── core/                   # Core AST definitions, Effect base class, VirtualMediaData
│   ├── compositions/           # Layout engine, Flex/Box AST compiler, timeline evaluator
│   ├── webgpu-renderers/       # WGSL shaders, Slug GPU text engine, 3D renderer, camera, lights, materials
│   ├── tensor-webgpu/          # WebGPU compute pipelines (Canny, Depth-to-Normals, Flow, Deflicker)
│   ├── mediapipe/              # MediaPipe vision runner, 52 blendshape signals, landmark pinning
│   ├── renderer/               # Headless Node.js WebGPU renderer via Dawn, WebCodecs, and skia-canvas
│   └── server-utils/           # Shared server infrastructure, file storage, and asset caches
├── nodes/                      # 58+ specialized domain nodes (VFX, audio processors, layout generators)
├── apps/
│   └── renderer-service/       # Production HTTP / gRPC rendering microservice container
├── examples/                   # 19 production-grade reference compositions and films
├── recipes/                    # Architectural composition guides and best practices
└── specs/                      # Engineering specifications and mathematical audits
```

---

## Quickstart Guide

### Installation

```bash
pnpm add gitframes
```

> **Note**: Node.js $\ge 22$ is required. Gitframes uses native GPU acceleration via Dawn / WebGPU or Vulkan.

---

### 1. Basic Composition & Kinetic Auto-Layout

```typescript
import { Composition, Layer, LayerAnimation } from "gitframes";

// 1. Initialize a 1080p60 composition
const comp = new Composition({
  width: 1920,
  height: 1080,
  fps: 60,
  durationFrames: 180, // 3 seconds
  backgroundColor: "#090a0f",
  fonts: ["assets/fonts/Inter.ttf", "assets/fonts/SpaceGrotesk.ttf"],
});

// 2. Define physical snap overshoot animations
const cardEntrance = LayerAnimation.create()
  .fadeIn(0, 20, "power2.out")
  .fromTo("y", 60, 0, { start: 0, end: 35, ease: "back.out(1.5)" })
  .fromTo("scale", 0.92, 1.0, { start: 0, end: 35, ease: "back.out(1.2)" });

// 3. Assemble responsive flex layout card
const heroCard = Layer.box({
  width: 720,
  height: 380,
  background: "#141721",
  borderRadius: 24,
  borderColor: "#262b3d",
  borderWidth: 1.5,
  padding: 32,
  children: [
    Layer.flex({
      dir: "column",
      gap: 16,
      children: [
        Layer.text("GITFRAMES ENGINE", {
          fontSize: 16,
          fontWeight: 700,
          fill: "#6366f1",
          letterSpacing: 2.0,
        }),
        Layer.text("Next-Gen WebGPU Motion", {
          fontSize: 48,
          fontWeight: 700,
          fill: "#f8fafc",
          fontFamily: "SpaceGrotesk",
        }),
        Layer.text("Direct hardware video composition without headless browser overhead.", {
          fontSize: 20,
          fill: "#94a3b8",
          lineHeight: 28,
        }),
      ],
    }),
  ],
}).animate(cardEntrance);

comp.add(heroCard);
```

---

### 2. Unified 3D Scene with Camera & 3D Model

```typescript
import { Composition, Layer, Layer3D, CameraAnimation, Light } from "gitframes";

const comp = new Composition({ width: 1920, height: 1080, fps: 60, durationFrames: 300 });

// 1. Declare LookAt 3D Camera with continuous orbit
const cameraAnim = CameraAnimation.create()
  .orbit({ fromAzimuth: -30, toAzimuth: 30, elevation: 15, radius: 1200, start: 0, end: 300 });

comp.add(Layer.camera({ x: 960, y: 540, z: -1000, targetX: 960, targetY: 540, targetZ: 0 }).animate(cameraAnim));

// 2. Add Studio Lighting
comp.add(Light.ambient("#ffffff", 0.4));
comp.add(Light.directional({ color: "#e0e7ff", intensity: 1.2, x: 500, y: -800, z: -600 }));

// 3. Add 3D Model with skeletal animation
comp.add(
  Layer.glb("assets/models/character.glb", {
    x: 960,
    y: 640,
    z: 0,
    scale: 2.5,
    material: "lit",
    loop: true,
  })
);

// 4. Add 3D Prism Layout Carousel
comp.add(
  Layer3D.carousel({
    radius: 400,
    cards: [
      Layer.box({ width: 280, height: 180, background: "#1e293b", borderRadius: 16 }),
      Layer.box({ width: 280, height: 180, background: "#334155", borderRadius: 16 }),
      Layer.box({ width: 280, height: 180, background: "#0f172a", borderRadius: 16 }),
    ],
  })
);
```

---

### 3. Audio Soundtrack, Procedural SFX & Reactive Signals

```typescript
import { Composition, Layer, LayerAnimation, Signal, renderSfx, mixSfxInto, softLimit } from "gitframes";

const comp = new Composition({ width: 1920, height: 1080, fps: 60 });
const totalFrames = 240;

// 1. Add soundtrack audio
comp.addAudio(Layer.audio("assets/score.mp3", { volume: 0.9, durationFrames: totalFrames }));

// 2. Synthesize frame-accurate procedural SFX hits
const bed: [Float32Array, Float32Array] = [
  new Float32Array(Math.ceil((totalFrames / 60) * 48000)),
  new Float32Array(Math.ceil((totalFrames / 60) * 48000)),
];
mixSfxInto(bed, [
  renderSfx({ type: "whoosh", atBar: 0.79, volume: 0.5 }, { sampleRate: 48000, secondsPerBar: 2.0, seed: 1 }),
  renderSfx({ type: "impact", atBar: 1.0, volume: 0.8 }, { sampleRate: 48000, secondsPerBar: 2.0, seed: 2 }),
]);
softLimit(bed);

// 3. Generate reactive signals synced to tempo (e.g. 120 BPM = 2 Hz)
const beatPulse = Signal.builder({ type: "sawtooth", frequency: 2, amplitude: 0.08, offset: 1.0 });

// 4. Bind reactive signals to visual properties
const reactiveCard = Layer.box({ width: 400, height: 250, background: "#1c202e", borderRadius: 20 })
  .animate(
    LayerAnimation.create()
      .signal("scale", beatPulse, { multiplier: 1.0, offset: 0.0 })
      .fromTo("opacity", 0, 1, { start: 0, end: 15, ease: "power2.out" }),
  );
comp.add(reactiveCard);
```


---

### 4. Chained WebGPU Post-Processing VFX

```typescript
import { Composition, FilmGrain, Vignette, ColorBalance } from "gitframes";

const comp = new Composition({ width: 1920, height: 1080, fps: 60 });

// Apply whole-composition cinematic color grading and film emulsion
comp.apply(new Vignette({ strength: 0.28, radius: 0.85 }));
comp.apply(new FilmGrain({ strength: 0.06, size: 1.5, animated: true }));
comp.apply(new ColorBalance({ shadows: [0, 2, 6], highlights: [4, 1, -2] }));
```

---

### 5. Headless Video & FrameGrid Rendering

```typescript
import { buildMyComposition } from "./my-composition.js";

const comp = await buildMyComposition();

// 1. Render single frame to PNG buffer for visual inspection
const frameBuffer = await comp.renderFrame({ frame: 45 });

// 2. Render contact sheet grid of 12 sequential frames
const gridBuffer = await comp.renderFrameGrid({
  startFrame: 0,
  endFrame: 120,
  stepFrames: 10,
  cellWidth: 320,
  showLabels: true,
});

// 3. Render final hardware-encoded MP4 video with mixed audio
const { filePath } = await comp.renderVideo({
  outputPath: "output/final-product-film.mp4",
  quality: "high",
  concurrency: 4,
});

console.log(`Video rendered successfully to: ${filePath}`);
```

---

### Key Rules to Follow

1. **Design Tokens & Theme Contracts**: Always define a centralized `THEME` object for colors, typography, border radii, and spacing scales. Never hardcode magic hex values or ad-hoc margins.
2. **WebGPU Premultiplied Alpha Invariant**: Fragment shaders outputting premultiplied alpha (`color * opacity * alpha`) must use `srcFactor: "one"` in their blend state (`color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }`). Never use `srcFactor: "src-alpha"` for premultiplied outputs, as squaring alpha causes fade-ins to darken into murky gray.
3. **Carrier Match Cuts**: Carry visual elements (a badge, card, cursor, or container) across scene boundaries with continuous velocity and position to eliminate jarring transition cuts.
4. **Physical Easing Vocabulary**: Use `back.out(1.4–1.7)` for snap overshoot entrances, `spring` or `expo.out` for decelerating motion, and `power2.in` for exits. Reserve `linear` solely for infinite spinners or time counters.
5. **Headless Invariant Verification**: Verify true shader transformations, font glyph rasterization coverage, and temporal frame deltas (MSE) headlessly via pixel sampling with `skia-canvas` in Vitest before deploying.

---

## Agent Skills & Plugins

Gitframes ships agent skills that teach Claude, Codex and other coding agents how to write, render and check gitframes compositions. The repository is a plugin marketplace (`gitframes-plugins`) with a single plugin (`gitframes`), and that plugin contains only skills: no MCP servers, hooks or commands.

| Skill | Use it for |
| --- | --- |
| `gitframes-compose` | Compositions, layer trees, layout, animation and easing, beat grids, film structure |
| `gitframes-effects` | Effect classes, the unified section architecture, premultiplied-alpha invariants |
| `gitframes-render` | Headless rendering, FrameGrid inspection, pixel probes, MP4 delivery checks |

Once installed, the skills load on their own when a task matches them (e.g. *"add a film-grain pass to this scene"* or *"render a frame grid of intro.ts"*). You don't need to invoke them.

### Claude Code

Inside a Claude Code session:

```text
/plugin marketplace add gatewai-dev/gitframes
/plugin install gitframes@gitframes-plugins
```

Or from your shell:

```bash
claude plugin marketplace add gatewai-dev/gitframes
claude plugin install gitframes@gitframes-plugins
```

Add `--scope project` to the install command to record the plugin in the project's `.claude/settings.json` so your whole team gets it. To pull new skill versions later, run `/plugin marketplace update gitframes-plugins`.

**Enable it for everyone working in your repo.** Commit this to `.claude/settings.json`; Claude Code prompts teammates to install it when they trust the folder:

```json
{
  "extraKnownMarketplaces": {
    "gitframes-plugins": {
      "source": { "source": "github", "repo": "gatewai-dev/gitframes" }
    }
  },
  "enabledPlugins": {
    "gitframes@gitframes-plugins": true
  }
}
```

**Claude desktop app (Code tab):** open the plugins settings, add the marketplace `gatewai-dev/gitframes`, then install **Gitframes**.

### Codex

Add the marketplace:

```bash
codex plugin marketplace add gatewai-dev/gitframes
```

Then install **gitframes** from `/plugins` in the Codex TUI, or turn it on in `~/.codex/config.toml` (or in a project's `.codex/config.toml`):

```toml
[plugins."gitframes@gitframes-plugins"]
enabled = true
```

### Any other agent (skills only)

With the [`skills`](https://skills.sh) CLI, which supports Claude Code, Codex, Cursor, Copilot and others:

```bash
npx skills add gatewai-dev/gitframes
```

Or copy the folders by hand: put `skills/<name>/` into `.claude/skills/`, `.agents/skills/` or `~/.agents/skills/`. VS Code / Copilot / Cursor / Kiro can also load the portable root [`plugin.json`](plugin.json) through their plugin UI.

### Maintaining the plugin

Three manifests describe the same plugin: [`plugin.json`](plugin.json) (portable [Agent Plugins 1.0](https://agent-plugins.org)), [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) (Claude Code) and [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json) (Codex). The marketplace catalogs are [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) and [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json). The portable field set is closed, so client-specific fields go in that client's manifest, not in `plugin.json`. Bump `version` in all three manifests together, because clients use it to decide when to update.

When you work inside this repository, Codex and Claude pick up the skills automatically through the symlinks in `.agents/skills/` and `.claude/skills/`. Skills are written only under `skills/`, so never copy them anywhere else. `pnpm run check:plugins` validates the manifests, skill frontmatter, marketplace catalogs, symlinks and the generated effects catalog. `pnpm run sync:effects-catalog` regenerates `gitframes-effects`'s catalog after any change to the `Effect` classes.

---

## Development & Building

Gitframes uses `pnpm` (version 10+) and `turbo` for monorepo orchestration.

### Build All Packages

```bash
pnpm install
pnpm build
```

### Run Conformance Tests

```bash
pnpm test
```

### Run an Example Renderer

```bash
# Render a specific showcase example
pnpm --filter @gitframes/example-04-blending render

# Render the 30-second master brand film
cd examples/19_gitframes_film
pnpm render
```

### Docker Container for Production Rendering

Gitframes provides an optimized Docker build ([`Dockerfile.renderer`](file:///Users/okanaslankan/gitframes/Dockerfile.renderer)) for deploying the renderer service in cloud GPU clusters:

```bash
docker build -t gitframes-renderer -f Dockerfile.renderer .
```

---

## License

Gitframes is open-source software licensed under [Apache-2.0]
