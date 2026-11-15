/**
 * The SO-101 arm (TheRobotStudio SO-ARM100, Apache-2.0) on Steel: its joint
 * drives follow seeded waypoints while a few cubes sit within reach. The
 * model's files are not shipped: point `dir` at the repository's
 * `Simulation/SO101` folder (`so101_new_calib.xml` and `assets/`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Composition, Layer, Physics } from "framefields";
import type { Env, EnvView } from "framefields/datasets";
import { random } from "framefields/datasets";
import type { CameraParams } from "./falling.js";

/** The driven joints, in the model's actuator order. */
const JOINTS = [
	"shoulder_pan",
	"shoulder_lift",
	"elbow_flex",
	"wrist_flex",
	"wrist_roll",
	"gripper",
];
/** Actuator ranges (rad) from `so101_new_calib.xml`, in actuator order. */
const CTRL_RANGE: Array<[number, number]> = [
	[-1.91986, 1.91986], // shoulder_pan
	[-1.74533, 1.74533], // shoulder_lift
	[-1.69, 1.69], // elbow_flex
	[-1.65806, 1.65806], // wrist_flex
	[-2.74385, 2.84121], // wrist_roll
	[-0.17453, 1.74533], // gripper
];
const PPM = 1000;
const ORIGIN: [number, number, number] = [320, 400, 0];

export interface So101Params {
	/** Actuator targets (rad) at evenly spaced frames, eased between. */
	waypoints: number[][];
	cubes: Array<{
		position: [number, number];
		size: number;
		color: [number, number, number];
	}>;
	camera: CameraParams;
}

function so101Params(seed: number): So101Params {
	const r = random(seed);
	const waypoints = Array.from({ length: 4 }, (_, k) =>
		CTRL_RANGE.map(([lo, hi]) => {
			if (k === 0) return 0;
			const mid = (lo + hi) / 2;
			return (
				Math.round((mid + r.range(-0.6, 0.6) * ((hi - lo) / 2)) * 1000) / 1000
			);
		}),
	);
	const cubes = Array.from({ length: r.int(2, 3) }, () => ({
		position: [
			Math.round(r.range(0.12, 0.28) * 1000) / 1000,
			Math.round(r.range(-0.15, 0.15) * 1000) / 1000,
		] as [number, number],
		size: Math.round(r.range(0.012, 0.022) * 1000) / 1000,
		color: [r.next(), r.next(), r.next()].map(
			(v) => Math.round((0.3 + 0.7 * v) * 100) / 100,
		) as [number, number, number],
	}));
	const angle = (r.range(-60, 60) * Math.PI) / 180;
	const camera: CameraParams = {
		name: "orbit",
		eye: [
			Math.round(ORIGIN[0] + Math.sin(angle) * 850),
			Math.round(r.range(80, 220)),
			Math.round(-Math.cos(angle) * 850),
		],
		target: [ORIGIN[0], 230, 0],
	};
	return { waypoints, cubes, camera };
}

/** The actuator targets at `frame`: waypoints eased (smoothstep) between. */
function targetsAt(
	waypoints: number[][],
	frames: number,
	frame: number,
): number[] {
	const span = (frames - 1) / (waypoints.length - 1);
	const k = Math.min(waypoints.length - 2, Math.floor(frame / span));
	const t = Math.min(1, (frame - k * span) / span);
	const s = t * t * (3 - 2 * t);
	return waypoints[k].map((a, j) => a + (waypoints[k + 1][j] - a) * s);
}

/** The SO-101 environment, its model read from `dir`. */
export function so101(dir: string): Env<So101Params> {
	const env = { fps: 24, frames: 48, width: 640, height: 480 };
	let arm: string | null = null;
	return {
		name: "so101",
		description:
			"The SO-101 arm following seeded joint waypoints on Steel, with 2 or 3 cubes within reach; one orbiting camera.",
		...env,
		params: (seed) => so101Params(seed),
		async build(params): Promise<EnvView[]> {
			arm ??= readFileSync(path.join(dir, "so101_new_calib.xml"), "utf8");
			const xml = arm;
			const world = await Physics.steel({
				fps: env.fps,
				frames: env.frames,
				pixelsPerMeter: PPM,
				origin: ORIGIN,
				build: async (scene, load) => {
					await load.mjcf(scene, xml, {
						baseUrl: pathToFileURL(`${dir}/`).href,
					});
					scene.addGroundPlane({ color: [0.55, 0.57, 0.6] });
					params.cubes.forEach((c, i) => {
						const size = c.size;
						const body = scene.addBody({
							xform: [c.position[0], c.position[1], size, 0, 0, 0, 1],
							label: `cube${i}`,
						});
						scene.addJointFree(body, { label: `cube${i}` });
						scene.addShapeBox(body, {
							hx: size,
							hy: size,
							hz: size,
							color: c.color,
							density: 0.02 / (2 * size) ** 3,
						});
					});
				},
				control: (frame, s) => {
					const targets = targetsAt(params.waypoints, env.frames, frame);
					for (const [j, t] of targets.entries())
						s.setJointTarget(JOINTS[j], t);
				},
			});
			await world.simulate();
			const c = new Composition({
				width: env.width,
				height: env.height,
				fps: env.fps,
				durationFrames: env.frames,
				backgroundColor: "#0e1116",
			});
			const { eye, target } = params.camera;
			c.add([
				Layer.camera({
					x: eye[0],
					y: eye[1],
					z: eye[2],
					targetX: target[0],
					targetY: target[1],
					targetZ: target[2],
				}),
				Layer.ambientLight("#ffffff", 0.4),
				Layer.directionalLight({
					x: -300,
					y: -600,
					z: -500,
					targetX: ORIGIN[0],
					targetY: ORIGIN[1],
					targetZ: 0,
					intensity: 0.9,
					castShadow: true,
				}),
				...world.layers({ planeSize: 2 }),
			]);
			return [
				{
					name: params.camera.name,
					composition: c,
					physics: (frame) => ({
						qpos: Array.from(world.state(frame).jointQ),
						ctrl: targetsAt(params.waypoints, env.frames, frame),
					}),
				},
			];
		},
	};
}
