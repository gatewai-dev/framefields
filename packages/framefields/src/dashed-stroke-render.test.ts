import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, Layer } from "./index.js";

async function decode(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const { data } = ctx.getImageData(0, 0, img.width, img.height);
	return (x: number, y: number) =>
		data[(Math.round(y) * img.width + Math.round(x)) * 4]!;
}

describe("dashed strokes", () => {
	// `strokeDashArray` is written as SVG writes it; it used to reach the path
	// pipeline as a string, which dropped the whole stroke.
	it("draws an SVG dash list on paths and parametric shapes, with gaps", async () => {
		const c = new Composition({
			width: 400,
			height: 200,
			fps: 30,
			durationMs: 1000,
			backgroundColor: "#000000",
		});
		c.add([
			Layer.shape("path", {
				id: "line",
				position: "absolute",
				x: 0,
				y: 0,
				width: 400,
				height: 200,
				d: "M0 40 L400 40",
				fillType: "none",
				strokeColor: "#ffffff",
				strokeWidth: 8,
				strokeLineCap: "butt",
				strokeDashArray: "20 20",
			}),
			Layer.shape("rect", {
				id: "box",
				position: "absolute",
				x: 40,
				y: 100,
				width: 320,
				height: 80,
				fillType: "none",
				strokeColor: "#ffffff",
				strokeWidth: 8,
				strokeLineCap: "butt",
				strokeDashArray: "40, 40",
			}),
		]);
		const at = await decode(await c.renderFrame({ frame: 0 }));
		// Dashes on the line at 0–20, 40–60 …; gaps at 20–40, 60–80 …
		expect(at(10, 40)).toBeGreaterThan(200);
		expect(at(50, 40)).toBeGreaterThan(200);
		expect(at(30, 40)).toBeLessThan(40);
		expect(at(70, 40)).toBeLessThan(40);
		// The rect's top edge runs from its corner: a dash, then a gap.
		expect(at(60, 100)).toBeGreaterThan(200);
		expect(at(100, 100)).toBeLessThan(40);
	});
});
