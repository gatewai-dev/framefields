/**
 * LeRobot export: a MuJoCo run becomes a v3.0 dataset (frame table, one
 * video per camera, episode table, tasks, stats), and episodes with other
 * features are refused. (The files are read back by pyarrow, Hugging Face
 * `datasets` and ffprobe in the envs package's demo.)
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Composition, Layer, type LayoutNode } from "../index.js";
import { Physics } from "../physics/index.js";
import { LeRobotWriter, mujocoEpisode } from "./lerobot.js";

const MJCF = `<mujoco>
  <worldbody>
    <camera name="front" pos="0 -1 0.4" xyaxes="1 0 0 0 0.4 1" fovy="50"/>
    <body name="arm" pos="0 0 0.2">
      <joint name="hinge" type="hinge" axis="0 1 0" damping="1"/>
      <geom name="link" type="capsule" fromto="0 0 0 0.3 0 0" size="0.03"/>
    </body>
  </worldbody>
  <actuator><position name="hinge" joint="hinge" kp="20"/></actuator>
  <sensor><jointpos name="angle" joint="hinge"/></sensor>
</mujoco>`;

const dir = mkdtempSync(path.join(tmpdir(), "ff-lerobot-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function episode(target: number, task: string) {
	const world = await Physics.mujoco({
		mjcf: MJCF,
		fps: 12,
		frames: 12,
		control: () => [target],
	});
	const c = new Composition({
		width: 64,
		height: 48,
		fps: 12,
		durationFrames: 12,
	});
	c.add([
		world.camera("front"),
		Layer.ambientLight("#ffffff", 1),
		...(world.layers().layers as LayoutNode[]),
	]);
	return { world, ep: mujocoEpisode(world, { task, cameras: { front: c } }) };
}

describe("LeRobotWriter", () => {
	it("writes a v3.0 dataset of MuJoCo episodes", async () => {
		const writer = new LeRobotWriter({
			dir,
			fps: 12,
			robotType: "hinge",
			imageStatSamples: 3,
		});
		const a = await episode(0.8, "Lift the arm.");
		const b = await episode(-0.5, "Lower the arm.");
		expect(await writer.addEpisode(a.ep)).toEqual({ index: 0, frames: 12 });
		expect(await writer.addEpisode(b.ep)).toEqual({ index: 1, frames: 12 });
		expect(writer.close()).toEqual({ episodes: 2, frames: 24 });

		const info = JSON.parse(
			readFileSync(path.join(dir, "meta/info.json"), "utf8"),
		);
		expect(info).toMatchObject({
			codebase_version: "v3.0",
			robot_type: "hinge",
			total_episodes: 2,
			total_frames: 24,
			total_tasks: 2,
			fps: 12,
			splits: { train: "0:2" },
		});
		expect(Object.keys(info.features)).toEqual([
			"observation.state",
			"action",
			"observation.velocity",
			"observation.sensors",
			"observation.images.front",
			"timestamp",
			"frame_index",
			"episode_index",
			"index",
			"task_index",
		]);
		expect(info.features["observation.state"]).toEqual({
			dtype: "float32",
			shape: [1],
			names: ["hinge"],
		});
		expect(info.features["observation.images.front"]).toMatchObject({
			dtype: "video",
			shape: [48, 64, 3],
		});

		// The state is the joint angle; the action, what drives the next frame.
		expect(Array.from(a.ep.state.at(11))).toEqual([a.world.qpos(11)[0]]);
		expect(Array.from(a.ep.action.at(0))).toEqual([0.8]);

		const stats = JSON.parse(
			readFileSync(path.join(dir, "meta/stats.json"), "utf8"),
		);
		expect(stats["observation.state"].count).toEqual([24]);
		expect(stats["observation.state"].max[0]).toBeGreaterThan(0.3);
		expect(stats["observation.state"].min[0]).toBeLessThan(-0.2);
		expect(stats["observation.images.front"].mean).toHaveLength(3);
		// Per channel, shaped (3, 1, 1) as LeRobot's.
		expect(stats["observation.images.front"].mean[0]).toEqual([
			[expect.any(Number)],
		]);

		for (const file of [
			"data/chunk-000/file-000.parquet",
			"data/chunk-000/file-001.parquet",
			"meta/episodes/chunk-000/file-000.parquet",
			"meta/tasks.parquet",
		]) {
			const bytes = readFileSync(path.join(dir, file));
			expect(bytes.subarray(0, 4).toString()).toBe("PAR1");
			expect(bytes.subarray(-4).toString()).toBe("PAR1");
		}
		const video = path.join(
			dir,
			"videos/observation.images.front/chunk-000/file-001.mp4",
		);
		expect(statSync(video).size).toBeGreaterThan(1000);
		expect(readFileSync(video).subarray(4, 8).toString()).toBe("ftyp");
	});

	it("refuses an episode with other features", async () => {
		const writer = new LeRobotWriter({ dir: path.join(dir, "other"), fps: 12 });
		const { ep } = await episode(0.2, "x");
		await writer.addEpisode(ep);
		await expect(writer.addEpisode({ ...ep, features: {} })).rejects.toThrow(
			"other features than episode 0",
		);
		expect(() =>
			new LeRobotWriter({ dir: path.join(dir, "empty"), fps: 12 }).close(),
		).toThrow("no episodes");
	});
});
