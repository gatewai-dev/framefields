---
"framefields": minor
---

`framefields/forge`: build rigged characters in code. `GltfDocument` writes GLB files with PBR materials and Khronos material extensions, skins, named morph targets and clips; `humanoidSkeleton` places a proportioned Mixamo-named skeleton that `pose`, `aim` and pose retargeting drive unchanged; `Skeleton` builds any rig with chains and mirroring; `boneGizmo` draws a rig as bones.

glTF base colors now load in the right color space: `baseColorFactor` is linear in glTF and was used as a display color, so tinted glTF materials rendered darker than authored.
