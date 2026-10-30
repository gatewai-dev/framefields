---
"@framefields/vision-sam": minor
"@framefields/vision": minor
"framefields": patch
---

SAM 3 downloads the image encoder its backend runs fastest: fp16 on WebGPU and CUDA, q4 on the CPU (`SAM3_ENCODER`, override with `sam3.precision`). Providers report their backend before any download (`SessionProvider.backend()`, `sessionCompute`); the auto provider decides with a one-node probe graph and, on Linux with the NVIDIA driver, tries CUDA first. All SAM 3 trackers in a process share one encoder session and reuse its features per frame. Text-seeded objects now output and remember their seed mask on the prompt frame, as SAM does, instead of a speckled re-decode.
