/**
 * Rich-text spans on a text layer render with their own styles. The node
 * compositor used to build the layer's text op without `spans`, so a span's
 * fill (or size, weight, mark) was dropped and only the plain text drew.
 */
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import type { TextSpan } from "./index.js";
import {
	Composition,
	FontManager,
	Layer,
	LayerAnimation,
	rich,
	signal,
} from "./index.js";

const W = 400;
const H = 120;

/** Count of strongly red pixels, and of dark (black-ish) ones. */
async function inkColours(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, img.width, img.height).data;
	let red = 0;
	let dark = 0;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] ?? 0;
		const g = data[i + 1] ?? 0;
		const b = data[i + 2] ?? 0;
		if (r > 150 && g < 80 && b < 80) red++;
		if (r < 60 && g < 60 && b < 60) dark++;
	}
	return { red, dark };
}

async function render(
	content: (string | TextSpan)[] | TextSpan[],
	extra: Record<string, unknown> = {},
	frame = 0,
) {
	await FontManager.register("assets/fonts/Inter.ttf");
	const comp = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: 30,
		backgroundColor: "#ffffff",
	});
	comp.add(
		Layer.text(content, {
			id: "t",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			fontFamily: "Inter",
			fontWeight: 700,
			fontSize: 64,
			fill: "#000000",
			...extra,
		}),
	);
	return inkColours(await comp.renderFrame({ frame }));
}

describe("text layer spans", () => {
	it("draws a coloured span in its own colour", async () => {
		const { red, dark } = await render([
			{ text: "HH " },
			{ text: "HH", fill: "#dd0000" },
		]);
		expect(red).toBeGreaterThan(200);
		expect(dark).toBeGreaterThan(200);
	});

	it("draws spans authored with the rich tag", async () => {
		const { red } = await render(rich`HH ${{ text: "HH", fill: "#dd0000" }}`);
		expect(red).toBeGreaterThan(200);
	});

	it("reveals across a span whose text is a signal", async () => {
		// The black head is a signal: the reveal must measure its current text,
		// or the revealed characters slide into the red tail.
		const word = signal("HH");
		const content = [{ text: word }, { text: " HH", fill: "#dd0000" }];
		const extra = { animation: LayerAnimation.typewriter(0, 20) };
		const mid = await render(content, extra, 10);
		expect(mid.dark).toBeGreaterThan(100);
		expect(mid.red).toBe(0);
		expect((await render(content, extra, 25)).red).toBeGreaterThan(200);
	});

	it("keeps spans in step with a text reveal", async () => {
		const content = [{ text: "HH " }, { text: "HH", fill: "#dd0000" }];
		const extra = { animation: LayerAnimation.typewriter(0, 20) };
		// Halfway only the black "HH" is revealed; the red span is not reached.
		const half = await render(content, extra, 10);
		expect(half.dark).toBeGreaterThan(100);
		expect(half.red).toBe(0);
		const done = await render(content, extra, 25);
		expect(done.red).toBeGreaterThan(200);
		expect(done.dark).toBeGreaterThan(200);
	});
});
