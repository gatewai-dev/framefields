# Steel: one physics engine

Steel (skild-ai's rigid-body and articulation solver, Newton's SolverSteel,
ported to WebGPU) becomes framefields' only physics engine: film physics
(`Physics.world2d` / `world3d`, fracture), robots, training envs and live
pages. It solves on the device the composition renders with, in Node and in
the browser, and its batched worlds are the path to many envs per GPU.

## Decisions (2026-11-15)

- **MuJoCo is removed** (done, this branch). Robots run on `Physics.steel`.
- **Rapier goes behind the backend.** Steel implements `PhysicsBackend`
  (`physics/backend.ts`), so `world2d`, `world3d`, `Fracture3D`, the envs and
  the films keep their API. Rapier is deleted once the parity tests pass.
- **Steel is forked into the monorepo** as a private `packages/steel`, from
  `skild-ai/steel-webgpu` 0.1.0 (Apache-2.0, NOTICE kept). Missing features
  are built in the solver, not around it, and each one is offered upstream
  as a pull request. `skild-ai/steel` (Python, Newton) is the reference for
  behavior and example scenes; it cannot run in our Node + Dawn engine.

## Done

- `Physics.steel` is the robot engine: `joints` (type, offsets, dofs,
  `driven`), `action(frame)` (the drive targets that step a frame to the
  next), MJCF `<camera>`s riding their bodies (`mjcf.ts`, `world.camera`),
  meshes read from `file:` folders in Node, visual meshes of built scenes
  drawn (Steel's `finalize()` gives no `mesh()`).
- `steelEpisode` replaces `mujocoEpisode` for LeRobot v3.0 export.
- Envs `reacher` and `so101` run on Steel. The reacher's elbow range was in
  degrees by MJCF's default (±2.5°); the model now says `angle="radian"`.
- A live Steel world and an offline run of the same actions give
  bit-identical joint angles on one GPU (`interactive-render.test.ts`).
- Removed: `physics/mujoco.ts`, `mujoco-flex.ts`, their seven test files,
  `@mujoco/mujoco`, the preview's `mujoco.wasm`, `Physics.mujoco({ qpos })`.

## Done (fork and backend, 2026-11-15)

- Phase 0: `packages/steel` (upstream `f2f72c1`), framefields bundles it,
  `@skild-ai/steel-webgpu` dropped; GPU tests in `packages/steel/test`.
- Phase 1 in the solver: run-time gravity, mass, gravity scale, linear and
  angular damping, planar lock, rotation lock, enabling and collision
  toggles, `snapshot()` / `restore()` (bit for bit, tested in the same Sim
  and a new one), `contacts()`, `SceneBuilder.massOf`.
- Phase 2: `steel-backend.ts` implements `PhysicsBackend` for 3D and 2D
  (planar bodies extruded 1 m); `world2d` / `world3d` default to Steel;
  `simulate()` / `bakeKeyframes()` are async. Every physics, branching,
  fracture, determinism, truth, motion-blur, instances, dataset and envs
  test passes on Steel except the terrain collider. Notes from the port:
  contacts start in the step they act (Steel's speculative contacts stop
  bodies before the gap closes); a disabled body keeps reading its last
  state (as Rapier's); frame 0 is read back from the solver (float32).
- Two physics tests placed bodies that collided by accident; Steel resolved
  those off-center frictional impacts differently from Rapier (both lose
  energy). The tests now keep the bodies apart, as they intended.

## Done (gaps and Rapier removal, 2026-11-15)

- **Rounded boxes**: a border radius per shape. The narrowphase tests the
  cores against the gap plus both radii and `emit` moves each contact to the
  rounded surfaces; mass properties are the exact rounded volume's (checked
  against Monte Carlo). 2D bodies take the exact rounded rectangle and circle.
- **Triangle meshes** (`addShapeMesh`, static or kinematic): a flat hull per
  triangle in BVH leaf order; the broadphase walks the BVH per overlapping
  shape and emits (shape, triangle) pairs into the existing SAT / MPR paths.
  16 boxes settling on a 20,000-triangle terrain: 180 frames in 3 s,
  kernel compile included.
- **Ropes**: a frictionless contact row on the rope's line (both anchors lie
  on it, so one point gives both lever arms), gap = slack.
- **Springs**: two soft rows on the line (pull past rest, push short of it),
  solved implicitly through the compliant-row path, now compiled for springs
  without making contacts soft. A spring at ω = 300 rad/s holds at 240 steps
  a second. Not inside one articulation (its dense path has no soft rows).
- **`ccd`**: a 1 m speculative contact gap for the body.
- **One readback per step**: `state({ contacts: true })` copies state,
  stats and the contacts in one map; a larger contact count reads the rest.
- **Rapier deleted**: its backend classes, `engine`, both `@dimforge`
  packages. The terrain test and a rope test pass on Steel.

## Done (hull cap, 2026-11-16)

- **Hull vertex cap** (phase 1, 10): `convexHull` grows by the point farthest
  outside the hull and stops at `maxVertices`; mesh hulls default to 64
  (Newton's `MESH_MAXHULLVERT`), MJCF `<mesh maxhullvert>` sets one per mesh
  (-1: all). The SO-101's 13 hulls went from 768-4,236 vertices to 64, and a
  frame from ~914 ms to ~11 ms of stepping. On a 5,000-point unit sphere the
  64-vertex hull lies within 0.057 of the full one.

## Found on the SO-101 (2026-11-16)

- The MJCF loader dropped actuator `forcerange` (servos drove unbounded);
  fixed here and offered upstream (skild-ai/steel-webgpu#9).
- A light body squeezed between two links of one articulation sinks into
  them and is pushed out at default settings, upstream too
  (skild-ai/steel-webgpu#8): Gauss-Seidel converges on it at about its mass
  over the links' per sweep. The default drive also decided its effort
  clamp from the free-motion torque, so a blocked joint pushed past
  `effortLimit`.

## Done (squeeze and blocked drive, 2026-11-16)

- **Blocked drive:** past `effortLimit`, the implicit drive pushes with the
  limit (the PD torque it delivered over the last substep tells).
- **Light-body blocks:** a free body touching a link and something else has
  its rows in touch (normals, and friction against links) solved exactly
  after each position sweep, as a convex QP with the articulation's own
  coupling (NOTICE). A tilted jaw presses the cube into the floor with
  several newtons, which only friction through the 20 g cube can carry, so
  the normals alone were not enough.
- Pinch (two prismatic fingers, 10 N, a 20 g cube on a pedestal): fingers
  stop at 30.0 mm at defaults, from 18.4 mm (16.2 with 0.5 kg armature).
- SO-101 lab: picks and places the cube at Steel's defaults (4 substeps,
  12 iterations), also with warm start, 8/12 and 16/24; ~20 ms of stepping
  a frame on an M-series Mac, from ~16 without the block (and ~75 at the
  16/24 the lab needed). The fixed finger now clears the cube by 8 mm on the
  way down (at 3 mm, 16/24 rested it on the cube's edge).

## Next

1. Bench v2 with determinism per GPU (decided 2026-11-16): items carry
   their body trajectories, manifests record the adapter, cloud dataset
   jobs keep one GPU type, and a cross-GPU check compares poses within a
   tolerance and the task answers, not bytes. No CPU path.
2. Speculative restitution fires a step early (one step's travel, visible
   only with `ccd`'s wide gap): a time-of-impact split of the bounce.
3. Light-body blocks for the other friction paths (`contact_block` modes,
   torsional and rolling friction, which keep their rows in the sweep) and
   the full disk instead of its inscribed square; the caps (8 bodies, 16
   rows, 32 unknowns each) reported when hit.
4. Soft rows in the dense articulation path (springs between jointed
   bodies), and mesh-mesh pairs (two moving meshes never collide now).
5. Upstream pull requests for each `framefields:` change (NOTICE list).

## What removing MuJoCo lost (to rebuild on Steel)

Sensors (`sensordata`, touch), per-frame contact lists with forces, flexes
(cloth, soft bodies), tendons, keyframes, `initialState` branching of robot
runs, replay of recorded `qpos` through kinematics, ellipsoids, MJCF colors,
materials and textures, and the Menagerie checks against native MuJoCo
(Panda, UR5e, SO-ARM100, ALOHA, Go2). `Physics.poses` still replays body
trajectories from any simulator.

## Phase 0: the fork

1. `packages/steel`: the solver (`sim`, WGSL kernels), scene builder and
   loaders as TypeScript, with its tests; drop the three.js and React
   entries. framefields bundles it like every `@framefields/*` package, so
   `@skild-ai/steel-webgpu` leaves the optional dependencies.
2. NOTICE and license lines in `packages/framefields/NOTICE.md`.
3. A sync note: the upstream commit we forked from, and our patches as a
   list, each with its upstream PR.

## Phase 1: solver features `PhysicsBackend` needs

Each lands with a test in `packages/steel` and an upstream PR.

1. **Contacts out.** A compacted per-step contact list (shape pair, point,
   normal, normal impulse) read back with the poses, and pairs that began
   touching. Feeds `drainCollisionStarts`, `impact`, contact labels in
   `truthLabels`, robot touch sensors. Steel already keeps contacts on the GPU
   (`craw`), but has no API to read them.
2. **Snapshot and restore.** The whole solver state (body and joint state,
   warm starts, carried friction anchors, sleep) to bytes and back, so a
   world built the same way continues bit-identically. Branching
   (`keepStates` / `from`), interventions and robot `initialState`.
3. **Enable, disable and collision toggles at run time.** `vanish`,
   `passThrough`, bodies that start late, fracture swapping a body for its
   pieces.
4. **Mass, gravity and per-body gravity scale at run time** (per-body gravity
   scale is upstream PR #5232).
5. **Joints Rapier had** (done): rope, distance spring, rotation locks,
   linear and angular damping (upstream #5105 adds linear).
6. **Static triangle meshes** (done).
7. **Kinematic targets** (`setKinematicTarget`: velocity from the next pose).
8. **Sensor shapes** that touch nothing (joint anchors).
9. **Fast thin bodies:** continuous collision detection (CCD), or substep guidance with a test.
10. **Hull size** (done): convex-hull vertices capped on load (MuJoCo's and
    Newton's `maxhullvert`, 64 by default). The SO-101 went from about
    914 ms a frame to about 11 ms.
11. **Loader coverage:** MJCF `rgba`, materials and textures, `<include>`,
    `<default>` classes, sensors, tendons (in review upstream), equality
    constraints, and keyframes. URDF materials. Fix `finalize()` against its
    `LoadedScene` type.

## Phase 2: Steel behind `PhysicsBackend`

1. **An async step.** Today's interface is synchronous: `body.position()`
   between steps, `step(dt)`. On Steel, each step is GPU work plus a
   readback. The bake loop becomes async with one readback per frame. Force
   fields and impulses are computed from the last state read back and sent
   as wrenches.
2. **3D:** `SteelBackend.createWorld3D`, body specs mapped to Steel bodies,
   shapes and joints, units in meters. Interventions and fracture use phase 1.
3. **2D:** bodies held in a plane by a planar joint to the world (two linear
   axes, one angular), with shapes extruded. Or a planar mode in the solver,
   if the joint path costs too much.
4. **Parity gates:** `physics.test.ts`, `physics-render.test.ts`,
   `branch.test.ts`, `fracture-render.test.ts`, `determinism-render.test.ts`,
   `truth-render.test.ts`, and the films that use physics (28, 29 emoji,
   37 shatter) rendered and checked by eye.
5. Delete the Rapier classes and both `@dimforge` dependencies (done).

## Phase 3: envs and bench on Steel

1. `falling`, `falling-multiview`, `falling-violation`, `scenes`, `push` move
   with `world3d` (no env code changes beyond what parity needs).
2. **Determinism decision.** Rapier gave the same bytes on every machine.
   Steel gives the same bits on one GPU; across GPUs float32 results differ.
   Options: datasets byte-reproducible per GPU family, or a CPU path (Newton
   runs Steel's sweep on CPU since upstream #5150). The bench's claim
   ("byte-reproducible from fixed seeds") depends on it.
3. Rebuild the world bench as v2 (the physics changed), with new reference
   results.
4. **Interactive robots:** a reacher (and SO-101) `InteractiveEnv` with joint
   or end-effector actions. Proprioception in `Observation`, in the shared
   file and in the Gymnasium spaces (`{"pixels", "agent_pos"}`).
5. **Batched worlds:** many envs in one `Sim` (Steel's per-shape `world`),
   rendered tiled in one target with one readback per step.

## Phase 4: robotics depth

- Domain randomization of physics (mass, friction, damping, gains), camera
  and sensor noise, latency.
- Control helpers: inverse kinematics, end-effector action spaces, a gripper
  abstraction.
- Teleoperation in the preview (keys, gamepad, drag) recorded as LeRobot
  episodes.
- A LeRobot-compatible gym env and an evaluation loop: train on our data,
  score in our env.
- Reference checks against Newton's Steel (Python) on the same scenes, in
  place of the Menagerie-against-MuJoCo checks.
