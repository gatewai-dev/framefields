/**
 * Ground truth through the real renderer: depth, normals and motion match
 * the scene's geometry, and asking for them leaves the picture unchanged.
 */
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D, truthLabels } from "./index.js";
import { Physics } from "./physics/index.js";

const FPS = 30;
const W = 400;
const H = 300;

/**
 * A sphere (radius 60 at the origin plane) seen head-on from z = -900;
 * `fall` drops it from y = 0, and `centerY` is its centre's y at a frame.
 */
async function scene(
	fall: boolean,
): Promise<{ c: Composition; centerY: (frame: number) => number }> {
	const c = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: 30,
		backgroundColor: "#000000",
	});
	c.add([
		Layer.camera({
			x: 200,
			y: 150,
			z: -900,
			targetX: 200,
			targetY: 150,
			targetZ: 0,
		}),
		Layer.ambientLight("#ffffff", 0.3),
		Layer.directionalLight({
			x: -300,
			y: -300,
			z: -600,
			targetX: 200,
			targetY: 150,
			targetZ: 0,
			intensity: 0.8,
		}),
	]);
	const ball = Layer3D.sphere({
		id: "ball",
		radius: 60,
		x: 200,
		y: fall ? 0 : 150,
		z: 0,
		color: "#d04040",
	});
	c.add(ball);
	if (!fall) return { c, centerY: () => 150 };
	const world = await Physics.world3d({ fps: FPS, frames: 30 });
	const body = world.body(ball, {});
	await world.simulate();
	const centerY = (frame: number) =>
		body.y.get({ frame, fps: FPS } as never) as number;
	return { c, centerY };
}

describe("renderTruth", () => {
	it("measures depth and normals of a sphere, picture unchanged", async () => {
		const { c } = await scene(false);
		const truth = await c.renderTruth({ frame: 0 });
		expect(truth.scenes).toHaveLength(1);
		const [s] = truth.scenes;
		expect([s.width, s.height]).toEqual([W, H]);
		const at = (x: number, y: number) => y * s.width + x;

		// Centre: the sphere's front at z = -60, 840 from the eye, facing it.
		const c0 = at(200, 150);
		expect(s.mask[c0]).toBe(1);
		expect(s.depth[c0]).toBeCloseTo(840, 0);
		const n = s.normal as Float32Array;
		expect(n[c0 * 3 + 2]).toBeLessThan(-0.99);
		// Right of centre (the sphere spans about ±21 px) the surface turns
		// right (+x) and away.
		const r = at(215, 150);
		expect(n[r * 3]).toBeGreaterThan(0.5);
		expect(s.depth[r]).toBeGreaterThan(s.depth[c0] + 10);
		// Background: nothing there.
		expect(s.mask[at(5, 5)]).toBe(0);
		expect(s.depth[at(5, 5)]).toBe(Number.POSITIVE_INFINITY);
		// Still scene: no motion (to float rounding: the two frames' positions
		// are projected separately on the GPU).
		expect(s.motion.every((v) => Math.abs(v) < 1e-4)).toBe(true);

		const rgba = await c.renderFrame({ frame: 0, format: "rgba" });
		expect(truth.rgba.equals(rgba)).toBe(true);
	});

	it("measures the screen motion of a falling sphere", async () => {
		const { c, centerY } = await scene(true);
		const now = (await c.renderTruth({ frame: 15 })).scenes[0];
		// The sphere moves straight down, at a constant distance along the
		// view axis: a surface point at depth d moves f * dY / d pixels.
		const dY = centerY(15) - centerY(14);
		const f = H / 2 / Math.tan((now.camera.fov * Math.PI) / 360);
		let covered = 0;
		now.mask.forEach((m, i) => {
			if (!m) return;
			covered++;
			expect(now.motion[i * 2 + 1]).toBeCloseTo((f * dY) / now.depth[i], 1);
			expect(Math.abs(now.motion[i * 2])).toBeLessThan(0.01);
		});
		expect(covered).toBeGreaterThan(1000);

		// Rendered straight after a seek: the frame before is primed.
		const seeked = (await c.renderTruth({ frame: 20 })).scenes[0];
		const i = seeked.mask.indexOf(1);
		expect(seeked.motion[i * 2 + 1]).toBeGreaterThan(1);

		const rgba = await c.renderFrame({ frame: 15, format: "rgba" });
		expect((await c.renderTruth({ frame: 15 })).rgba.equals(rgba)).toBe(true);
	});

	it("names the object and instance at each pixel", async () => {
		const c = new Composition({
			width: W,
			height: H,
			fps: FPS,
			durationFrames: 10,
			backgroundColor: "#000000",
		});
		c.add([
			Layer.camera({
				x: 200,
				y: 150,
				z: -900,
				targetX: 200,
				targetY: 150,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
			Layer3D.sphere({ id: "left", radius: 50, x: 120, y: 120, z: 0 }),
			Layer3D.sphere({ id: "right", radius: 50, x: 280, y: 120, z: 0 }),
			Layer3D.instances({
				id: "dots",
				mesh: Layer3D.sphere({ radius: 20 }),
				count: 3,
				instanceAt: (i) => ({ x: 100 + i * 100, y: 250, z: 0 }),
			}),
		]);
		const truth = await c.renderTruth(0);
		const [s] = truth.scenes;
		const f = H / 2 / Math.tan((s.camera.fov * Math.PI) / 360);
		// Where a world point at z = 0 lands on screen (eye 900 in front).
		const at = (x: number, y: number) =>
			Math.round(150 + ((y - 150) * f) / 900) * s.width +
			Math.round(200 + ((x - 200) * f) / 900);
		const layerAt = (x: number, y: number) =>
			s.objects.find((o) => o.id === s.object[at(x, y)])?.layer;

		expect(layerAt(120, 120)).toBe("left");
		expect(layerAt(280, 120)).toBe("right");
		expect(s.object[at(200, 120)]).toBe(0);
		expect(s.object[at(200, 40)]).toBe(0);
		for (const i of [0, 1, 2]) {
			const p = at(100 + i * 100, 250);
			expect(layerAt(100 + i * 100, 250)).toBe("dots");
			expect(s.instance[p]).toBe(i);
		}
		// Ids are 1..n, distinct, and every covered pixel names one of them.
		expect(s.objects.map((o) => o.id)).toEqual(s.objects.map((_, i) => i + 1));
		s.mask.forEach((m, i) => {
			if (m) expect(s.object[i]).toBeGreaterThan(0);
		});

		const rgba = await c.renderFrame({ frame: 0, format: "rgba" });
		expect(truth.rgba.equals(rgba)).toBe(true);
	});
});

describe("truthLabels", () => {
	it("labels the camera and each object's boxes", async () => {
		const c = new Composition({
			width: W,
			height: H,
			fps: FPS,
			durationFrames: 1,
			backgroundColor: "#000000",
		});
		c.add([
			Layer.camera({
				x: 200,
				y: 150,
				z: -900,
				targetX: 200,
				targetY: 150,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
			Layer3D.sphere({ id: "ball", radius: 50, x: 150, y: 150, z: 0 }),
			// A box in front of the ball's right half.
			Layer3D.roundedBox({
				id: "wall",
				width: 60,
				height: 200,
				depth: 10,
				x: 190,
				y: 150,
				z: -100,
			}),
		]);
		const [scene] = (await c.renderTruth(0)).scenes;
		const { camera, objects } = truthLabels(scene);
		const f = H / 2 / Math.tan((scene.camera.fov * Math.PI) / 360);
		expect(camera.intrinsics.fy).toBeCloseTo(f, 3);
		expect(camera.intrinsics.fx).toBeCloseTo(f, 3);
		expect([camera.intrinsics.cx, camera.intrinsics.cy]).toEqual([
			W / 2,
			H / 2,
		]);

		const ball = objects.find((o) => o.layer === "ball");
		const wall = objects.find((o) => o.layer === "wall");
		if (!ball?.box3d || !ball.box2d || !ball.projectedBox2d || !wall)
			throw new Error("missing labels");
		expect(ball.box3d.center.map((v) => Math.round(v))).toEqual([150, 150, 0]);
		for (const v of ball.box3d.size) expect(v).toBeCloseTo(100, 0);
		// The pixels it shows sit inside where its box projects, and the wall
		// in front hides part of it.
		const [x0, y0, x1, y1] = ball.box2d;
		const [p0, q0, p1, q1] = ball.projectedBox2d;
		expect(x0).toBeGreaterThanOrEqual(Math.floor(p0));
		expect(y0).toBeGreaterThanOrEqual(Math.floor(q0));
		expect(x1).toBeLessThanOrEqual(Math.ceil(p1));
		expect(y1).toBeLessThanOrEqual(Math.ceil(q1));
		expect(x1).toBeLessThan(p1 - 10);
		expect(wall.pixels).toBeGreaterThan(0);
		// Pixels add up to the covered area.
		const covered = scene.mask.reduce((n, m) => n + m, 0);
		expect(objects.reduce((n, o) => n + o.pixels, 0)).toBe(covered);
	});
});

describe("amodal truth and labels", () => {
	it("measures what share of each object shows, and names what it is", async () => {
		const c = new Composition({
			width: W,
			height: H,
			fps: FPS,
			durationFrames: 1,
			backgroundColor: "#000000",
		});
		c.add([
			Layer.camera({
				x: 200,
				y: 150,
				z: -900,
				targetX: 200,
				targetY: 150,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
			Layer3D.sphere({
				id: "ball",
				label: "toy",
				radius: 50,
				x: 150,
				y: 150,
				z: 0,
			}),
			Layer3D.roundedBox({
				id: "wall",
				label: "wall",
				width: 60,
				height: 200,
				depth: 10,
				x: 190,
				y: 150,
				z: -100,
			}),
			Layer3D.sphere({ id: "free", radius: 30, x: 320, y: 150, z: 0 }),
		]);
		const plain = await c.renderTruth(0);
		const truth = await c.renderTruth({ frame: 0, amodal: true });
		// Measuring alone changes nothing else, the picture included.
		expect(truth.rgba.equals(plain.rgba)).toBe(true);
		expect(Array.from(truth.scenes[0].object)).toEqual(
			Array.from(plain.scenes[0].object),
		);

		const { objects } = truthLabels(truth.scenes[0]);
		const byLayer = (id: string) => {
			const o = objects.find((x) => x.layer === id);
			if (!o) throw new Error(`no ${id}`);
			return o;
		};
		const ball = byLayer("ball");
		const wall = byLayer("wall");
		const free = byLayer("free");
		expect(ball.label).toBe("toy");
		expect(wall.label).toBe("wall");
		expect(free.label).toBeUndefined();
		// The wall hides part of the ball; nothing is in front of the others.
		expect(ball.visibleFraction).toBeGreaterThan(0.2);
		expect(ball.visibleFraction).toBeLessThan(0.9);
		expect(wall.visibleFraction).toBe(1);
		expect(free.visibleFraction).toBe(1);
		// Drawn alone it reaches past where it shows.
		const [x0, y0, x1, y1] = ball.box2d ?? [0, 0, 0, 0];
		const [a0, b0, a1, b1] = ball.amodalBox2d ?? [0, 0, 0, 0];
		expect(a0).toBeLessThanOrEqual(x0);
		expect(b0).toBeLessThanOrEqual(y0);
		expect(a1).toBeGreaterThan(x1);
		expect(b1).toBeGreaterThanOrEqual(y1);
		// Without amodal, no visibility is claimed.
		expect(
			truthLabels(plain.scenes[0]).objects[0].visibleFraction,
		).toBeUndefined();
	});
});
