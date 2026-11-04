# @framefields/node-compositor

## 2.14.0

### Minor Changes

- 976c782: Containers no longer clip their children by default: `overflow` defaults to `"visible"`, as in CSS, so tilted badges, outside strokes and shaking titles are not cut at a parent's edge. Set `overflow: "hidden"` where children must stay inside a box, such as a rounded card holding a square header or image. Text layers also make room for their own outside stroke and shadows, which used to be cut at the text box, and scale or rotate around their anchor within that room.
- 976c782: Add opt-in geometry-aware scene outlines and art-directed toon lighting for meshes, 3D cards and native text. Outline widths scale with export resolution; exclusions retain occlusion, and ink follows fog before camera depth blur and bloom. Toon materials now use colored direct lights, point/spot attenuation and cast shadows, with configurable shadow/lit colors and terminators. Correct 3D card pivot transforms so changing an anchor does not move identity geometry.

  Shade ink before the MSAA color resolve to preserve subpixel coverage between outlined surfaces. Custom cube-face artwork inherits surface settings while retaining explicit face overrides.

### Patch Changes

- 01954c0: 3D scenes render in isolation. A box with a fixed size that holds a camera is its own scene: its camera, lights and environment see only its layers, it runs on its own clock, and it is placed like a picture, so `Layer.sequence` transitions between 3D scenes blend two finished pictures instead of drawing both through one camera. Signal tracks take `{ clock: "layer" }` to sample at the layer's own frame. `comp.lint()` reports `duplicate_id`. Per-pass 3D buffers are recycled once per frame (per command encoder), so a frame holding several 3D scenes never reuses a buffer an earlier pass still reads, and bloom mip chains live until the frame is done. Size-dependent 3D render targets (depth, HDR, MSAA, reflections) are cached per size and kept for the frame, so scenes of different sizes can share a frame.

## 2.13.1

## 2.13.0

## 2.12.0

## 2.11.0

## 2.9.3

## 2.9.2

## 2.9.0

## 2.8.1

### Patch Changes

- 7a1bac8: Support variable numbers of direct lights and skin joints, and render independent shadows for multiple directional and spot lights.
- 1da767d: Batch compatible repeated opaque meshes into hardware-instanced draws while preserving individual transforms.

## 2.8.0

### Patch Changes

- b5c6470: Sort blended 3D meshes across the scene and render them without depth writes. Apply glTF base-color alpha once.
- e96a32f: Render model and procedural mesh wireframes as triangle edges, including animated and shadow-casting meshes.
- 9609991: Render all glTF primitive modes, per-map UV sets and transforms, sparse accessors, animated morph targets, Draco or meshopt compressed geometry, and ETC1S/UASTC KTX2 textures. Reject unsupported required glTF extensions explicitly.

## 2.7.0

### Minor Changes

- 18aece7: Add forward and reverse media time remapping for video and audio layers, including smooth ramps, video holds, silent audio holds, source range checks and clip vision synchronization. Reverse video decoding uses a bounded frame cache.

## 2.6.2

## 2.6.1

## 2.6.0

## 2.5.5

### Patch Changes

- demos

## 2.5.4

## 2.5.3

### Patch Changes

- docs-fixes

## 2.5.2

## 2.5.1

## 2.5.0

## 2.4.3

## 2.4.2

## 2.4.1

## 2.4.0

## 2.3.2

## 2.3.1

## 2.3.0

## 2.2.0

## 2.2.0-beta.4

## 2.2.0-beta.3

## 2.2.0-beta.2

## 2.2.0-beta.1

## 2.2.0-beta.0

## 2.1.3

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

## 2.0.7

## 2.0.6

## 2.0.5

## 2.0.4

## 2.0.3

## 2.0.2

## 2.0.1

## 2.0.0

## 1.4.3

## 1.4.2

## 1.4.1

### Patch Changes

- Fix issues from the 1.4.0 friction report:

  - Published types no longer import unpublished `@framefields/*` packages, so signal APIs, `frameSignal`/`timeSignal`/`progressSignal` and layer option types are fully typed instead of `any`. A build check now guards against regressions.
  - `Layer.cube`, `carousel3d`, `prism3d` and `extrudedText` no longer leak `faces`/`items` into the spec, so `CompositorProgramSchema` accepts them.
  - `scale` (and `scaleX`/`scaleY`/`scaleZ`) now applies to preserve-3d containers such as `Layer.cube`.
  - `renderVideo({ outputPath })` returns `outputPath` as `filePath` and removes the temp file.

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- init
