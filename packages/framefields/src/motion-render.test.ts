/**
 * Shape morphing and stepped timing through the real renderer.
 */
import { describe, expect, it } from "vitest";
import {
	Composition,
	HeadlessMediaRenderer,
	Layer,
	LayerAnimation,
} from "./index.js";
import { decodePngPixels, getPixel } from "./test-utils/pixels.js";

function stage(frames = 31) {
	return new Composition({
		width: 200,
		height: 200,
		fps: 30,
		durationFrames: frames,
		backgroundColor: "#000000",
	});
}

const lit = (
	img: Awaited<ReturnType<typeof decodePngPixels>>,
	x: number,
	y: number,
) => getPixel(img, x, y).r > 128;

describe("shape morphing", () => {
	it("morphs a keyframed path between two shapes", async () => {
		const c = stage();
		c.add(
			Layer.shape("path", {
				position: "absolute",
				x: 0,
				y: 0,
				width: 200,
				height: 200,
				d: "M90 90 H110 V110 H90 Z",
				fillColor: "#ffffff",
			}).animate(
				LayerAnimation.keys("d", [
					[0, "M90 90 H110 V110 H90 Z"],
					[30, "M10 10 H190 V190 H10 Z"],
				]),
			),
		);
		const renderer = new HeadlessMediaRenderer();
		const at = async (f: number) =>
			decodePngPixels(await c.renderFrame({ frame: f, renderer }));
		const start = await at(0);
		const mid = await at(15);
		const end = await at(30);
		expect(lit(start, 100, 100)).toBe(true);
		expect(lit(start, 60, 60)).toBe(false);
		// Halfway: the square spans 50–150.
		expect(lit(mid, 60, 60)).toBe(true);
		expect(lit(mid, 40, 40)).toBe(false);
		expect(lit(end, 20, 20)).toBe(true);
	});
});

describe("stepped timing", () => {
	it("holds each pose for frameStep frames", async () => {
		const box = (stepped: boolean) => {
			const c = stage();
			const anim = LayerAnimation.keys("x", [
				[0, 0],
				[30, 150],
			]);
			c.add(
				Layer.box({
					position: "absolute",
					x: 0,
					y: 80,
					width: 40,
					height: 40,
					background: "#ffffff",
				}).animate(stepped ? [anim, LayerAnimation.stepped(2)] : [anim]),
			);
			return c;
		};
		const renderer = new HeadlessMediaRenderer();
		const leftEdge = async (c: Composition, f: number) => {
			const img = decodePngPixels(await c.renderFrame({ frame: f, renderer }));
			for (let x = 0; x < 200; x++) if (lit(await img, x, 100)) return x;
			return -1;
		};
		const stepped = box(true);
		const smooth = box(false);
		// On twos: frames 10 and 11 show the same pose; smooth moves 5 px.
		expect(await leftEdge(stepped, 11)).toBe(await leftEdge(stepped, 10));
		expect(await leftEdge(stepped, 12)).toBeGreaterThan(
			await leftEdge(stepped, 11),
		);
		expect(await leftEdge(smooth, 11)).toBeGreaterThan(
			await leftEdge(smooth, 10),
		);
	});
});
