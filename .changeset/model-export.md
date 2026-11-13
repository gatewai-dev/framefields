---
"framefields": minor
---

`comp.exportModel({ frame, outputPath })` and `framefields render <name> --model [--frame n]` write a frame's 3D scene as glTF 2.0 binary (`.glb`), the format Blender, Maya, Unreal, Unity and the web open. The file holds what the frame draws: meshes in their pose (morphs and skins applied, clay and SDF sculptures as triangles), layers on 3D planes as textured quads, instances as nodes sharing one mesh, PBR materials with their maps and Khronos extensions, the camera and the lights, in meters with y up. `skipped` lists what a frame drew that glTF cannot carry.
