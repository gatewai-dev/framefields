---
"framefields": minor
---

`comp.renderTruth(frame)`: a frame's picture with its 3D ground truth, measured by the renderer. For each raster 3D pass it returns per pixel linear depth, world normals, screen motion since the previous frame, a coverage mask, and the object (layer id and part) and instance drawn there, in f32 (normals in half precision), without anti-aliasing blending surfaces at edges. The picture is byte-identical to `renderFrame`. `SSAOPipeline` takes a `seed` and no longer uses `Math.random`, so its occlusion is the same on every run.
