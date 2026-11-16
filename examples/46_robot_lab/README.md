# 46 · SO-101 lab

The SO-101 arm (TheRobotStudio's SO-ARM100) on a dark checker floor,
simulated by Steel (a rigid-body and articulation solver on WebGPU) and
drawn by the framefields engine, live in the browser. Watch the demo pick a
cube off the floor and set it on a pad, or take the arm over with sliders
and keys; drag to orbit the camera. Both the physics and the drawing run on
your GPU: the solver steps one frame for each frame the player draws.

The model files are not shipped. Put the `Simulation/SO101` folder of
[SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100) (Apache-2.0) at
`scratch/so101` in the repository (`so101_new_calib.xml` and `assets/`); the
envs' tests read it there too.

```bash
pnpm install
pnpm --filter @framefields/example-46-robot-lab dev   # http://localhost:4646
```

Needs a browser with WebGPU (current Chrome, Edge or Safari). `dev` restarts
the server on every edit and the page reloads itself. `?colliders` draws what
the arm collides as (mesh hulls and jaw pads) in place of its meshes.

The grasp is real: the moving jaw squeezes the cube against the fixed one,
each servo limited to its 3.35 N·m, and friction holds it. It runs at Steel's
default solver settings (`SOLVER` in `src/task.ts`), about 20 ms of stepping
a frame on an M-series Mac; the page shows the pace. A 20 g cube between
links hundreds of times heavier is where Gauss-Seidel converges slowest
(skild-ai/steel-webgpu#8), so our fork of Steel solves such a body's contacts
exactly (`packages/steel/NOTICE.md`).

## What is in it

- **The arm** (`src/so101.ts`): the MJCF loaded with Steel's loader (servo
  gains and force limits from its actuators, mesh colliders as convex hulls
  of at most 64 vertices). The fixed jaw is one mesh with the gripper's
  housing, so its hull would fill the gap between the jaws; as MuJoCo
  Menagerie's SO-ARM100 does, each finger collides as a box instead
  (`withJawPads`). `reachDown` is the inverse kinematics: damped least
  squares on the MJCF's own kinematic chain, putting the point between the
  jaws at a target with them pointing as straight down as the wrist allows,
  and the roll lining the jaws up with an axis.
- **The task** (`src/task.ts`): the cube and the pad, the demo (steps whose
  goals are read from the live state when they start, so a cube that moved
  is picked where it is), the progress line and the solver settings.
- **The demo driver** (`src/demo.ts`): turns each goal (the point between
  the jaws, the line they close along, grip) into joint targets and eases
  toward them.
- **The scene** (`src/scene.ts`): `Physics.steel` stepped live
  (`world.live(comp)`), the arm drawn from its visual meshes and the task's
  objects by `world.layers()`; a floor whose checker is a WGSL shader
  projected in world space; a studio environment, a key light with soft
  shadows and a cool fill. The camera orbits a target read each frame from
  what the page sets.
- **The page** (`index.html`, `src/app.ts`): a real-time loop that advances
  the simulation with the wall clock and draws each frame, joint sliders,
  keys (`Q`/`A` pan, `W`/`S` shoulder, `E`/`D` elbow, `R`/`F` wrist, `T`/`G`
  roll, `Space` jaw), drag to orbit, scroll to zoom, and the task's
  progress. `robotLab.world` and `robotLab.controls` are on `window` for the
  devtools console (`robotLab.world.body("gripper", frame)`).

## How it is served

`src/serve.ts` calls `startPreview` with `page: "index.html"`: the preview
server bundles `src/app.ts` with the browser engine and serves it as
`/@framefields/player.js`, which the page loads. The module's default export
builds the composition (for the player); the rest of it is the page's app
code, which runs only where there is a real DOM (the server also loads the
module in Node). The model's files load by their absolute paths, which the
preview serves from the repository.

The simulation runs ten minutes of frames; Reset starts it over.
