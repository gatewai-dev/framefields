---
"framefields": minor
---

`Physics.steel`: rigid bodies and articulated robots solved on the GPU by skild-ai's Steel (Newton's SolverSteel on WebGPU), on the device the composition renders with, in Node and in the browser player. `build(scene, load)` adds the scene with Steel's `SceneBuilder` or its MJCF / URDF / USDA loaders (Node gets a small XML reader for them); `control` sets joint targets and body poses, twists and wrenches before each frame; `await world.simulate()` or `world.live(comp)`; `world.layers({ style })` draws the shapes and visual meshes following their bodies, with a material per shape; `world.body`, `joint` and `state` read the run back. A run whose solver buffers fill (crowded shapes with Steel's default 10 cm contact gap) now throws instead of dropping contacts. The rendering device also requests the compute limits and `subgroups` feature Steel uses, when the adapter has them.
