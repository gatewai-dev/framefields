# @framefields/webgpu-renderers

## 2.1.3

### Patch Changes

- Measure variable fonts with optical size (`opsz`) clamped to `fontSize` across `FontManager.measure`, `measureText`, captions, and rich text so layout matches rendered glyph geometry.
- 71d48b4: Fail fast when referenced local media files cannot be opened or decoded during headless rendering, instead of silently resolving with black frames or silent audio.

## 2.1.2

## 2.1.1

### Patch Changes

- rm aws bundle

## 2.1.0

## 2.0.11

### Patch Changes

- Physical 3D look, gradients, mattes, transitions and lint for agents:

  - `Layer.environment(preset)` / `Lighting.studio|soft|sunset|dramatic()`: GGX PBR with a procedural studio environment, emissive, exposure and tone mapping (PBR Neutral, AgX, ACES), soft shadow maps (`castShadow`), HDR bloom and fog. glTF normal, metallic-roughness, occlusion and emissive maps are now used.
  - `Color` helpers (`oklch`, `mix`, `ramp`, `lighten`, `contrast`, `readableOn`, …); `hsl()`, `oklch()` and space-separated `rgb()` accepted everywhere; color keyframes blend in OKLab.
  - CSS `linear-` / `radial-` / `conic-gradient()` with up to 8 stops on any background or shape fill.
  - Track mattes (`withMatte(layer, "alpha" | "alpha-inverted" | "luma" | "luma-inverted")`), on 2D and 3D layers; 3D layers keep their depth.
  - `Layer.sequence([...])` with `Transition.crossfade|push|slide|zoom|whip|wipe|iris|fadeThrough`.
  - `.animate()` merges with existing tracks; `FontManager.measure()` text metrics.
  - `comp.lint()` (also in `renderVideo({ qa })`): unreadable colors/gradients, low-contrast text, off-canvas layers, shadow and environment misuse, static tracks.
  - Fixes: `Layer.shape({ fill })` was ignored; `Layer3D.plane` dropped material options; stale 3D camera buffer reuse between frames.

## 2.0.10

## 2.0.9

## 2.0.8

### Patch Changes

- Fix text padding asymmetry and background badge rendering by eliminating artificial width offsets and fixing word-wrap token width calculation.

## 2.0.7

## 2.0.6

## 2.0.5

## 2.0.4

## 2.0.3

### Patch Changes

- 51b0daf: Rendering performance for the headless / server-GPU path:

  - VRAM telemetry no longer blocks the event loop. The renderer's 5-second stats probe ran `nvidia-smi` with `execSync`; it is now sampled asynchronously and cached, so it can no longer stall the frame loop and DMA callbacks on NVIDIA hosts.
  - `renderVideo` accepts `ringCapacity` (also `FRAMEFIELDS_RING_CAPACITY`, clamped 2–8) to tune the DMA staging ring depth. The default stays at 2.
  - `renderImage` reuses render surfaces across stills instead of allocating and destroying the native render target and readback staging buffer on every call.
  - Headless video decode reuses a single RGBA staging buffer per decoder instead of allocating a full-frame buffer for every decoded frame.

## 2.0.2

## 2.0.1

## 2.0.0

## 1.4.3

## 1.4.2

## 1.4.1

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- init
