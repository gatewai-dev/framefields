---
"framefields": minor
---

Robotics data from MuJoCo runs. `Physics.mujoco` worlds record `qvel`, `act`, `ctrl`, `action` and `sensordata` per frame (with `joints`, `actuatorNames` and `sensors`), report contacts from every MuJoCo step of a frame with their peak normal force and position, step as `mj_step2` + `mj_step1` so recorded poses and sensors belong to the frame's state, expose the model's `<camera>`s as scene cameras (`world.camera("wrist")`) and draw tendons. `framefields/datasets` writes LeRobot v3.0 datasets (`LeRobotWriter`, `mujocoEpisode`: Parquet frame tables, an H.264 video per camera per episode, metadata and stats) and Parquet files (`encodeParquet`).

Ground truth: the depth, motion and object-id pass now drops back faces of one-sided meshes as the picture does, so a camera inside a solid sees past it in its truth too.
