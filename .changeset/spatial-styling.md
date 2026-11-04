---
"@framefields/core": minor
"@framefields/compositions": minor
"@framefields/webgpu-renderers": minor
"@framefields/node-compositor": minor
"framefields": minor
---

Add opt-in geometry-aware scene outlines and art-directed toon lighting for meshes, 3D cards and native text. Outline widths scale with export resolution; exclusions retain occlusion, and ink follows fog before camera depth blur and bloom. Toon materials now use colored direct lights, point/spot attenuation and cast shadows, with configurable shadow/lit colors and terminators. Correct 3D card pivot transforms so changing an anchor does not move identity geometry.

Shade ink before the MSAA color resolve to preserve subpixel coverage between outlined surfaces. Custom cube-face artwork inherits surface settings while retaining explicit face overrides.
