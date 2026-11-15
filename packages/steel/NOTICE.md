# Steel (fork)

This package is a fork of `@skild-ai/steel-webgpu`
(https://github.com/skild-ai/steel-webgpu, `packages/steel-webgpu`), the
WebGPU port of Newton's SolverSteel by Skild AI, at upstream commit
`f2f72c1e99aea7192cf2366eb918e630135afcf9` (2026-11-09, release 0.1.0).

Copyright 2026 Skild AI. Copyright 2025 The Newton Developers. Licensed
under the Apache License, Version 2.0 (LICENSE.md). Steel was created by
Skild AI in collaboration with NVIDIA.

Taken: `sim.js`, `wgsl.js`, `artwgsl.js`, `builder.js`, `loaders.js`, their
`.d.ts` files and `sceneTypes.ts`. Left out: the three.js and React
bindings and `device.js` (framefields requests its own device).

The upstream files keep their own style (Biome skips them) so each change
stays a small diff that can be sent upstream.

## Changes from upstream

Each change is marked `framefields:` in the source.

- A per-body extension record (`SF_BODYX`: gravity scale, linear damping,
  planar lock) read by the free-body integration and, for gravity, the
  articulation factorization (`sim.js`, `wgsl.js`, `artwgsl.js`); builder
  options `gravityScale`, `linearDamping`, `angularDamping`, `planar`.
- Run-time changes written to the solver's own tables: `setGravity`,
  `bodyMass` / `setBodyMass`, `setBodyExtension`, `lockBodyRotation`,
  `setBodyEnabled`, `setBodyCollisions` (the collision filter recomputed).
- `snapshot()` / `restore()`: the GPU state (`poses`, `vel`, `art`, `warm`),
  the clock and every run-time change; a restored Sim continues bit for bit.
- `contacts()`: the last substep's contacts (bodies, point, normal, gap);
  `state({ contacts: true })` reads both in one copy (`readAll`).
- Triangle meshes: `addShapeMesh` on static or kinematic bodies. Each
  triangle is a flat hull (two faces) for the existing SAT and MPR paths,
  in the leaf order of a BVH (`SF_BVH`); the broadphase walks it per
  overlapping shape and emits (shape, triangle) pairs, whose contacts get
  keys of their own.
- Ropes: `addRope` (a maximum distance between two anchors). Each is a
  frictionless contact row on the rope's line, emitted by the narrowphase
  after the pairs; `contacts()` leaves ropes out.
- `SceneBuilder.massOf(body)`: a body's mass before `finalize()`.
- Rounded boxes: `addShapeBox({ radius })` keeps a border radius per shape
  (the shape record's `xform.w`); the narrowphase tests the cores against
  the gap plus both radii and `emit` moves each contact to the rounded
  surfaces; mass properties are the exact rounded volume's.
- Springs: `addSpring` (rest length, stiffness, damping between two
  anchors). Two soft unilateral rows on the line, solved implicitly through
  the compliant-row path (compiled for springs; `CCOMPL` keeps contacts
  rigid unless compliance is asked for). Not inside one articulation.
- Hull vertex caps: `convexHull(points, maxVertices)` grows the hull by the
  point farthest outside it and stops at the cap; `addShapeConvexHull`
  caps mesh hulls at `MAX_HULL_VERTICES` (64, Newton's `MESH_MAXHULLVERT`)
  unless given `maxVertices`; the MJCF loader reads `<mesh maxhullvert>`
  (-1 keeps every vertex).
- The `.d.ts` files import `./sceneTypes.js` (the extensionless import did
  not resolve under NodeNext, so the scene types were `any`); `HullRef`
  gains `nv`.
- MJCF actuators: `forcerange` (with `forcelimited`, or `autolimits` as
  MuJoCo defaults) becomes the drive's `effortLimit`; before, servos such as
  the SO-101's (±3.35 N·m) drove with unbounded torque.
