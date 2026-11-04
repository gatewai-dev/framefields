---
"@framefields/compositions": minor
"@framefields/node-compositor": patch
"@framefields/webgpu-renderers": patch
"framefields": minor
---

3D scenes render in isolation. A box with a fixed size that holds a camera is its own scene: its camera, lights and environment see only its layers, it runs on its own clock, and it is placed like a picture, so `Layer.sequence` transitions between 3D scenes blend two finished pictures instead of drawing both through one camera. Signal tracks take `{ clock: "layer" }` to sample at the layer's own frame. `comp.lint()` reports `duplicate_id`. Per-pass 3D buffers are recycled once per frame (per command encoder), so a frame holding several 3D scenes never reuses a buffer an earlier pass still reads, and bloom mip chains live until the frame is done. Size-dependent 3D render targets (depth, HDR, MSAA, reflections) are cached per size and kept for the frame, so scenes of different sizes can share a frame.
