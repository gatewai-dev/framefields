---
"framefields": minor
---

Render runs from other simulators: `Physics.poses({ fps, bodies, axes })` replays per-frame body positions and quaternions (z-up or y-up meters, or scene px) as pose signals, and `track.follow(name, layer)` makes a layer follow one; `Physics.mujoco({ qpos })` poses an MJCF model from recorded joint positions through MuJoCo's kinematics. MuJoCo models now draw ellipsoids, and material textures on planes (with `texrepeat` / `texuniform`) and on meshes with texture coordinates. MuJoCo geom poses and contacts are now read at the state each frame ends on (they were one substep behind).
