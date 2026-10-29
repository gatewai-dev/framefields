# @framefields/node-compositor

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
