---
"@framefields/vision": patch
---

Fix duplicate pose skeletons on the GPU path. In its default NHWC layout, onnxruntime-web (1.30)'s WebGPU execution provider computes grouped convolutions wrong when a group has more than one channel and the count isn't a multiple of 4. That corrupts RTMO's head (18 channels per group) and turned one person into several detections. Models with such a convolution (RTMO) now run in NCHW layout; the others (RTMDet-Ins, Selfie, whose grouped convolutions are depthwise) keep NHWC, which is about 30% faster. Outputs match the CPU provider on every pinned model.

Vision now reports its inference backend once per process, and the renderer logs it: `[vision] Inference on the GPU (WebGPU)` with `sharedDevice`, or `[vision] Inference on the CPU` with the reason.
