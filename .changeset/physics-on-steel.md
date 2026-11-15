---
"framefields": major
---

`Physics.world2d` and `Physics.world3d` run on Steel, skild-ai's GPU solver (forked into framefields), on the device the composition renders with. `world.simulate()` and `world.bakeKeyframes()` are now async: `await` them before rendering; reading a body's signal before the run throws instead of simulating on the spot. 2D worlds are planar 3D bodies, so masses and inertias stay the 2D ones. Rapier and its optional `@dimforge` dependencies are removed, with the `engine` option. Ropes, implicit springs (stiff ones stay stable; not between bodies joined by hinges or welds), rounded boxes and triangle-mesh colliders for fixed and kinematic bodies (terrain, SDF, clay) are solved by Steel; `ccd: true` widens a fast body's speculative contacts to 1 m. Model hulls are capped at 64 vertices (Newton's default), the hull of the points that stand out most. Runs repeat exactly on one GPU rather than across machines.

Steel itself gains run-time gravity, mass, gravity scale, linear damping, planar and rotation locks, enabling and collision toggles, full-state snapshots (`sim.snapshot()` / `restore`, bit for bit) and a contact readback (`sim.contacts()`). Mesh hulls are capped at 64 vertices unless `maxVertices` (or MJCF `maxhullvert`) says otherwise, which makes the SO-101 step about 80 times faster (11 ms a frame).
