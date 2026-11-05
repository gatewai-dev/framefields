# Notice: framefields

framefields is licensed under Apache-2.0. It contains no model weights or human base assets: every vision model downloads on first use from a pinned revision into the local model cache (`~/.cache/framefields/models`) and is verified by size and SHA-256. The licenses below apply to those downloaded weights, not to framefields' code.

## Prompted tracking (SAM)

`comp.vision(clip, { sam2 | sam3 })` and `framefields/sam` track objects with Meta's Segment Anything models: SAM 2.1 (Tiny and Small) and SAM 3. That code is written for framefields and licensed under Apache-2.0; it contains no code or weights distributed by Meta. It loads only when a clip uses `sam2` or `sam3`.

| Model | Weights license | Acceptance |
| --- | --- | --- |
| SAM 2.1 Tiny / Small (Diffusion Studio ONNX exports of `facebook/sam2.1-hiera-*`) | Apache-2.0 | none |
| SAM 3 (ONNX exports of Meta's SAM 3 checkpoints) | Meta SAM License | required at runtime |

Before SAM 3 weights are downloaded or run, you must accept Meta's SAM License (https://github.com/facebookresearch/sam3/blob/main/LICENSE): pass `acceptSamLicense: true` in `comp.vision` options (or `acceptLicense: true` to `Sam3Tracker`), or set `FRAMEFIELDS_ACCEPT_SAM_LICENSE=1`. Your use of SAM 3 is then governed by that license.

## Depth

`comp.vision(clip, { depth: true })` and `withVision({ mode: "depth" })` estimate depth with Depth Anything V2 **Small** (onnx-community export of `depth-anything/Depth-Anything-V2-Small`), whose weights are Apache-2.0. The larger Depth Anything V2 checkpoints are licensed CC-BY-NC-4.0 and are not used.

## DNA characters (`framefields/dna`)

The DNA file reader and the conversion of DNA rigs (`packages/dna`) are a TypeScript port based on OpenRigLogic's DNA library (https://github.com/EpicGames/openriglogic, branch `5.8`), used under the MIT License below. "Epic Games", "MetaHuman", "RigLogic" and "OpenRigLogic" are trademarks of Epic Games, Inc.; framefields is not affiliated with or endorsed by Epic Games. No DNA files or characters ship with framefields: you load your own, under the terms they came with.

```
MIT License

Copyright (c) 2026 Epic Games, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in 
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN 
THE SOFTWARE.
```
