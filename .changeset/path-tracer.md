---
"framefields": patch
---

`Layer.environment(..., { pathTrace: true })` path traces the 3D scene instead of rasterizing it: shadows, reflections of anything (off screen too), refraction through glass, occlusion, bounce light and glowing surfaces that light their surroundings, lit by the same lights, environment, floor, exposure, tone mapping, fog and bloom. Pick a preset with `pathTrace: { quality: "draft" | "standard" | "high" | "reference" }` (default `"high"`: 128 samples, 8 bounces) or set `samples`, `bounces`, `transmissionBounces`, `denoise`, `clamp`, `filterGlossy` and `textureSize` yourself. Glass has its own bounce budget (`transmissionBounces`), so thick glass such as a vase or a lamp globe stays clear, and glass from a model keeps its own roughness. `filterGlossy` softens light that reaches matte surfaces by way of shiny ones, which would otherwise sparkle and shimmer in video; `reference` leaves it off and stays unbiased.

A render takes exactly `samples` per pixel whatever the GPU, so frames are deterministic and the pieces of a split cloud render match; work is cut into small dispatches so slow GPUs never hit a driver timeout. The preview instead spends `previewBudgetMs` of GPU time per frame (default 33), measured with timestamp queries, tracing fewer samples or at a lower resolution on slower GPUs.

Not traced yet, and named in an error when present: text drawn on a 3D plane (use `Layer3D.extrudedText`), toon, track mattes, reliefs, triplanar textures, wireframes, instanced scatter / swarms / crowds, wind and audio deformation. `framefields check` flags `pathTrace` combined with `ssr` / `gi`, `outlines`, `volumetricFog` or a cube camera.

The BVH builder and parts of the sampling and intersection code are ported from MuTracer and TinyBVH (MIT); see NOTICE.md.
