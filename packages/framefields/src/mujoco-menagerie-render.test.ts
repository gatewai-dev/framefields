/**
 * MuJoCo Menagerie robots (github.com/google-deepmind/mujoco_menagerie)
 * load, start from their keyframes, hold them, and render: arms (Panda,
 * UR5e, SO-ARM100), the ALOHA bimanual cell with its cameras, and the Go2
 * quadruped standing on a PD controller. The models are not shipped: set
 * MUJOCO_MENAGERIE to a checkout (these five folders are enough).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Composition, Layer, type LayoutNode } from "./index.js";
import { Physics } from "./physics/index.js";
import type { MujocoWorld } from "./physics/mujoco.js";

const ROOT = process.env.MUJOCO_MENAGERIE;
const FPS = 50;
const FRAMES = 50;

/** A frame of the robot from a camera at `eye` (model meters) looking at `target`. */
async function view(
	world: MujocoWorld,
	camera: { eye: number[]; target: number[] } | string,
): Promise<Buffer> {
	const scene = (p: number[]) => [p[0] * 100, -p[2] * 100, p[1] * 100];
	const c = new Composition({
		width: 160,
		height: 120,
		fps: FPS,
		durationFrames: FRAMES,
		backgroundColor: "#000000",
	});
	let cam: LayoutNode;
	if (typeof camera === "string") cam = world.camera(camera);
	else {
		const [x, y, z] = scene(camera.eye);
		const [targetX, targetY, targetZ] = scene(camera.target);
		cam = Layer.camera({ x, y, z, targetX, targetY, targetZ });
	}
	c.add([
		cam,
		Layer.ambientLight("#ffffff", 1),
		...(world.layers().layers as LayoutNode[]),
	]);
	return c.renderFrame({ frame: FRAMES - 1, format: "rgba" });
}

/** Share of pixels that are not the black background. */
function coverage(rgba: Buffer): number {
	let n = 0;
	for (let p = 0; p < rgba.length; p += 4)
		if (rgba[p] + rgba[p + 1] + rgba[p + 2] > 30) n++;
	return n / (rgba.length / 4);
}

const ARMS = [
	{
		name: "franka_emika_panda",
		joints: 9,
		eye: [1.6, -1.2, 1.1],
		target: [0.2, 0, 0.4],
	},
	{
		name: "universal_robots_ur5e",
		joints: 6,
		eye: [1.6, -1.2, 1.1],
		target: [0, 0, 0.4],
	},
	{
		name: "trs_so_arm100",
		joints: 6,
		eye: [0.6, -0.6, 0.45],
		target: [0, -0.15, 0.1],
	},
];

describe.skipIf(!ROOT)("MuJoCo Menagerie robots", () => {
	const at = (folder: string) => path.join(ROOT ?? "", folder, "scene.xml");

	it.each(ARMS)("$name holds its home keyframe", async (arm) => {
		const world = await Physics.mujoco({
			path: at(arm.name),
			fps: FPS,
			frames: FRAMES,
			keyframe: "home",
		});
		expect(world.joints).toHaveLength(arm.joints);
		const home = world.qpos(0);
		const end = world.qpos(FRAMES - 1);
		for (let k = 0; k < home.length; k++)
			expect(Math.abs(end[k] - home[k])).toBeLessThan(0.05);
		expect(coverage(await view(world, arm))).toBeGreaterThan(0.02);
	});

	it("ALOHA sees its cell through its own cameras", async () => {
		const world = await Physics.mujoco({
			path: at("aloha"),
			fps: FPS,
			frames: FRAMES,
			keyframe: "neutral_pose",
		});
		expect(world.cameraNames).toEqual([
			"teleoperator_pov",
			"collaborator_pov",
			"overhead_cam",
			"worms_eye_cam",
			"wrist_cam_left",
			"wrist_cam_right",
		]);
		expect(world.actuatorNames).toHaveLength(14);
		for (const camera of ["teleoperator_pov", "overhead_cam", "wrist_cam_left"])
			expect(coverage(await view(world, camera))).toBeGreaterThan(0.2);
	});

	it("Go2 stands on a PD controller", async () => {
		const home = [0, 0.9, -1.8, 0, 0.9, -1.8, 0, 0.9, -1.8, 0, 0.9, -1.8];
		const world = await Physics.mujoco({
			path: at("unitree_go2"),
			fps: FPS,
			frames: FRAMES * 2,
			keyframe: "home",
			// Torque motors: 40 N·m/rad toward the stance, 1 N·m·s/rad damping.
			control: (_f, { qpos, qvel }) =>
				home.map((q, i) => 40 * (q - qpos[7 + i]) - qvel[6 + i]),
		});
		expect(world.qpos(0)[2]).toBeCloseTo(0.27, 6);
		expect(world.qpos(FRAMES * 2 - 1)[2]).toBeGreaterThan(0.22);
		// Without a controller its motors go limp (the keyframe's ctrl is torque).
		const limp = await Physics.mujoco({
			path: at("unitree_go2"),
			fps: FPS,
			frames: FRAMES,
			keyframe: "home",
		});
		expect(limp.qpos(FRAMES - 1)[2]).toBeLessThan(0.15);
	});
});
