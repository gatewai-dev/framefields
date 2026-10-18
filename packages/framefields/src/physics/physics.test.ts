import { describe, expect, it } from "vitest";
import { Layer, Layer3D, Signal } from "../index.js";
import { simplifyKeys, unwrapDegrees } from "./core.js";
import { Physics } from "./index.js";
import { eulerFromQuat, quatFromEuler } from "./world3d.js";

const FPS = 30;
const at = (s: { get(ctx?: never): number }, frame: number) =>
	s.get({ frame, fps: FPS } as never);

function card(
	id: string,
	x: number,
	y: number,
	extra: Record<string, unknown> = {},
) {
	return Layer.box({
		id,
		position: "absolute",
		x,
		y,
		width: 200,
		height: 100,
		background: "#fff",
		...extra,
	});
}

type Track = {
	prop: string;
	source?: { type: string };
	keyframes: Array<{ frame: number; value: number }>;
};
const tracksOf = (layer: unknown) =>
	((layer as { animation?: { tracks: Track[] } }).animation?.tracks ??
		[]) as Track[];

describe("Physics.world2d", () => {
	it("drops a box onto the ground and binds the layer to signals", async () => {
		const world = await Physics.world2d({ fps: FPS, frames: 90 });
		world.ground({ y: 1000 });
		const layer = card("a", 860, 100);
		const body = world.body(layer, { restitution: 0 });
		world.simulate();

		expect(at(body.y, 0)).toBeCloseTo(100, 3);
		// Rests on the ground: bottom edge at y = 1000.
		expect(at(body.y, 89) + 100).toBeCloseTo(1000, 0);
		expect(Math.abs(at(body.x, 89) - 860)).toBeLessThan(2);
		expect(at(body.sleeping, 89)).toBe(1);

		const props = tracksOf(layer).map((t) => [t.prop, t.source?.type]);
		expect(props).toEqual([
			["x", "signal"],
			["y", "signal"],
			["rotation", "signal"],
		]);
	});

	it("records first contacts and an impact envelope that decays", async () => {
		const world = await Physics.world2d({
			fps: FPS,
			frames: 60,
			impactDecay: 4,
		});
		const ground = world.ground({ y: 1000 });
		const body = world.body(card("a", 860, 500), { restitution: 0 });
		world.simulate();

		expect(body.collisions.length).toBeGreaterThan(0);
		const hit = body.collisions[0];
		expect(hit.with).toBe(ground);
		expect(hit.speed).toBeGreaterThan(500);
		expect(world.collisions[0].frame).toBe(hit.frame);

		expect(at(body.impact, hit.frame - 1)).toBe(0);
		const peak = at(body.impact, hit.frame);
		expect(peak).toBeGreaterThan(0.3);
		expect(at(body.impact, hit.frame + 4)).toBeLessThan(peak * 0.5);
		// The ground hears the hit too, and the world takes the loudest.
		expect(at(ground.impact, hit.frame)).toBeCloseTo(peak, 5);
		expect(at(world.impact, hit.frame)).toBeCloseTo(peak, 5);
	});

	it("is deterministic", async () => {
		const run = async () => {
			const world = await Physics.world2d({ fps: FPS, frames: 120 });
			world.walls({ width: 1920, height: 1080 });
			const bodies = Array.from({ length: 12 }, (_, i) =>
				world.body(
					card(`c${i}`, 200 + (i % 4) * 300, -200 - i * 140, {
						rotation: i * 13,
					}),
					{
						angularVelocity: i * 20,
					},
				),
			);
			world.simulate();
			return bodies.flatMap((b) => [
				at(b.x, 119),
				at(b.y, 119),
				at(b.rotation, 119),
			]);
		};
		expect(await run()).toEqual(await run());
	});

	it("starts from the layer's pose with any pivot, scale and rotation", async () => {
		const world = await Physics.world2d({ fps: FPS, frames: 2, gravity: 0 });
		const layer = card("a", 300, 400, {
			rotation: 30,
			anchorX: 0,
			anchorY: 0,
			scale: 1.5,
		});
		const body = world.body(layer);
		world.simulate();
		expect(at(body.x, 1)).toBeCloseTo(300, 3);
		expect(at(body.y, 1)).toBeCloseTo(400, 3);
		expect(at(body.rotation, 1)).toBeCloseTo(30, 3);
		// Center of a 300×150 box pivoting on its top-left corner, turned 30° clockwise.
		const a = Math.PI / 6;
		expect(at(body.centerX, 1)).toBeCloseTo(
			300 + 150 * Math.cos(a) - 75 * Math.sin(a),
			2,
		);
		expect(at(body.centerY, 1)).toBeCloseTo(
			400 + 150 * Math.sin(a) + 75 * Math.cos(a),
			2,
		);
	});

	it("holds a body until its start frame and the signals until the world's", async () => {
		const world = await Physics.world2d({
			fps: FPS,
			frames: 40,
			startFrame: 100,
		});
		const body = world.body(card("a", 0, 0), { startFrame: 10 });
		world.simulate();
		expect(at(body.y, 0)).toBe(0);
		expect(at(body.y, 110)).toBe(0);
		expect(at(body.y, 112)).toBeGreaterThan(0);
		expect(at(body.vy, 139)).toBeGreaterThan(0);
	});

	it("uses circles and convex hulls for shape layers", async () => {
		const world = await Physics.world2d({ fps: FPS, frames: 90 });
		world.ground({ y: 1000 });
		const ball = world.body(
			Layer.shape("circle", {
				position: "absolute",
				x: 100,
				y: 0,
				width: 200,
				height: 200,
			}),
			{ restitution: 0 },
		);
		const star = world.body(
			Layer.shape("star", {
				position: "absolute",
				x: 600,
				y: 0,
				width: 200,
				height: 200,
			}),
		);
		const text = world.body(card("t", 1200, 0), {
			shape: "circle",
			size: [100, 100],
		});
		world.simulate();
		expect(at(ball.y, 89) + 200).toBeCloseTo(1000, 0);
		expect(at(star.y, 89)).toBeGreaterThan(600);
		expect(at(text.centerY, 89)).toBeCloseTo(950, 0);
	});

	it("bakes simplified keyframes instead of signals", async () => {
		const world = await Physics.world2d({ fps: FPS, frames: 90 });
		world.ground({ y: 1000 });
		const layer = card("a", 860, 100);
		const body = world.body(layer, { restitution: 0, lockRotation: true });
		world.bakeKeyframes();

		const tracks = tracksOf(layer);
		expect(tracks.map((t) => t.prop)).toEqual(["x", "y"]);
		const y = tracks.find((t) => t.prop === "y") as Track;
		expect(y.source?.type ?? "keyframes").not.toBe("signal");
		expect(y.keyframes.length).toBeGreaterThan(2);
		expect(y.keyframes.length).toBeLessThan(90);
		expect(y.keyframes[0]).toMatchObject({ frame: 0, value: 100 });
		const last = y.keyframes[y.keyframes.length - 1];
		expect(last.frame).toBe(89);
		expect(last.value).toBeCloseTo(at(body.y, 89), 2);
		const x = tracks.find((t) => t.prop === "x") as Track;
		expect(x.keyframes).toHaveLength(1);
	});

	it("moves kinematic bodies from drivers and lets them push", async () => {
		const world = await Physics.world2d({ fps: FPS, frames: 60, gravity: 0 });
		const pusher = world.body(card("p", 0, 400), {
			type: "kinematic",
			follow: {
				x: Signal.fromArray(
					Array.from({ length: 60 }, (_, f) => f * 20),
					FPS,
				),
			},
		});
		const target = world.body(card("t", 500, 400));
		world.simulate();
		expect(at(pusher.x, 30)).toBeCloseTo(600, 0);
		expect(at(target.x, 59)).toBeGreaterThan(700);
	});

	it("applies forces, impulses and joints", async () => {
		const world = await Physics.world2d({ fps: FPS, frames: 60, gravity: 0 });
		const pushed = world.body(card("a", 0, 0));
		world.force(pushed, { x: (frame) => (frame < 30 ? 600 : 0) });
		const kicked = world.body(card("b", 0, 300));
		world.impulse(kicked, 10, [0, -900]);
		const swing = world.body(card("c", 1000, 0), { gravityScale: 1 });
		world.pin(swing, [1000, 50]);
		world.force(swing, { y: 2400 });
		world.simulate();
		expect(at(pushed.vx, 29)).toBeCloseTo(580, -1);
		expect(at(pushed.vx, 59)).toBeCloseTo(at(pushed.vx, 31), 1);
		expect(at(kicked.vy, 9)).toBe(0);
		expect(at(kicked.vy, 10)).toBeCloseTo(-900, 0);
		// Pinned at its left edge's middle: swings down around the pin, never falls away.
		const swingAngles = Array.from({ length: 60 }, (_, f) =>
			Math.abs(at(swing.rotation, f)),
		);
		expect(Math.max(...swingAngles)).toBeGreaterThan(60);
		expect(
			Math.hypot(at(swing.centerX, 59) - 1000, at(swing.centerY, 59) - 50),
		).toBeCloseTo(100, -1);
	});

	it("pushes bodies with a position-dependent field", async () => {
		const world = await Physics.world2d({ fps: FPS, frames: 30, gravity: 0 });
		const left = world.body(card("l", 300, 500));
		const right = world.body(card("r", 1400, 500));
		const still = world.body(card("s", 800, 0));
		// Away from x = 960, only for the first two bodies.
		world.field((s) => [s.x < 960 ? -1200 : 1200, 0], {
			bodies: [left, right],
		});
		world.simulate();
		expect(at(left.vx, 29)).toBeLessThan(-1000);
		expect(at(right.vx, 29)).toBeGreaterThan(1000);
		expect(at(still.vx, 29)).toBe(0);
		// A field is not a contact: no impacts.
		expect(at(left.impact, 29)).toBe(0);
	});

	it("rejects layers without a position and locks after simulating", async () => {
		const world = await Physics.world2d({ fps: FPS, frames: 2 });
		expect(() => world.body(Layer.box({ width: 10, height: 10 }))).toThrow(
			/x.*y/,
		);
		const b = world.body(card("a", 0, 0));
		void b.y;
		expect(() => world.body(card("b", 0, 0))).toThrow(/already simulated/);
	});
});

describe("Physics.world3d", () => {
	it("drops a sphere and a box onto the ground", async () => {
		const world = await Physics.world3d({ fps: FPS, frames: 120 });
		world.ground({ y: 600 });
		const sphere = Layer3D.sphere({ id: "s", radius: 80, x: 0, y: 0, z: 0 });
		const box = Layer3D.roundedBox({
			id: "b",
			width: 160,
			height: 100,
			depth: 160,
			radius: 10,
			x: 400,
			y: -200,
			z: 0,
			rotateZ: 20,
		});
		const s = world.body(sphere, { restitution: 0, angularDamping: 2 });
		const b = world.body(box, { restitution: 0 });
		world.simulate();
		expect(at(s.y, 119)).toBeCloseTo(520, 0);
		expect(at(b.y, 119)).toBeCloseTo(550, 0);
		expect(Math.abs(at(b.rotateZ, 119)) % 90).toBeLessThan(1);
		expect(tracksOf(box).map((t) => t.prop)).toEqual([
			"x",
			"y",
			"z",
			"rotateX",
			"rotateY",
			"rotateZ",
		]);
	});

	it("converts rotations with the renderer's Euler order", () => {
		for (const e of [
			[10, 20, 30],
			[-75, 40, 170],
			[0, 89, 0],
			[120, -30, -60],
		] as const) {
			const back = eulerFromQuat(quatFromEuler(e[0], e[1], e[2]), [
				e[0],
				e[1],
				e[2],
			]);
			expect(back[0]).toBeCloseTo(e[0], 3);
			expect(back[1]).toBeCloseTo(e[1], 3);
			expect(back[2]).toBeCloseTo(e[2], 3);
		}
	});

	it("is deterministic", async () => {
		const run = async () => {
			const world = await Physics.world3d({ fps: FPS, frames: 90 });
			world.walls({ x: 0, y: 0, z: 0, width: 800, height: 800, depth: 800 });
			const bodies = Array.from({ length: 10 }, (_, i) =>
				world.body(
					Layer3D.roundedBox({
						width: 80,
						height: 80,
						depth: 80,
						x: (i % 3) * 60 - 60,
						y: -300 - i * 100,
						z: 0,
						rotateX: i * 17,
					}),
				),
			);
			world.simulate();
			return bodies.flatMap((b) => [
				at(b.x, 89),
				at(b.y, 89),
				at(b.rotateY, 89),
			]);
		};
		expect(await run()).toEqual(await run());
	});
});

describe("helpers", () => {
	it("unwraps angles across ±180", () => {
		expect(unwrapDegrees(170, -170)).toBe(190);
		expect(unwrapDegrees(-350, 5)).toBe(-355);
	});

	it("keeps only the keyframes a linear track needs", () => {
		const line = Array.from({ length: 50 }, (_, i) => i * 2);
		expect(simplifyKeys(line, 0.1).map((k) => k[0])).toEqual([0, 49]);
		const vee = Array.from({ length: 21 }, (_, i) => Math.abs(i - 10));
		expect(simplifyKeys(vee, 0.1).map((k) => k[0])).toEqual([0, 10, 20]);
	});
});
