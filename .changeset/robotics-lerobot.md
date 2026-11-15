---
"framefields": minor
---

Robotics data from MuJoCo runs. `Physics.mujoco` worlds record `qvel`, `act`, `ctrl`, `action` and `sensordata` per frame (with `joints`, `actuatorNames` and `sensors`), report contacts from every MuJoCo step of a frame with their peak normal force and position, step as `mj_step2` + `mj_step1` so recorded poses and sensors belong to the frame's state, expose the model's `<camera>`s as scene cameras (`world.camera("wrist")`) and draw tendons. `keyframe` starts a run from one of the model's `<key>`s (Menagerie's "home"), and `control` also sees `qvel` (for PD controllers). Runs match native MuJoCo of the same version to floating-point precision (checked on Menagerie's Panda, UR5e, SO-ARM100, ALOHA and Go2). `framefields/datasets` writes LeRobot v3.0 datasets (`LeRobotWriter`, `mujocoEpisode`: Parquet frame tables, H.264 videos with episodes packed per file as LeRobot's recorder does, joined without re-encoding, metadata and stats; `LeRobotDataset` loads them) and Parquet files (`encodeParquet`).

Ground truth: the depth, motion and object-id pass now drops back faces of one-sided meshes as the picture does, so a camera inside a solid sees past it in its truth too.
