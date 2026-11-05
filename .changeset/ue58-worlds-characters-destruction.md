---
"framefields": minor
---

3D worlds, characters and destruction. `Layer3D.terrain`, `Layer3D.sdf` and `Layer3D.scatter` (with wind) build procedural landscapes, smooth-CSG sculptures and scattered foliage, and any layer (video, image, layout) can texture a 3D mesh. glTF models blend clip layers and take two-bone IK, look-at and spring bones, and `Layer3D.instances` plays skinned crowds in one draw call. `world.fracture(node, options)` shatters a solid, extruded text or model into Voronoi pieces that break on impact or at a frame. `Layer.camera({ motionBlur })` adds per-object shutter motion blur from a velocity buffer, covering skinned joints, instances, swarms and fractured pieces, and renders the same frame in order or after a seek.
