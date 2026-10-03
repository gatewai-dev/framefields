import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, GradientMap, Layer, Layer3D } from "./index.js";

const W = 800;
const H = 600;

async function pixelAt(png: Buffer, x: number, y: number) {
	const img = await loadImage(png);
	const ctx = new Canvas(img.width, img.height).getContext("2d");
	ctx.drawImage(img, 0, 0);
	const [r, g, b, a] = ctx.getImageData(
		Math.round(x),
		Math.round(y),
		1,
		1,
	).data;
	return { r, g, b, a };
}

const isBlue = (p: { r: number; g: number; b: number }) =>
	p.b > 180 && p.r < 90 && p.g < 90;
const isRed = (p: { r: number; g: number; b: number }) =>
	p.r > 180 && p.g < 90 && p.b < 90;

describe("3D scene regressions", () => {
	it("Layer3D.grid draws divisions as line quads, each inside the texture limit", () => {
		const grid = Layer3D.grid({
			width: 9000,
			height: 14000,
			divisions: 10,
			lineWidth: 4,
		});
		const lines = grid.children ?? [];
		// 11 lines each way; long lines are split into segments of at most 4096 px.
		expect(lines.length).toBe(
			11 * Math.ceil(14000 / 4096) + 11 * Math.ceil(9000 / 4096),
		);
		for (const line of lines) {
			expect(
				Math.max(Number(line.width), Number(line.height)),
			).toBeLessThanOrEqual(4096);
			expect(Math.min(Number(line.width), Number(line.height))).toBe(4);
		}
	});

	it("Layer3D.carousel puts item 0 nearest the camera, every item facing out", () => {
		const items = [0, 1, 2, 3].map((i) =>
			Layer.box({ id: `c${i}`, width: 100, height: 60 }),
		);
		const ring = Layer3D.carousel({ radius: 500, items });
		const [front, right, back, left] = ring.items ?? [];
		// The default camera looks down +z from -z: the front item sits at -radius, unrotated.
		expect(front.z).toBeCloseTo(-500);
		expect(front.rotateY).toBeCloseTo(0);
		expect(back.z).toBeCloseTo(500);
		expect(Math.abs(Number(back.rotateY))).toBeCloseTo(180);
		// rotateY 90 faces -x (the cube's convention), so the +x item turns -90.
		expect(right.x).toBeCloseTo(500);
		expect(right.rotateY).toBeCloseTo(-90);
		expect(left.rotateY).toBeCloseTo(-270);
	});

	it("a one-sided 3D quad facing the camera is drawn, one facing away is culled", async () => {
		const comp = new Composition({
			width: W,
			height: H,
			fps: 30,
			durationFrames: 2,
			backgroundColor: "#000000",
		});
		const card = (id: string, x: number, rotateY: number, background: string) =>
			Layer.box({
				id,
				is3D: true,
				twoSided: false,
				x,
				y: 200,
				z: 0,
				width: 200,
				height: 200,
				rotateY,
				background,
			});
		comp.add(card("facing", 120, 0, "#0000ff"));
		comp.add(card("away", 480, 180, "#ff0000"));
		const png = await comp.renderFrame({ frame: 0 });
		expect(isBlue(await pixelAt(png, 220, 300))).toBe(true);
		const away = await pixelAt(png, 580, 300);
		expect(isRed(away)).toBe(false);
	});

	it("cuts between cameras: the camera whose window holds the frame is used", async () => {
		const comp = new Composition({
			width: W,
			height: H,
			fps: 30,
			durationFrames: 20,
			backgroundColor: "#000000",
		});
		const shot = (id: string, from: number, eyeX: number) =>
			Layer.box({
				id,
				x: 0,
				y: 0,
				width: W,
				height: H,
				startFrame: from,
				durationFrames: 10,
				children: [
					Layer.camera({
						id: `${id}-cam`,
						x: eyeX,
						y: H / 2,
						z: -700,
						targetX: eyeX,
						targetY: H / 2,
						targetZ: 0,
					}),
				],
			});
		comp.add(shot("a", 0, 0));
		comp.add(shot("b", 10, W));
		// A blue card on the left half of the world, red on the right.
		comp.add(
			Layer.box({
				id: "left",
				is3D: true,
				x: -150,
				y: 200,
				z: 0,
				width: 300,
				height: 200,
				background: "#0000ff",
			}),
		);
		comp.add(
			Layer.box({
				id: "right",
				is3D: true,
				x: W - 150,
				y: 200,
				z: 0,
				width: 300,
				height: 200,
				background: "#ff0000",
			}),
		);
		expect(
			isBlue(await pixelAt(await comp.renderFrame({ frame: 5 }), W / 2, H / 2)),
		).toBe(true);
		expect(
			isRed(await pixelAt(await comp.renderFrame({ frame: 15 }), W / 2, H / 2)),
		).toBe(true);
	});

	it("same-sized 3D leaf layers keep their own textures until the 3D pass draws them", async () => {
		const comp = new Composition({
			width: W,
			height: H,
			fps: 30,
			durationFrames: 2,
			backgroundColor: "#000000",
		});
		const leaf = (id: string, x: number, fillColor: string) =>
			Layer.shape("rect", {
				id,
				is3D: true,
				x,
				y: 200,
				z: 0,
				width: 200,
				height: 200,
				fillColor,
			});
		comp.add(leaf("first", 120, "#0000ff"));
		comp.add(leaf("second", 480, "#ff0000"));
		const png = await comp.renderFrame({ frame: 0 });
		expect(isBlue(await pixelAt(png, 220, 300))).toBe(true);
		expect(isRed(await pixelAt(png, 580, 300))).toBe(true);
	});

	it("an effect chain on a canvas-sized clip stays inside its overflow:hidden box", async () => {
		// A canvas-sized media layer's effect passes used to borrow the live canvas
		// from the texture pool and paint the raw frame onto it outside the clip.
		const red = new Canvas(W, H);
		const ctx = red.getContext("2d");
		ctx.fillStyle = "#ff0000";
		ctx.fillRect(0, 0, W, H);
		const file = path.join(
			await fs.mkdtemp(path.join(os.tmpdir(), "gf-clip-")),
			"red.png",
		);
		await fs.writeFile(file, await red.toBuffer("png"));

		const comp = new Composition({
			width: W,
			height: H,
			fps: 30,
			durationFrames: 2,
			backgroundColor: "#ffffff",
		});
		const plate = Layer.image(file, {
			id: "plate",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			fit: "cover",
		}).apply(
			new GradientMap({
				stops: [
					{ position: 0, color: "#0000ff" },
					{ position: 1, color: "#0000ff" },
				],
			}),
		);
		comp.add(
			Layer.box({
				id: "clip",
				x: 0,
				y: 0,
				width: W / 2,
				height: H,
				overflow: "hidden",
				children: [plate],
			}),
		);
		const png = await comp.renderFrame({ frame: 0 });
		expect(isBlue(await pixelAt(png, W / 4, H / 2))).toBe(true);
		const outside = await pixelAt(png, (3 * W) / 4, H / 2);
		expect(isRed(outside)).toBe(false);
		expect(outside.r).toBeGreaterThan(200);
	});
});
