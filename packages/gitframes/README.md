# Gitframes

> **High-Performance WebGPU Rendering Engine & SDK for Programmatic Video, Motion Graphics, Audio DSP, and Neural Conditioning.**

`gitframes` is a code-first video composition SDK built directly on native WebGPU and reactive Signals. It brings Photoshop-grade 2D image processing, After Effects-grade kinetic typography, unified 3D spatial camera motion, procedural audio DSP, and real-time neural vision pipelines into a single, deterministic rendering pipeline.

Unlike browser-dependent frameworks that run inside headless Chromium, Gitframes executes directly on GPU hardware via Dawn / WebGPU in Node.js and in modern WebGPU-enabled browsers—delivering high frame rate rendering with a tiny resource footprint.

---

## Installation

```bash
npm install gitframes
# or
pnpm add gitframes
```

### System Requirements
- Node.js >= 22
- WebGPU-capable GPU / drivers (Metal on macOS, Vulkan/DirectX on Linux & Windows)

---

## Quickstart

```typescript
import { Composition, Layer, LayerAnimation } from "gitframes";

// 1. Create a 1080p, 60 FPS composition
const comp = new Composition({
  width: 1920,
  height: 1080,
  fps: 60,
  durationFrames: 180,
});

// 2. Add background
comp.add(
  Layer.box({
    width: "100%",
    height: "100%",
    background: "#0a0a0f",
  })
);

// 3. Add animated typography
comp.add(
  Layer.text("Build with Gitframes", {
    fontSize: 72,
    fill: "#ffffff",
    fontFamily: "Inter",
    align: "center",
    y: 480,
  }).animate(
    LayerAnimation.create()
      .fadeIn(0, 30, "power2.out")
      .fromTo("y", 520, 480, { start: 0, end: 30, ease: "power3.out" })
  )
);
```

---

## Core Capabilities

- **Slug GPU Vector Typography**: Resolution-independent vector glyph evaluation in WGSL shaders.
- **Photoshop-Grade VFX (50+ Shaders)**: Curves, Levels, Selective Color, 3D LUTs, Film Grain, Vignette, Blur, Depth of Field, SSAO, PBR Glass.
- **Unified 3D Scene Graph**: Position 2D surfaces in 3D coordinate space with 3D cameras, lights, and OBJ/FBX/glTF models.
- **Audio DSP & SFX**: Procedural sound effects (impact, whoosh, riser), audio stem analysis, and audio-reactive signals.
- **Headless GPU Video Rendering**: Direct hardware encoding via `@mediabunny/server` / WebCodecs without headless browser overhead.
- **Live Preview**: `startPreview({ entry, export })` opens a localhost player (soundtrack, waveform timeline, frame stepping). The page runs the composition's own code and renders it with WebGPU in the browser, at or near full frame rate. It serves the page and returns the URL, so an agent can show it in its own browser pane (`open: true` opens the system browser instead). Re-running it replaces the running preview, and an open tab reloads into the new version.

---

## License

Apache-2.0
