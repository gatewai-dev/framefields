---
"framefields": minor
---

`Physics.mujoco({ mjcf, fps, frames })`: MJCF models (robots, articulated mechanisms) simulated by MuJoCo's WebAssembly build, the same run on every machine. `path` loads a model with the files beside it (meshes, includes); `layers()` draws the model's visible geoms (box, sphere, capsule, cylinder, plane, and STL/OBJ meshes, in their material colors) as layers that follow their bodies; `control` drives its actuators frame by frame; `geom(name)`, `qpos(frame)` and `contacts(frame)` read the run; `state(frame)` with `initialState` branches a new run from any frame. MuJoCo (`@mujoco/mujoco`, Apache-2.0) is an optional dependency, loaded on first use.
