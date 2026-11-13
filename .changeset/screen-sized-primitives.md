---
"framefields": patch
---

Spheres, cylinders, capsules and tori choose their segment counts from their size on screen each frame (camera depth, zoom, scale and output height), so large or close ones keep a smooth outline instead of showing the fixed 32-segment facets. Small ones keep the old counts; counts you set are kept; meshes come in power-of-two steps and are cached.
