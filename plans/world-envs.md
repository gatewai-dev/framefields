# World environments

Training and evaluation environments for world models and visual agents, built
on the engine: seeded 3D and physics scenes, ground truth for every frame,
checkable tasks, headless and reproducible.

## Guardrail: the video pipeline does not change

- Everything is opt-in. A render that does not ask for ground truth runs the
  same passes, pipelines and shaders as today, and its pixels stay identical.
- New outputs ride the existing capture pattern (`NodeRenderProps.scene3d`,
  used by `exportModel`): a capture object the compositor feeds when present.
- Shared shader structs and pipeline layouts only change where the color pass
  provably renders the same; the render-conformance and per-feature render
  tests in `packages/framefields` gate every step.
- Task, dataset and scoring code live in a new package (`packages/envs`), not
  in the SDK surface, until the API settles.

## Phase 1: ground truth (engine)

1. **Determinism.** Seed every random source in the render path (`SSAOPipeline`
   done: `seed`, mulberry32 via `createRandom`). Audit the rest (path tracer
   sample seed, particles, procedural). Test: same composition, same output
   hash on two renders.
2. **Truth passes.** `comp.renderTruth(frame)` returns per-pixel layers
   alongside RGB, for the 3D passes of the frame (`NodeRenderProps.truth`,
   `Scene3DTruthReader`):
   - `depth`, `motion`, `mask`: the velocity pass of motion blur, drawn again
     into an f32 target (`TRUTH_MOTION_FORMAT`, own pipelines per format), with
     the motion history primed after a seek.
   - `normal`: the geometry target (`geometryPixel`) forced on, its MSAA
     samples kept and resolved nearest-sample (`Renderer3D.truthGeometry`).
   - `object`, `instance`: an `rg32uint` second target of the truth pass
     (`fs_*_truth` entry points); a draw's id rides in the velocity camera's
     `viewport.z`, and `objects` maps ids to layer id, kind and part.
   - `semantic`: a class per layer (`meta` on the layer), resolved from
     `instance` on the CPU.
   Lossless outputs: float buffers (NPZ / EXR), never the video encoder.
3. **Labels.** `comp.annotations(frame)`: camera intrinsics and extrinsics,
   each object's pose, velocity, 2D and 3D boxes, visible fraction, physics
   contacts (from `Recording`). CPU-side state, exact on every GPU.

## Phase 2: scenes and tasks (`packages/envs`)

4. **Scenario sampler.** Distributions over objects, materials, lights,
   cameras and textures + seed → `Composition`. Built from procedural 3D,
   clay, primitives and the library.
5. **Robots.** On Steel since 2026-11-15 (`plans/steel.md`); until then `Physics.mujoco`: MJCF → geoms as
   Layer3D primitives, actuator `control`, `state(frame)` / `initialState`
   branching, contacts, mesh geoms and materials; loads SO-101
   (TheRobotStudio SO-ARM100, `Simulation/SO101/scene.xml`) in 1.3 s.
   Textures (2D, planes and textured meshes), ellipsoids, and the
   pose-import bridge (`Physics.poses`, `Physics.mujoco({ qpos })`) for labs
   running their own simulator are in. Rapier stays for film physics.
6. **Physics branching and interventions.** `world.snapshot()/restore()`
   (Rapier snapshots) for rollouts and counterfactuals; interventions at a
   frame (teleport, gravity change, pass-through, vanish, mass change) for
   labeled violations.
7. **Multi-view.** One physics state rendered from N cameras, labels per view.
8. **Tasks and scoring.** Predict-next-frames, find-the-violation,
   reconstruct-the-scene (answers as the JSON program schema in
   `packages/compositions/program/schema.ts` + lint, never executed TS).
   GPU metrics: PSNR/SSIM, depth error, mask IoU, pose error.
9. **Dataset writer.** WebDataset / Hugging Face shards; cloud fan-out over
   seed ranges through the existing split-render plan.

## Phase 3: interactive (after design partners ask)

10. `step(action) → observation`: impulses mid-run, one frame rendered without
   rebuilding frame media, many environments batched per GPU.
11. Python client (Gymnasium env) over JSON-RPC with frames in shared memory.

## Status

- [x] Branch `feat/world-envs` from `main`
- [x] SSAO kernel and noise seeded
- [x] Determinism audit and hash test (`determinism-render.test.ts`)
- [x] Truth passes: depth, normal, motion (`comp.renderTruth`, `truth-render.test.ts`)
- [x] Truth passes: object and instance ids
- [x] Semantic classes (`label` on any layer; see below)
- [x] MuJoCo spike (`Physics.mujoco`, `mujoco.test.ts`, `mujoco-render.test.ts`)
- [x] MuJoCo mesh geoms; SO-101 loads and renders
- [x] Annotations (`truthLabels`: camera intrinsics/extrinsics, per object pixels, 2D/3D/projected boxes)
- [x] Dataset writer (`packages/envs`: WebDataset shards, `truth.npz`, dataset card; ~1.1 MB and ~11 samples/s at 640×480)
- [x] Envs: `falling`, `falling-multiview`, `so101`; task: recreate the scene (`tasks/recreate.ts`)
- [x] Visible fraction (`renderTruth({ amodal: true })`), semantic classes (`label` on any layer), interventions (`world.at(frame)`), Rapier branching (`keepStates` / `state` / `from`); env `falling-violation` + task `find-violation`
- [x] MuJoCo ellipsoids and textures (2D material textures on planes and textured meshes); geom poses read at each frame's final state
- [x] Pose-import bridge: `Physics.poses` (any simulator's body trajectories, z-up / y-up / scene axes) and `Physics.mujoco({ qpos })` (recorded joint positions through MuJoCo kinematics)
- [x] Scenario sampler (`packages/envs/src/sampler.ts`: spec of distributions → seeded params → scene; `scenario(spec)` is an Env); envs `scenes`, `scenes-multiview`
- [x] Tasks and metrics: predict-next (`tasks/predict.ts`: poses scored by tolerance share and position/rotation error, frames by PSNR/SSIM per horizon frame); SSIM in recreate (`metrics.ts`, CPU)
- [x] Fan-out: `generate --part i/n` (a worker's seed slice, own shards + manifest), `generate card` (merge, check, card), `--jobs n` (local processes); parts are byte-identical to a single run
- [x] Program documents: `comp.toProgram()` / `Composition.fromProgram()` (validated JSON, byte-identical round trip; the validator now knows `model3d`, `camera`, `light`); task `recreate-program` (answers as program layouts, scored by IoU/PSNR/SSIM/depth plus lint findings)
- [x] MuJoCo cube textures (by face) and 2D textures projected onto primitives
- [x] Cloud datasets: `framefields/datasets` (published subpath: Env, `generateDataset`, `finishDataset`, parts, metrics); render service `kind: "dataset"` (parts and `finish`); API dataset jobs (branch `feat/dataset-jobs` in the API repo: parts → card, presigned keys, $1/part hold, GPU-second billing); `renderCloud({ dataset })`; envs `--cloud --parts n`. Not deployed.
- [x] Phase 3: live worlds take actions for frames not stepped yet (impulses, interventions), MuJoCo `live(host)`; `InteractiveEnv` + `EnvSession` (`reset` / `step`, byte-reproducible); `serveEnvs` (JSON lines on stdio, frames in a mapped file, N envs per handle, `null` = not stepped); env `push`; Python client (`EnvServer`, `EnvBatch`) and Gymnasium wrappers (`FramefieldsEnv`, `FramefieldsVectorEnv`, next-step autoreset). ~5 ms per step at 128×128; ~270 env-steps/s from Python with 8 envs. Gymnasium wrappers pass their test with Gymnasium 1.4.0.
- [x] Robotics gaps: MuJoCo records qvel / act / ctrl / action / sensordata with joint, actuator and sensor names; contacts gathered from every MuJoCo step with peak normal force (a hit between frames counts); steps as mj_step2 + mj_step1 so recorded state is the frame's own; MJCF `<camera>`s as scene cameras (wrist cameras ride their body; straight-down works); tendons drawn; truth pass now drops back faces of one-sided meshes as the color pass does (a camera inside a solid); LeRobot v3.0 writer (Parquet, H.264 per camera, episodes packed per data / video file up to `dataFileSizeMb` / `videoFileSizeMb` as LeRobot's recorder, joined with `stitchChunks`, meta) + `mujocoEpisode`; env `reacher`, `pnpm lerobot`; verified with pyarrow, pandas, Hugging Face `datasets`, ffprobe and LeRobot 0.7's own `LeRobotDataset` (decoding across packed episodes, `delta_timestamps`)
- [x] Menagerie robots: Panda, UR5e, SO-ARM100, ALOHA (its six cameras), Go2 load, render with meshes and textures, and match native MuJoCo 4.0.1 to ~1e-15 over 100 frames; `keyframe` option (Menagerie's "home"), `qvel` in `control`'s state (PD for torque robots like Go2); `MUJOCO_MENAGERIE=<checkout>` runs `mujoco-menagerie-render.test.ts`. Not drawn: MJCF skyboxes and lights (the scene's own lights apply)
- [x] World bench v1 (`packages/envs/src/bench/`): 714 test items over four tasks (violation 200, predict 100, recreate 100, spatial 314) from fixed seeds 900000+, byte-reproducible; reference scorer; static baseline; Claude runner; Python package `framefields-envs` (pip-ready: wheel + sdist pass twine, clean installs on 3.11 / 3.14) with `framefields_envs.bench` (scorers agree with the TS ones item by item) and the Hub export (parquet per task + card with results)
- [x] MuJoCo removed; robots on Steel (`Physics.steel`: joints, actions, MJCF cameras; `steelEpisode`; `reacher`, `so101`). Rapier removed too: film physics runs on a fork of Steel behind `PhysicsBackend` (`plans/steel.md`). The MuJoCo items above describe the engine as it was.
- [ ] Publish: create the Hugging Face dataset repo and upload the exported folder (needs the account and approval); publish `framefields-envs` to PyPI
