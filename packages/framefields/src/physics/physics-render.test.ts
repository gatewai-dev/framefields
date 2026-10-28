/**
 * Physics through the real renderer: layers land where their bodies are,
 * with the renderer's pivot and rotation direction, and body signals drive
 * other props.
 */
import { describe, expect, it } from "vitest";
import { Composition, Layer, Layer3D, LayerAnimation } from "../index.js";
import { decodePngPixels, getPixel } from "../test-utils/pixels.js";
import { Physics } from "./index.js";

const FPS = 30;

function comp(width = 400, height = 400) {
	return new Composition({
		width,
		height,
		fps: FPS,
		durationFrames: 60,
		backgroundColor: "#000000",
	});
}

async function frame(c: Composition, f: number) {
	return decodePngPixels(await c.renderFrame({ frame: f }));
}

describe("physics render", () => {
	it("renders a turned layer exactly over its body (pivot and rotation direction)", async () => {
		const c = comp();
		const plank = Layer.box({
			id: "plank",
			position: "absolute",
			x: 120,
			y: 120,
			width: 200,
			height: 40,
			anchorX: 0,
			anchorY: 0,
			rotation: 40,
			background: "#ffffff",
		});
		c.add(plank);
		const world = await Physics.world2d({ fps: FPS, frames: 30, gravity: 0 });
		const body = world.body(plank, { angularVelocity: 60 });
		world.simulate();

		const f = 20;
		const img = await frame(c, f);
		let sx = 0;
		let sy = 0;
		let n = 0;
		for (let y = 0; y < img.height; y++) {
			for (let x = 0; x < img.width; x++) {
				const w = getPixel(img, x, y).r / 255;
				sx += x * w;
				sy += y * w;
				n += w;
			}
		}
		const ctx = { frame: f, fps: FPS } as never;
		expect(sx / n).toBeCloseTo(body.centerX.get(ctx) as number, -0.5);
		expect(sy / n).toBeCloseTo(body.centerY.get(ctx) as number, -0.5);
		// Near both ends along the turned axis (clockwise, y down): plank;
		// across it: background. A flipped rotation direction fails this.
		const angle = ((body.rotation.get(ctx) as number) * Math.PI) / 180;
		const cx = body.centerX.get(ctx) as number;
		const cy = body.centerY.get(ctx) as number;
		const along = (d: number) => [
			cx + d * Math.cos(angle),
			cy + d * Math.sin(angle),
		];
		const across = (d: number) => [
			cx - d * Math.sin(angle),
			cy + d * Math.cos(angle),
		];
		for (const [x, y] of [along(85), along(-85)]) {
			expect(getPixel(img, x, y).r).toBeGreaterThan(200);
		}
		for (const [x, y] of [across(60), across(-60)]) {
			expect(getPixel(img, x, y).r).toBeLessThan(20);
		}
	});

	it("drops a box onto the floor and flashes on impact", async () => {
		const c = comp();
		const box = Layer.box({
			id: "box",
			position: "absolute",
			x: 150,
			y: 0,
			width: 100,
			height: 60,
			background: "#ffffff",
		});
		const flash = Layer.box({
			id: "flash",
			position: "absolute",
			x: 0,
			y: 380,
			width: 400,
			height: 20,
			background: "#ff0000",
			opacity: 0,
		});
		c.add([box, flash]);
		const world = await Physics.world2d({
			fps: FPS,
			frames: 60,
			impactDecay: 3,
		});
		world.walls({ width: 400, height: 380 });
		const body = world.body(box, { restitution: 0 });
		world.simulate();
		flash.animate(
			LayerAnimation.create().signal("opacity", body.impact, { multiplier: 2 }),
		);

		const hit = body.collisions[0].frame;
		const before = await frame(c, hit - 2);
		const during = await frame(c, hit);
		const after = await frame(c, 59);

		expect(getPixel(before, 200, 390).r).toBeLessThan(20);
		expect(getPixel(during, 200, 390).r).toBeGreaterThan(150);
		// Resting on the floor (y 380): bottom rows white, the start spot empty.
		expect(getPixel(after, 200, 350).r).toBeGreaterThan(200);
		expect(getPixel(after, 200, 30).r).toBeLessThan(20);
	});

	it("drops a 3D sphere onto the ground", async () => {
		const c = new Composition({
			width: 800,
			height: 600,
			fps: FPS,
			durationFrames: 60,
			backgroundColor: "#000000",
		});
		c.add([
			Layer.camera({
				x: 400,
				y: 300,
				z: -900,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
		]);
		const ball = Layer3D.sphere({
			id: "ball",
			radius: 60,
			x: 400,
			y: -200,
			z: 0,
			color: "#ff3030",
		});
		c.add(ball);
		const world = await Physics.world3d({ fps: FPS, frames: 60 });
		world.ground({ y: 360 });
		world.body(ball, { restitution: 0, angularDamping: 2 });
		world.simulate();

		const start = await frame(c, 0);
		const end = await frame(c, 59);
		expect(getPixel(start, 400, 300).r).toBeLessThan(20);
		const rest = getPixel(end, 400, 300);
		expect(rest.r).toBeGreaterThan(120);
		expect(rest.g).toBeLessThan(rest.r / 2);
	});

	it("drops a 3D shard with convex hull collider onto the ground", async () => {
		const c = new Composition({
			width: 800,
			height: 600,
			fps: FPS,
			durationFrames: 60,
			backgroundColor: "#000000",
		});
		c.add([
			Layer.camera({
				x: 400,
				y: 300,
				z: -900,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
		]);
		const shard = Layer3D.shard({
			id: "shard",
			radius: 60,
			facets: 12,
			seed: 123,
			x: 400,
			y: -200,
			z: 0,
			color: "#30ff30",
		});
		c.add(shard);
		const world = await Physics.world3d({ fps: FPS, frames: 60 });
		world.ground({ y: 360 });
		world.body(shard, { restitution: 0, angularDamping: 2 });
		world.simulate();

		const start = await frame(c, 0);
		const end = await frame(c, 59);
		expect(getPixel(start, 400, 300).g).toBeLessThan(20);
		const rest = getPixel(end, 400, 300);
		expect(rest.g).toBeGreaterThan(120);
		expect(rest.r).toBeLessThan(rest.g / 2);
	});
});
