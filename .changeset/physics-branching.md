---
"framefields": minor
---

Physics worlds (2D and 3D) can branch and be intervened on. `keepStates` keeps the simulation's state at chosen frames; `world.state(frame)` passed as `from` to a world built the same way replays the original run up to that frame and simulates on from there. `world.at(frame)` plans interventions (`teleport`, `velocity`, `vanish`, `passThrough`, `mass`, `gravity`), listed with their layers in `world.interventions`.
