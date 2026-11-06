/**
 * `fontVariations` sets a variable font's axes on a text layer, as CSS
 * `font-variation-settings` does: in layout (the measured box), in the
 * drawn glyphs, in `FontManager.measure`, and in spans. Inter's optical
 * size axis makes the check: at 100 px `opsz` follows the size to its 32
 * maximum, while `{ opsz: 14 }` draws the wider text cut, about 11% wider.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { Canvas, loadImage } from "skia-canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { Composition, FontManager, Layer, type LayoutNode } from "./index.js";

const INTER = path.resolve(
	import.meta.dirname,
	"../../..",
	"assets/fonts/Inter.ttf",
);
const hasInter = existsSync(INTER);
const W = 1200;
const H = 160;
const TEXT_CUT = { opsz: 14 };

/** Leftmost and rightmost columns with dark ink, and the first red column. */
async function columns(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, img.width, img.height).data;
	let left = img.width;
	let right = -1;
	let red = img.width;
	for (let i = 0; i < data.length; i += 4) {
		const x = (i / 4) % img.width;
		const [r, g, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
		if (r < 90 && g < 90 && b < 90) {
			left = Math.min(left, x);
			right = Math.max(right, x);
		}
		if (r > 200 && g < 60 && b < 60) red = Math.min(red, x);
	}
	return { ink: right - left, red };
}

/** An auto-width text in a row, followed by a red marker the layout places after it. */
async function render(text: LayoutNode): Promise<Buffer> {
	const comp = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#ffffff",
	});
	comp.add(
		Layer.flex({
			id: "row",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			dir: "row",
			align: "center",
			children: [
				text,
				Layer.box({
					id: "marker",
					width: 12,
					height: 12,
					background: "#ff0000",
				}),
			],
		}),
	);
	return comp.renderFrame({ frame: 0 });
}

const word = (fontVariations?: Record<string, number>) =>
	Layer.text("framefields", {
		id: "word",
		fontFamily: "Inter",
		fontSize: 100,
		fill: "#000000",
		...(fontVariations && { fontVariations }),
	}) as LayoutNode;

describe.skipIf(!hasInter)("fontVariations", () => {
	beforeAll(async () => {
		await FontManager.register(INTER);
	});

	it("measures with the axes it is given", () => {
		const auto = FontManager.measure("framefields", {
			fontFamily: "Inter",
			fontSize: 100,
		});
		const textCut = FontManager.measure("framefields", {
			fontFamily: "Inter",
			fontSize: 100,
			fontVariations: TEXT_CUT,
		});
		expect(textCut.width / auto.width).toBeCloseTo(10946 / 9830, 2);
	});

	it("lays out and draws the text at those axes", async () => {
		const auto = await columns(await render(word()));
		const textCut = await columns(await render(word(TEXT_CUT)));
		// The glyphs draw wider...
		expect(textCut.ink / auto.ink).toBeGreaterThan(1.08);
		// ...and the layout measured the same text, so the marker moved with them.
		expect(textCut.red - auto.red).toBeGreaterThan(0.08 * auto.ink);
	}, 60_000);

	it("carries the axes into spans that change only the weight", async () => {
		const spans = (fontVariations?: Record<string, number>) =>
			Layer.text(["frame", { text: "fields", fontWeight: 700 }], {
				id: "word",
				fontFamily: "Inter",
				fontSize: 100,
				fill: "#000000",
				...(fontVariations && { fontVariations }),
			}) as LayoutNode;
		const auto = await columns(await render(spans()));
		const textCut = await columns(await render(spans(TEXT_CUT)));
		expect(textCut.ink / auto.ink).toBeGreaterThan(1.08);
	}, 60_000);
});
