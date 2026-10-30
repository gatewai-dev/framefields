---
"@framefields/vision": minor
"framefields": minor
"@framefields/node-vision": patch
"@framefields/webgpu-renderers": patch
---

Add prompted SAM 2.1 Tiny video segmentation to clip vision, including temporal memory, point/box corrections, cached frame seeking and time-remapped matte reuse. Selected-object masks, geometry, motion and optional matched pose are available through the existing vision signals. Model assets are lazily downloaded and verified, and ONNX session providers support named float and integer multi-input graphs.
