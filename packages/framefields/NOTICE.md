# Notice: framefields

framefields is licensed under Apache-2.0. It contains no model weights or human base assets: every vision model downloads on first use from a pinned revision into the local model cache (`~/.cache/framefields/models`) and is verified by size and SHA-256. The model sections below apply to those downloaded weights; the last section lists third-party code framefields includes.

## Prompted tracking (SAM)

`comp.vision(clip, { sam2 | sam3 })` and `framefields/sam` track objects with Meta's Segment Anything models: SAM 2.1 (Tiny and Small) and SAM 3. That code is written for framefields and licensed under Apache-2.0; it contains no code or weights distributed by Meta. It loads only when a clip uses `sam2` or `sam3`.

| Model | Weights license | Acceptance |
| --- | --- | --- |
| SAM 2.1 Tiny / Small (Diffusion Studio ONNX exports of `facebook/sam2.1-hiera-*`) | Apache-2.0 | none |
| SAM 3 (ONNX exports of Meta's SAM 3 checkpoints) | Meta SAM License | required at runtime |

Before SAM 3 weights are downloaded or run, you must accept Meta's SAM License (https://github.com/facebookresearch/sam3/blob/main/LICENSE): pass `acceptSamLicense: true` in `comp.vision` options (or `acceptLicense: true` to `Sam3Tracker`), or set `FRAMEFIELDS_ACCEPT_SAM_LICENSE=1`. Your use of SAM 3 is then governed by that license.

## Depth

`comp.vision(clip, { depth: true })` and `withVision({ mode: "depth" })` estimate depth with Depth Anything V2 **Small** (onnx-community export of `depth-anything/Depth-Anything-V2-Small`), whose weights are Apache-2.0. The larger Depth Anything V2 checkpoints are licensed CC-BY-NC-4.0 and are not used.

## Alpha matting

`comp.vision(clip, { matting: true })` and `VisionRunner.refineMatte` resolve mask edges with ViTMatte **Small** trained on Distinctions-646 (Xenova ONNX export of `hustvl/vitmatte-small-distinctions-646`). Its weights are Apache-2.0 and the ViTMatte code is MIT.

## Third-party code: the path tracer

`environment.pathTrace` (`packages/webgpu-renderers/src/pathtracer`) ports parts of MuTracer (https://github.com/pissang/mutracer): the binned SAH BVH builder (`bvh.ts`, itself a port of TinyBVH's reference builder, https://github.com/jbikker/tinybvh), and the WGSL of the Owen-scrambled Sobol sampler (Burley 2020, "Practical Hash-based Owen Scrambling") and the watertight ray/triangle test (`trace.wgsl.ts`; Woop, Benthin and Wald 2013, as implemented in pbrt-v4, https://github.com/mmp/pbrt-v4, Apache-2.0). Both projects are MIT licensed:

### MuTracer

```
MIT License

Copyright (c) 2022-present Yi Shen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### TinyBVH

```
MIT License

Copyright (c) 2024-2026, Jacco Bikker / Breda University of Applied Sciences.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
