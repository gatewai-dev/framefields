# 46 · Robot lab

A white robot arm on a dark checker floor, simulated by Steel (a rigid-body
and articulation solver on WebGPU) and drawn by the framefields engine, live
in the browser. Pick a scene, watch the demo work it, or take the arm over
with sliders and keys; drag to orbit the camera. Both the physics and the
drawing run on your GPU: the solver steps one frame for each frame the
player draws.

```bash
pnpm install
pnpm --filter @framefields/example-46-robot-lab dev   # http://localhost:4646
```

Needs a browser with WebGPU (current Chrome, Edge or Safari). `dev` restarts
the server on every edit and the page reloads itself.

## The scenes

`?scene=` picks one; the tabs on the page link to each.

- **Pick and place** (`lift`): a block off the floor onto a pedestal.
- **Stack** (`stack`): a tower of three blocks.
- **Peg in cup** (`cup`): a peg dropped into a square cup.
- **Stack on gravel** (`gravel`): two blocks stacked on a bed of 49 loose
  chips and balls in a tray. The heaviest scene (about 40 ms a frame on an
  M1 Pro); the page shows when the simulation runs slower than real time.

Grasps are real: the gripper's fingers squeeze and friction holds what they
hold.

## What is in it

- **The arm** (`src/arm.ts`): six axes (base yaw, shoulder, elbow, wrist
  pitch and roll) and a parallel gripper, built in code with Steel's
  `SceneBuilder`, driven by joint targets. `reachDown` is a two-link inverse
  kinematics for the hand pointing straight down.
- **The scenes** (`src/scenarios.ts`): each one's objects, its demo (steps
  whose goals are read from the live state when they start, so a block that
  moved is picked where it is) and its progress line. Small, crowded shapes
  get a 1 cm contact `gap` instead of Steel's default 10 cm, which would fill
  the solver's buffers.
- **The demo driver** (`src/demo.ts`): turns each goal (fingertips' point,
  the line through the fingers, grip) into joint targets and eases toward
  them.
- **The scene** (`src/scene.ts`): `Physics.steel` stepped live
  (`world.live(comp)`), its shapes drawn by `world.layers()` with a material
  per body (gloss white arm, satin graphite fingers, matte gravel); a floor
  whose checker is a WGSL shader projected in world space; a studio
  environment, a key light with soft shadows and a cool fill. The camera
  orbits a target read each frame from what the page sets.
- **The page** (`index.html`, `src/app.ts`): a real-time loop that advances
  the simulation with the wall clock and draws each frame, scene tabs, joint
  sliders, keys (`Q`/`A` yaw, `W`/`S` shoulder, `E`/`D` elbow, `R`/`F` wrist,
  `T`/`G` roll, `Space` grip), drag to orbit, scroll to zoom, and the scene's
  progress. `robotLab.world` and `robotLab.controls` are on `window` for the
  devtools console (`robotLab.world.body("hand", frame)`).

## How it is served

`src/serve.ts` calls `startPreview` with `page: "index.html"`: the preview
server bundles `src/app.ts` with the browser engine and serves it as
`/@framefields/player.js`, which the page loads. The module's default export
builds the composition (for the player); the rest of it is the page's app
code, which runs only where there is a real DOM (the server also loads the
module in Node).

The simulation runs ten minutes of frames; Reset starts it over.
