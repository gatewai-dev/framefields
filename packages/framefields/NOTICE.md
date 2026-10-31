# Notice: framefields

framefields is licensed under Apache-2.0. It contains no model weights: every vision model downloads on first use from a pinned revision into the local model cache (`~/.cache/framefields/models`) and is verified by size and SHA-256. The licenses below apply to those downloaded weights, not to framefields' code.

## Prompted tracking (SAM)

`comp.vision(clip, { sam2 | sam3 })` and `framefields/sam` track objects with Meta's Segment Anything models: SAM 2.1 (Tiny and Small) and SAM 3. That code is written for framefields and licensed under Apache-2.0; it contains no code or weights distributed by Meta. It loads only when a clip uses `sam2` or `sam3`.

| Model | Weights license | Acceptance |
| --- | --- | --- |
| SAM 2.1 Tiny / Small (Diffusion Studio ONNX exports of `facebook/sam2.1-hiera-*`) | Apache-2.0 | none |
| SAM 3 (ONNX exports of Meta's SAM 3 checkpoints) | Meta SAM License | required at runtime |

Before SAM 3 weights are downloaded or run, you must accept Meta's SAM License (https://github.com/facebookresearch/sam3/blob/main/LICENSE): pass `acceptSamLicense: true` in `comp.vision` options (or `acceptLicense: true` to `Sam3Tracker`), or set `FRAMEFIELDS_ACCEPT_SAM_LICENSE=1`. Your use of SAM 3 is then governed by that license.
