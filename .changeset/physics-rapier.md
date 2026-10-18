---
"framefields": minor
---

Add rigid-body physics: `Physics.world2d` / `Physics.world3d` (Rapier, deterministic) simulate once while the composition is built and replay as per-frame signals. Bodies come from layers (boxes, circles, convex hulls of shapes, measured text, Layer3D primitives and models); `simulate()` binds each layer, and every body exposes `impact`, `speed`, velocity and pose signals for driving any prop or effect. Includes ground/walls, pins, hinges, welds, springs, ropes, signal-driven forces and kinematic bodies, collision lists, and `bakeKeyframes()` for plain keyframes.

`world.field()` adds position-dependent forces (wind, vortices, flow fields). `world.live(comp)` steps a world as the composition renders instead of all at once: before each frame draws it advances to it, after that frame's inputs are ready, giving the same result as `simulate()`.

`comp.vision(clip)` analyses a clip's own frames on demand (pose keypoints and a soft silhouette) and shares the results with everything that reads them; every render path and the preview await it before drawing a frame, and results persist on disk in Node. `comp.onPrepareFrame()` registers async per-frame work, and the renderer awaits an `onRequestFrame` that returns a promise. `colorSignal` takes `multiplier` and `offset`.

`Layer.particles` adds GPU particle systems: a compute-shader simulation (emitters, curl-noise flow, attractors, gravity, drag, floors and bounds, a performer's silhouette push) drawn in one instanced call, with snapshots so scrubbing back restores state. New temporal effects: `Trails` (echoes, light painting, feedback tunnels) and `Datamosh` (pixels dragged along optical flow between keyframes).

3D `glass`, `acrylic` and `frosted` materials now refract what is behind them on screen (with dispersion, thickness, tint and studio reflections) instead of drawing as translucent plastic. Particle emitters can move: `emitter.x` / `emitter.y` take drivers, and births spread along the path between frames (light painting from a tracked hand).
