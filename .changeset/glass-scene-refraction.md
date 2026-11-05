---
"framefields": minor
---

Glass refracts the 3D scene behind it, not only the layers under the 3D batch. glTF materials with `KHR_materials_transmission` render as glass with their IOR, bending by their `KHR_materials_volume` thickness through the refracted ray, so the bend follows the object's size on screen.

Joint drivers (`drive: [{ joint, from, rotate: { x, y, z } }]`): a joint turns by a share of another joint's turn, after look-ats and before IK. Model files carry their own drivers (forge's `GltfDocument.addDriver`).
