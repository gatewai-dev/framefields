/**
 * Glyphs turned in the Slug shader (text on a path) keep a smooth edge:
 * the glyph quad is dilated so pixels just outside the outline still get
 * their partial coverage, and the two coverage rays are weighted, so a
 * slanted stem is a straight antialiased line, not a staircase.
 */
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, FontManager, Layer, TextPathBuilder } from "./index.js";

const SIZE = 800;

async function inkRows(png: Buffer): Promise<number[][]> {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, img.width, img.height).data;
	const rows: number[][] = [];
	for (let y = 0; y < img.height; y++) {
		const row: number[] = [];
		for (let x = 0; x < img.width; x++) row.push(1 - (data[(y * img.width + x) * 4] ?? 255) / 255);
		rows.push(row);
	}
	return rows;
}

describe("text antialiasing", () => {
	it("draws a glyph turned on a path with a straight, fully ramped edge", async () => {
		await FontManager.register("assets/fonts/Inter.ttf");
		const comp = new Composition({ width: SIZE, height: SIZE, fps: 30, durationFrames: 1, backgroundColor: "#ffffff" });
		comp.add(
			Layer.text("l", {
				id: "l",
				position: "absolute",
				x: 0,
				y: 0,
				width: SIZE,
				height: SIZE,
				fontFamily: "Inter",
				fontWeight: 700,
				fontSize: 500,
				fill: "#000000",
				// -30°: every glyph is turned by the path, inside the shader.
				pathOptions: TextPathBuilder.fromSvg("M 300 650 L 800 361").build(),
			} as never),
		);
		const rows = await inkRows(await comp.renderFrame({ frame: 0 }));

		// The left edge of the stem, row by row: its sub-pixel position from the
		// coverage summed across a window straddling it.
		const inked = rows.map((r, y) => ({ y, x: r.findIndex((v) => v > 0.5) })).filter((p) => p.x > 4);
		const mid = inked.slice(Math.floor(inked.length * 0.3), Math.floor(inked.length * 0.7));
		expect(mid.length).toBeGreaterThan(40);
		const pos = mid.map(({ y, x }) => {
			const window = rows[y]!.slice(x - 4, x + 4);
			return x - 4 + (8 - window.reduce((a, b) => a + b, 0));
		});
		const ys = mid.map((p) => p.y);
		const n = ys.length;
		const my = ys.reduce((a, b) => a + b, 0) / n;
		const mp = pos.reduce((a, b) => a + b, 0) / n;
		const k =
			ys.reduce((s, y, i) => s + (y - my) * (pos[i]! - mp), 0) /
			ys.reduce((s, y) => s + (y - my) ** 2, 0);
		const rms = Math.sqrt(pos.reduce((s, p, i) => s + (p - (mp + k * (ys[i]! - my))) ** 2, 0) / n);
		expect(rms).toBeLessThan(0.1);

		// The outer half of the ramp exists: pixels less than half covered.
		const outer = mid.filter(({ y, x }) => {
			const v = rows[y]![x - 1] ?? 0;
			return v > 0.02 && v < 0.5;
		}).length;
		expect(outer / mid.length).toBeGreaterThan(0.4);
	});
});
