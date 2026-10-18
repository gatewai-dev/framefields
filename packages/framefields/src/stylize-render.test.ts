/**
 * Stylize effects through the real renderer, on a synthetic clip: each look
 * changes the picture the way it says it does.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	Ascii,
	Composition,
	Gooey,
	HeadlessMediaRenderer,
	Kaleidoscope,
	Layer,
	Pixelate,
	Posterize,
	RGBSplit,
} from "./index.js";
import { decodePngPixels, getPixel } from "./test-utils/pixels.js";

const S = 200;

function stage() {
	return new Composition({
		width: S,
		height: S,
		fps: 30,
		durationFrames: 2,
		backgroundColor: "#000000",
	});
}

/** A still: horizontal gray ramp with a white square in the left half. */
let clip = "";
beforeAll(async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-stylize-"));
	clip = path.join(dir, "still.mp4");
	const c = stage();
	c.add([
		Layer.box({
			position: "absolute",
			x: 0,
			y: 0,
			width: S,
			height: S,
			background: "linear-gradient(90deg, #000000, #ffffff)",
		}),
		Layer.box({
			position: "absolute",
			x: 40,
			y: 80,
			width: 40,
			height: 40,
			background: "#ffffff",
		}),
	]);
	const r = await c.renderVideo({ outputPath: clip, quality: "lossless" });
	await r.cleanup?.();
}, 60_000);

// biome-ignore lint/suspicious/noExplicitAny: any generated effect class
async function look(effect: any) {
	const c = stage();
	c.add(
		Layer.video(clip, {
			position: "absolute",
			x: 0,
			y: 0,
			width: S,
			height: S,
			fit: "cover",
			muted: true,
		}).withEffect(effect),
	);
	return decodePngPixels(
		await c.renderFrame({ frame: 0, renderer: new HeadlessMediaRenderer() }),
	);
}

describe("stylize effects", () => {
	it("Pixelate makes flat cells", async () => {
		const img = await look(new Pixelate({ size: 20 }));
		// Inside one 20 px cell of the ramp, every pixel is the same.
		const a = getPixel(img, 141, 5).r;
		expect(Math.abs(getPixel(img, 158, 18).r - a)).toBeLessThan(3);
		// The next cell is brighter.
		expect(getPixel(img, 165, 5).r).toBeGreaterThan(a + 10);
	});

	it("Posterize snaps to a palette", async () => {
		const img = await look(new Posterize({ palette: "gameboy" }));
		const allowed = [
			[0x0f, 0x38, 0x0f],
			[0x30, 0x62, 0x30],
			[0x8b, 0xac, 0x0f],
			[0x9b, 0xbc, 0x0f],
		];
		for (let x = 5; x < S; x += 23) {
			const p = getPixel(img, x, 30);
			const d = Math.min(
				...allowed.map(
					([r, g, b]) =>
						Math.abs(p.r - r) + Math.abs(p.g - g) + Math.abs(p.b - b),
				),
			);
			expect(d).toBeLessThan(12);
		}
	});

	it("RGBSplit pulls red and blue apart", async () => {
		const img = await look(new RGBSplit({ amount: 10 }));
		// Left of the white square (x 40): red reads from +10 px, so it is lit; blue is not.
		const p = getPixel(img, 35, 100);
		expect(p.r).toBeGreaterThan(p.b + 80);
		const q = getPixel(img, 85, 100);
		expect(q.b).toBeGreaterThan(q.r + 30);
	});

	it("Kaleidoscope mirrors around the center", async () => {
		const img = await look(new Kaleidoscope({ segments: 4 }));
		const a = getPixel(img, 60, 100);
		const b = getPixel(img, 140, 100);
		expect(Math.abs(a.r - b.r)).toBeLessThan(12);
	});

	it("Ascii draws glyphs on the background color", async () => {
		const img = await look(
			new Ascii({ cellSize: 10, fg: "#ffffff", bg: "#0000ff" }),
		);
		let bg = 0;
		let fg = 0;
		for (let y = 80; y < 120; y++) {
			for (let x = 40; x < 80; x++) {
				const p = getPixel(img, x, y);
				if (p.b > 200 && p.r < 40) bg++;
				if (p.r > 200) fg++;
			}
		}
		// The white square is dense glyphs: both colors present.
		expect(fg).toBeGreaterThan(200);
		expect(bg).toBeGreaterThan(100);
	});

	it("Gooey melts nearby shapes together", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-gooey-"));
		const svg = path.join(dir, "dots.svg");
		await fs.writeFile(
			svg,
			`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">` +
				`<circle cx="72" cy="100" r="20" fill="#fff"/><circle cx="128" cy="100" r="20" fill="#fff"/></svg>`,
		);
		const render = async (gooey: boolean) => {
			const c = stage();
			const dots = Layer.svg(svg, {
				position: "absolute",
				x: 0,
				y: 0,
				width: S,
				height: S,
			});
			c.add(
				gooey
					? dots.withEffect(new Gooey({ radius: 24, threshold: 0.3 }))
					: dots,
			);
			return decodePngPixels(
				await c.renderFrame({
					frame: 0,
					renderer: new HeadlessMediaRenderer(),
				}),
			);
		};
		// The gap between the dots (x 92–108) is empty without it, bridged with it.
		expect(getPixel(await render(false), 100, 100).r).toBeLessThan(10);
		expect(getPixel(await render(true), 100, 100).r).toBeGreaterThan(150);
	});
});
