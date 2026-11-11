import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer } from "./index.js";

async function decode(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const { data } = ctx.getImageData(0, 0, img.width, img.height);
	return (x: number, y: number) => {
		const i = (Math.round(y) * img.width + Math.round(x)) * 4;
		return Array.from(data.subarray(i, i + 3));
	};
}

describe("shape stroke ink", () => {
	// A stroke is centered on the outline, so half of it lies outside the
	// layout box. The shape's layer used to be exactly the box, which cut a
	// circle's stroke into flat sides at its four edges.
	it("keeps the half of a stroke that lies outside the box", async () => {
		const c = new Composition({
			width: 400,
			height: 200,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});
		c.add([
			Layer.shape("circle", {
				id: "ring",
				position: "absolute",
				x: 100,
				y: 50,
				width: 100,
				height: 100,
				fillType: "none",
				strokeColor: "#ffffff",
				strokeWidth: 20,
			}),
			Layer.shape("rect", {
				id: "block",
				position: "absolute",
				x: 260,
				y: 60,
				width: 80,
				height: 80,
				fill: "#ff0000",
			}),
		]);
		const at = await decode(await c.renderFrame({ frame: 0 }));
		// The ring's outer edge is 60 px from its center (150, 100): outside the box on every side.
		for (const [x, y] of [
			[150, 43],
			[150, 157],
			[93, 100],
			[207, 100],
		] as const)
			expect(at(x, y)[0]).toBeGreaterThan(200);
		// Inside the stroke's hole and well outside the ring stay black.
		expect(at(150, 100)[0]).toBeLessThan(30);
		expect(at(150, 35)[0]).toBeLessThan(30);
		// A shape with no stroke keeps its exact box.
		expect(at(261, 61)).toEqual([255, 0, 0]);
		expect(at(339, 139)).toEqual([255, 0, 0]);
		expect(at(258, 100)[0]).toBeLessThan(30);
		expect(at(342, 100)[0]).toBeLessThan(30);
	});
});
