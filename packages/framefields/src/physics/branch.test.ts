/**
 * Saving and branching runs, and interventions: a branch replays its source
 * up to the branch frame and continues bit for bit, and each intervention
 * changes the run the way it says.
 */
import { describe, expect, it } from "vitest";
import { Layer, Layer3D } from "../index.js";
import type { PhysicsState } from "./core.js";
import { Physics } from "./index.js";

const FPS = 30;
const FRAMES = 60;
const at = (s: { get(ctx?: never): number }, frame: number) =>
	s.get({ frame, fps: FPS } as never);

/** Two balls dropped onto a ground; the same scene every call. */
async function scene(
	options: { keepStates?: boolean | number[]; from?: PhysicsState } = {},
) {
	const world = await Physics.world3d({ fps: FPS, frames: FRAMES, ...options });
	world.ground({ y: 400 });
	const a = world.body(
		Layer3D.sphere({ id: "a", radius: 30, x: 300, y: 0, z: 0 }),
		{
			restitution: 0.5,
		},
	);
	const b = world.body(
		Layer3D.sphere({ id: "b", radius: 30, x: 320, y: -200, z: 0 }),
		{
			restitution: 0.5,
		},
	);
	return { world, a, b };
}

const track = (s: { get(ctx?: never): number }) =>
	Array.from({ length: FRAMES }, (_, f) => at(s, f));

describe("branching", () => {
	it("continues from a kept state exactly as the original run", async () => {
		const source = await scene({ keepStates: [25] });
		source.world.simulate();
		const branch = await scene({ from: source.world.state(25) });
		branch.world.simulate();
		for (const k of ["a", "b"] as const) {
			expect(track(branch[k].y)).toEqual(track(source[k].y));
			expect(track(branch[k].rotateZ)).toEqual(track(source[k].rotateZ));
			expect(track(branch[k].impact)).toEqual(track(source[k].impact));
		}
		expect(branch.a.collisions.map((c) => c.frame)).toEqual(
			source.a.collisions.map((c) => c.frame),
		);
	});

	it("replays the source up to the branch, then diverges with interventions", async () => {
		const source = await scene({ keepStates: true });
		source.world.simulate();
		const branch = await scene({ from: source.world.state(20) });
		branch.world.at(30).teleport(branch.a, [600, 100, 0]);
		branch.world.simulate();
		expect(track(branch.a.x).slice(0, 30)).toEqual(
			track(source.a.x).slice(0, 30),
		);
		expect(at(branch.a.x, 30)).toBeCloseTo(600, 0);
		expect(at(source.a.x, 30)).toBeLessThan(400);
	});

	it("says how to keep a state, and checks a branch is built the same way", async () => {
		const { world } = await scene();
		expect(() => world.state(10)).toThrow("keepStates: [10]");
		const source = await scene({ keepStates: [10] });
		const state = source.world.state(10);
		const other = await Physics.world3d({
			fps: FPS,
			frames: FRAMES,
			from: state,
		});
		other.body(Layer3D.sphere({ radius: 10 }));
		expect(() => other.simulate()).toThrow(
			"has 3 bodies, this world 1 (grounds and walls count)",
		);
		const late = await scene({ from: state });
		expect(() => late.world.at(5)).toThrow("continues from frame 10");
	});

	it("branches 2D worlds too", async () => {
		const build = async (options: {
			keepStates?: number[];
			from?: PhysicsState;
		}) => {
			const world = await Physics.world2d({
				fps: FPS,
				frames: FRAMES,
				...options,
			});
			world.ground({ y: 500 });
			const box = world.body(
				Layer.box({
					id: "box",
					position: "absolute",
					x: 100,
					y: 0,
					width: 80,
					height: 80,
				}),
				{ restitution: 0.4, angularVelocity: 90 },
			);
			return { world, box };
		};
		const source = await build({ keepStates: [15] });
		source.world.simulate();
		const branch = await build({ from: source.world.state(15) });
		branch.world.simulate();
		expect(track(branch.box.y)).toEqual(track(source.box.y));
	});
});

describe("interventions", () => {
	it("lets a body fall through the ground while passing through", async () => {
		const { world, a } = await scene();
		world.at(10).passThrough(a);
		world.simulate();
		// The ground's top is y = 400: a 30 px ball rests at 370 or sinks below.
		expect(at(a.y, 59)).toBeGreaterThan(450);
	});

	it("collides again after `until`", async () => {
		const { world, a } = await scene();
		world.at(2).passThrough(a, { until: 4 });
		world.simulate();
		expect(at(a.y, 59)).toBeLessThan(400);
	});

	it("flips gravity, vanishes a body, and lists what it did", async () => {
		const { world, a, b } = await scene();
		world.at(20).gravity([0, -2400, 0]).vanish(b);
		world.simulate();
		expect(at(a.vy, 40)).toBeLessThan(0);
		// A vanished body stops where it was and its layer goes transparent.
		expect(at(b.y, 59)).toBe(at(b.y, 20));
		expect(world.interventions).toEqual([
			{ kind: "gravity", frame: 20, gravity: [0, -2400, 0] },
			{ kind: "vanish", frame: 20, layer: "b" },
		]);
	});

	it("rejects frames outside the run", async () => {
		const { world, a } = await scene();
		expect(() => world.at(0)).toThrow("frames 1 to 59");
		expect(() => world.at(60)).toThrow("frames 1 to 59");
		expect(() => world.at(5).passThrough(a, { until: 3 })).toThrow(
			"comes after frame 5",
		);
		expect(() => world.at(5).mass(a, 0)).toThrow("> 0");
	});
});
