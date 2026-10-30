---
"@framefields/vision": minor
"@framefields/vision-sam": minor
"framefields": minor
"@framefields/node-vision": patch
"@framefields/webgpu-renderers": patch
---

Add prompted SAM 2.1 Tiny and SAM 3 / 3.1 video segmentation and semantic text selection to clip vision, decoupled into a dedicated `@framefields/vision-sam` package under the Meta SAM License. Includes temporal memory, point/box corrections, semantic text selection, cached frame seeking, and time-remapped matte reuse. Selected-object masks, geometry, motion, and optional matched pose are exposed through standard vision signals. Model assets download dynamically at runtime to local cache with SHA-256 verification upon explicit license agreement.
