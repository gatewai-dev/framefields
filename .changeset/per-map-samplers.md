---
"framefields": patch
---

glTF material maps (normal, metallic-roughness, occlusion, emissive) sample with their own samplers instead of the base color's, so a tiling detail map repeats under a clamped base color, and wrap modes apply per axis. Camera `x` / `y` / `z` keyframe tracks now move the camera (they were shadowed by its static position).
