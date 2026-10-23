<div align="center">

<img src="assets/brand/banner.png" alt="framefields — code-first video, rendered natively on WebGPU" width="100%">

### Compositing, motion graphics, and 3D for code-first video — one npm package that AI agents drive with code.

[**Documentation**](https://framefields.dev/docs) &ensp;·&ensp; [**Website**](https://framefields.dev) &ensp;·&ensp; [**Models**](https://framefields.dev/models) &ensp;·&ensp; [**Discord**](https://discord.gg/cbqMGGme5) &ensp;·&ensp; [**Examples**](examples)

[![npm](https://img.shields.io/badge/npm-framefields-cb3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/framefields)
[![docs](https://img.shields.io/badge/docs-framefields.dev%2Fdocs-6366f1)](https://framefields.dev/docs)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENCE)
[![status](https://img.shields.io/badge/status-beta-orange.svg)](#)
[![discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/cbqMGGme5)
[![youtube](https://img.shields.io/badge/YouTube-@gatewai.studio-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@gatewai.studio)
[![node](https://img.shields.io/badge/node-%E2%89%A522-3c873a?logo=node.js&logoColor=white)](https://nodejs.org)
[![engine](https://img.shields.io/badge/engine-WebGPU%20%C2%B7%20WGSL-6366f1)](https://www.w3.org/TR/webgpu/)
[![gpu](https://img.shields.io/badge/GPU-Dawn%20%C2%B7%20Metal%20%C2%B7%20Vulkan-8b5cf6)](#)

</div>

**Add to your agent**

Teach Claude Code, Cursor, Codex, Copilot, Hermes, and 70+ others how to author, animate, and render compositions:

```bash
npx skills add gatewai-dev/framefields
```

---

Framefields is built for coding agents. It packs the capabilities usually split across three desktop creative suites—Photoshop-style compositing & VFX, After Effects-style typography & motion graphics, and Blender-style 3D scenes & cameras—into a single lightweight npm package.

- **Zero Headless-Browser Overhead** — No Chromium, no Puppeteer, no DOM reflows, and no screenshot pipeline. Renders directly on native GPU hardware via Dawn / WebGPU / Metal / Vulkan.
- **Deterministic & Frame-Accurate** — Discrete sample points, absolute frame clocks, and frame-accurate audio BeatGrids. No floating timers, no drift.
- **Agent-First Workflow** — Your coding agent writes TypeScript, inspects rendered frame grids, and exports hardware-encoded MP4s headlessly.

### Made with framefields

Every frame is rendered by framefields directly from TypeScript in [`examples/`](examples). Click a still to watch on YouTube:

<table>
  <tr>
    <td width="50%" align="center">
      <a href="https://youtu.be/POC7rKnuoE4"><img src="assets/showcase/physics-dancer.jpg" alt="Physics dancer showcase film" width="100%"></a>
      <br><a href="https://youtu.be/POC7rKnuoE4"><b>Physics dancer</b></a>
      <br><sub><a href="examples/28_physics_dancer"><code>28_physics_dancer</code></a></sub>
    </td>
    <td width="50%" align="center">
      <a href="https://youtu.be/k2lgbdL6_TA"><img src="assets/showcase/mac-keyboard.jpg" alt="Mac keyboard from 3D primitives" width="100%"></a>
      <br><a href="https://youtu.be/k2lgbdL6_TA"><b>Mac Keyboard</b></a>
      <br><sub><a href="examples/26_mac_keyboard_from_3d_primitives"><code>26_mac_keyboard_from_3d_primitives</code></a></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://youtu.be/FVXTqAozAv8"><img src="assets/showcase/framefields-launch.jpg" alt="Framefields launch film" width="100%"></a>
      <br><a href="https://youtu.be/FVXTqAozAv8"><b>Framefields launch</b></a>
      <br><sub><a href="examples/22_framefields_launch"><code>22_framefields_launch</code></a></sub>
    </td>
    <td width="50%" align="center">
      <a href="https://youtu.be/9BF1snfmg3o"><img src="assets/showcase/full-circle.jpg" alt="Full Circle film" width="100%"></a>
      <br><a href="https://youtu.be/9BF1snfmg3o"><b>Full Circle</b></a>
      <br><sub><a href="examples/21_full_circle"><code>21_full_circle</code></a></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://youtu.be/RQ3yi_lzPqI"><img src="assets/showcase/dancer.jpg" alt="Dancer showcase film" width="100%"></a>
      <br><a href="https://youtu.be/RQ3yi_lzPqI"><b>Dancer showcase</b></a>
      <br><sub><a href="examples/19_framefields_film"><code>19_framefields_film</code></a></sub>
    </td>
    <td width="50%" align="center">
    </td>
  </tr>
</table>

---

## Installation

```bash
pnpm add framefields
```

> **Requirements:** Node.js ≥ 22. Native GPU acceleration via WebGPU / Dawn (macOS Metal, Linux Vulkan, Windows D3D12).

---

## Quickstart

```typescript
import { Composition, Layer, LayerAnimation } from "framefields";

// 1. Create a 1080p60 composition
const comp = new Composition({
  width: 1920,
  height: 1080,
  fps: 60,
  durationFrames: 180, // 3 seconds
  backgroundColor: "#090a0f",
  fonts: ["assets/fonts/Inter.ttf", "assets/fonts/SpaceGrotesk.ttf"],
});

// 2. Physical snap-overshoot entrance animation
const entrance = LayerAnimation.create()
  .fadeIn(0, 20, "power2.out")
  .fromTo("y", 60, 0, { start: 0, end: 35, ease: "back.out(1.5)" })
  .fromTo("scale", 0.92, 1.0, { start: 0, end: 35, ease: "back.out(1.2)" });

// 3. Assemble a responsive flex-layout card with Slug vector type
const heroCard = Layer.box({
  width: 760,
  height: 380,
  background: "#141721",
  borderRadius: 24,
  borderColor: "#262b3d",
  borderWidth: 1.5,
  padding: 40,
  children: [
    Layer.flex({
      dir: "column",
      gap: 16,
      children: [
        Layer.text("FRAMEFIELDS ENGINE", {
          fontSize: 16,
          fontWeight: 700,
          fill: "#6366f1",
          letterSpacing: 2.0,
        }),
        Layer.text("Code-First Video", {
          fontSize: 48,
          fontWeight: 700,
          fill: "#f8fafc",
          fontFamily: "SpaceGrotesk",
        }),
        Layer.text("Direct GPU rendering without headless browser overhead.", {
          fontSize: 20,
          fill: "#94a3b8",
          lineHeight: 28,
        }),
      ],
    }),
  ],
}).animate(entrance);

comp.add(heroCard);

// 4. Render to hardware-encoded MP4
const { filePath } = await comp.renderVideo({
  outputPath: "output/hero.mp4",
  quality: "high",
});

console.log(`Rendered to: ${filePath}`);
process.exit(0);
```

---

## AI Gateway

Framefields provides built-in access to the [**AI Gateway**](https://framefields.dev/models), allowing agents and developers to generate cinematic video, images, music, and voiceovers directly from code using hundreds of hosted models. Explore the full model catalog in the [**AI Gateway**](https://framefields.dev/models) or read the integration guide in the [**documentation**](https://framefields.dev/docs/guides/ai/).

---

## Documentation

Everything else—including full API references, interactive tutorials, and guides—is available at [**framefields.dev/docs**](https://framefields.dev/docs):

- **[AI Gateway & Asset Generation](https://framefields.dev/models)** — Unified SDK for generating images, video clips, music, and voice via hundreds of hosted models
- **[Typography & Animators](https://framefields.dev/docs)** — Slug analytic vector text, After Effects-style range animators, and typewriter cadence
- **[WebGPU 2D VFX](https://framefields.dev/docs)** — 50+ shaders: 3D LUTs, Curves, Film Grain, Glassmorphism, and Blur
- **[Unified 3D Scenes](https://framefields.dev/docs)** — LookAt cameras, PBR materials, studio lighting, shadows, and glTF/GLB models
- **[Audio & Procedural SFX](https://framefields.dev/docs)** — BeatGrids, procedural whooshes/impacts, and audio-reactive signals
- **[On-Device Vision](https://framefields.dev/docs)** — Apache-2.0 ONNX models for object tracking, pose estimation, and subject cutouts
- **[Live Browser Preview](https://framefields.dev/docs)** — Localhost WebGPU player with scrubbing, waveform timeline, and frame-stepping

---

## Community & License

- **Documentation:** [framefields.dev/docs](https://framefields.dev/docs)
- **Website:** [framefields.dev](https://framefields.dev)
- **Discord:** [discord.gg/cbqMGGme5](https://discord.gg/cbqMGGme5)
- **YouTube:** [@gatewai.studio](https://www.youtube.com/@gatewai.studio)

Licensed under [Apache-2.0](LICENCE).
