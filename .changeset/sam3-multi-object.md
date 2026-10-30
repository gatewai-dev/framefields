---
"@framefields/vision-sam": minor
"@framefields/vision": patch
"framefields": minor
---

SAM 3 tracks several objects at once: `sam3.maxObjects` lets a text prompt select up to N instances (tracks 1…N by score) through one encoder pass per frame, and points prompts take `object` to seed or correct one track. `comp.vision` publishes every track in `signals.objects` and `signals.masks`; the clip matte is their union. Fixes concurrent `comp.vision` clips of one source dropping decoded frames (each clip now owns its decoder) and concurrent ORT WebGPU session creation falling back to the CPU (creation is serialized; SAM trackers share the process provider).
