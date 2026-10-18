---
"framefields": minor
---

Add rigid-body physics: `Physics.world2d` / `Physics.world3d` (Rapier, deterministic) simulate once while the composition is built and replay as per-frame signals. Bodies come from layers (boxes, circles, convex hulls of shapes, measured text, Layer3D primitives and models); `simulate()` binds each layer, and every body exposes `impact`, `speed`, velocity and pose signals for driving any prop or effect. Includes ground/walls, pins, hinges, welds, springs, ropes, signal-driven forces and kinematic bodies, collision lists, and `bakeKeyframes()` for plain keyframes.

`world.field()` adds position-dependent forces (wind, vortices, flow fields). `comp.trackPerson(source)` tracks a performer before rendering — smoothed pose keypoints and a soft silhouette per frame, placeable into composition pixels and cacheable as JSON — so limbs can be kinematic colliders and the silhouette a force field.
