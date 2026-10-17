---
"@framefields/vision": patch
---

Fix duplicate pose skeletons on the GPU path: the WebGPU execution provider now runs in NCHW layout. In its default NHWC layout onnxruntime-web (1.30) computes grouped convolutions wrong when the channels per group aren't a multiple of 4, which corrupts RTMO's head (group-8 convs over 104 channels) and turned one person into several detections. Outputs now match the CPU provider on every pinned model.
