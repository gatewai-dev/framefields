---
"framefields": minor
---

Robotics data from Steel runs. `Physics.steel` worlds list their `joints` (type, coordinate offsets, dofs, whether a drive moves them), record `action(frame)` (each dof's drive target that steps the frame to the next), read meshes from `file:` folders in Node, and expose an MJCF model's fixed `<camera>`s as scene cameras that ride their bodies (`world.camera("wrist")`, or `world.camera({ name, body, position, quaternion, fovy })` in code). `framefields/datasets` writes LeRobot v3.0 datasets (`LeRobotWriter`, `steelEpisode`: Parquet frame tables, H.264 videos with episodes packed per file as LeRobot's recorder does, joined without re-encoding, metadata and stats; `LeRobotDataset` loads them) and Parquet files (`encodeParquet`).

Ground truth: the depth, motion and object-id pass now drops back faces of one-sided meshes as the picture does, so a camera inside a solid sees past it in its truth too.
