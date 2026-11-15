/**
 * Interactive sessions: an action steers the live run (a push moves the
 * ball its way; a Steel joint drive follows its target), the same seed and
 * actions render the same bytes, and the episode ends where it should.
 */
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D, type LayoutNode } from "../index.js";
import {
	Physics,
	type SteelLoaders,
	type SteelSceneBuilder,
} from "../physics/index.js";
import {
	EnvSession,
	type InteractiveEnv,
	type LiveScene,
} from "./interactive.js";

const at = (s: { get(c: never): unknown }, frame: number) =>
	s.get({ frame, fps: 24 } as never) as number;

/** A ball on a floor; the action pushes it along x. Reward: its x. */
const push: InteractiveEnv<{ x: number }, number[]> = {
	name: "push",
	description: "Push a ball along x.",
	fps: 24,
	frames: 12,
	width: 64,
	height: 48,
	actionSpace: { type: "box", shape: [1], low: -1, high: 1 },
	frameSkip: 2,
	params: (seed) => ({ x: seed * 10 }),
	async start(params, host): Promise<LiveScene<number[]>> {
		const c = new Composition({
			width: 64,
			height: 48,
			fps: 24,
			durationFrames: 12,
		});
		const ball = Layer3D.sphere({
			id: "ball",
			radius: 20,
			x: params.x,
			y: 180,
			color: "#ff0000",
		});
		c.add([
			Layer.camera({
				x: 0,
				y: 100,
				z: -600,
				targetX: 0,
				targetY: 150,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
			ball as LayoutNode,
		]);
		const world = await Physics.world3d({ fps: 24, frames: 12 });
		world.ground({ y: 200 });
		const body = world.body(ball as LayoutNode, { friction: 0 });
		world.live(host);
		return {
			views: [{ name: "front", composition: c }],
			act: (frame, [a]) => world.impulse(body, frame, [a * 120, 0, 0]),
			reward: (frame) => at(body.x, frame),
			terminated: (frame) => at(body.x, frame) > 1e6,
		};
	},
};

describe("EnvSession", () => {
	it("steers the live run with each action and ends on the last frame", async () => {
		const session = new EnvSession(push);
		const { observation, info } = await session.reset(0);
		expect(observation.frame).toBe(0);
		expect(observation.views[0].rgba.length).toBe(64 * 48 * 4);
		expect(info).toMatchObject({ seed: 0, params: { x: 0 } });
		const right = await session.step([1]);
		expect(right.observation.frame).toBe(2);
		expect(right.reward).toBeGreaterThan(0);
		const left1 = await session.step([-1]);
		const left2 = await session.step([-1]);
		expect(left2.reward).toBeLessThan(left1.reward);
		let last = left2;
		while (!last.truncated) last = await session.step([0]);
		expect(last.observation.frame).toBe(11);
		expect(last.terminated).toBe(false);
		await expect(session.step([0])).rejects.toThrow("reset()");
	});

	it("renders the same bytes for the same seed and actions", async () => {
		const run = async () => {
			const s = new EnvSession(push, { truth: true });
			await s.reset(1);
			const out = [];
			for (const a of [1, 1, -1]) out.push((await s.step([a])).observation);
			return out;
		};
		const [a, b] = [await run(), await run()];
		for (let k = 0; k < a.length; k++) {
			expect(Buffer.compare(a[k].views[0].rgba, b[k].views[0].rgba)).toBe(0);
			expect(a[k].views[0].depth).toEqual(b[k].views[0].depth);
		}
		expect(a[0].views[0].object?.some((id) => id > 0)).toBe(true);
	});

	it("drives a live Steel joint from the actions", async () => {
		const MJCF = `<mujoco>
  <worldbody>
    <body name="arm" pos="0 0 0.5">
      <joint name="hinge" type="hinge" axis="0 1 0" damping="1"/>
      <geom name="link" type="capsule" fromto="0 0 0 0.3 0 0" size="0.03"/>
    </body>
  </worldbody>
  <actuator><position joint="hinge" kp="20"/></actuator>
</mujoco>`;
		const build = async (
			scene: SteelSceneBuilder,
			load: SteelLoaders,
		): Promise<void> => {
			await load.mjcf(scene, MJCF);
		};
		let target = 0;
		const arm: InteractiveEnv<object, number[]> = {
			name: "arm",
			description: "A hinge to a target angle.",
			fps: 24,
			frames: 40,
			width: 64,
			height: 48,
			actionSpace: { type: "box", shape: [1], low: -1.5, high: 1.5 },
			params: () => ({}),
			async start(_params, host) {
				const robot = await Physics.steel({
					fps: 24,
					frames: 40,
					origin: [0, 200, 0],
					build,
					control: (_frame, s) => s.setJointTarget("hinge", target),
				});
				robot.live(host);
				const c = new Composition({
					width: 64,
					height: 48,
					fps: 24,
					durationFrames: 40,
				});
				c.add([
					Layer.camera({
						x: 0,
						y: 100,
						z: -600,
						targetX: 0,
						targetY: 100,
						targetZ: 0,
					}),
					Layer.ambientLight("#ffffff", 1),
					...robot.layers(),
				]);
				return {
					views: [{ name: "front", composition: c }],
					act: (_frame, [a]) => {
						target = a;
					},
					reward: (frame) => -Math.abs(robot.joint("hinge", frame)[0] - 0.8),
					info: (frame) => ({
						hinge: robot.joint("hinge", frame)[0],
						stepped: robot.steppedFrame,
					}),
				};
			},
		};
		const session = new EnvSession(arm);
		await session.reset(0);
		let r = await session.step([0.8]);
		for (let k = 0; k < 30; k++) r = await session.step([0.8]);
		expect(r.info.hinge).toBeCloseTo(0.8, 1);
		expect(r.info.stepped).toBe(31);
		expect(r.reward).toBeGreaterThan(-0.05);

		// The same actions, run offline, give the same trajectory.
		const offline = await Physics.steel({
			fps: 24,
			frames: 40,
			build,
			control: (_frame, s) => s.setJointTarget("hinge", 0.8),
		});
		await offline.simulate();
		expect(offline.joint("hinge", 31)[0]).toBe(r.info.hinge);
	});
});
