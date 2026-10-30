# Notice: @framefields/vision-sam

This package provides prompted video tracking for framefields with Meta's Segment Anything models: SAM 2.1 (Tiny and Small) and SAM 3. Its source code is written for framefields and, like the rest of framefields, licensed under Apache-2.0; it contains no code or weights distributed by Meta. The licenses below apply to the model weights it downloads.

## Model weights

No model weights ship in this package or in any framefields package. Each model is downloaded on first use from a pinned Hugging Face revision into the local model cache (`~/.cache/framefields/models`), and verified by size and SHA-256.

| Model | Weights license | Acceptance |
| --- | --- | --- |
| SAM 2.1 Tiny / Small (Diffusion Studio ONNX exports of `facebook/sam2.1-hiera-*`) | Apache-2.0 | none |
| SAM 3 (ONNX exports of Meta's SAM 3 checkpoints) | Meta SAM License | required at runtime |

## Accepting the SAM License

Before SAM 3 weights are downloaded or run, you must accept Meta's SAM License (https://github.com/facebookresearch/sam3/blob/main/LICENSE): pass `acceptLicense: true` to `Sam3Tracker` (or `acceptSamLicense: true` in `comp.vision` options), or set `FRAMEFIELDS_ACCEPT_SAM_LICENSE=1`. Your use of SAM 3 is then governed by that license.

`framefields` loads this package only when a clip uses `sam2` or `sam3`; it is an optional peer dependency, so projects that do not use SAM never install it.
