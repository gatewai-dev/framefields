---
"framefields": minor
---

Interactive environments for agents: `InteractiveEnv` and `EnvSession` in `framefields/datasets` run episodes (`reset(seed)`, `step(action)`) of a scene whose physics steps live, rendering each step's frame (and optionally depth and object ids) as the observation; the same seed and actions give the same bytes. `serveEnvs` serves envs to another process as JSON lines with frames in a shared file (a Python client with Gymnasium wrappers lives in the repo). Live physics worlds now take impulses and interventions for frames they have not stepped yet, and `Physics.steel` worlds can go `live(host)`, calling `control` as each frame steps.
