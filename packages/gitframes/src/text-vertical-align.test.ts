/**
 * verticalAlign places a text block inside a box taller than the text:
 * "middle" centres its line box, "bottom" sits it on the floor, "top" (the
 * default) keeps it at the top. It used to be ignored, so text asked to be
 * centred in a pill sat at the pill's top.
 */
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Composition, FontManager, Layer } from "./index.js";

const W = 400;
const BOX = 400;
const FONT = 60;

/** The vertical centre of the ink (dark pixels) in a rendered frame. */
async function inkCentreY(png: Buffer): Promise<number> {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, img.width, img.height).data;
	let top = -1;
	let bottom = -1;
	for (let y = 0; y < img.height; y++)
		for (let x = 0; x < img.width; x++)
			if ((data[(y * img.width + x) * 4] ?? 255) < 128) {
				if (top < 0) top = y;
				bottom = y;
				break;
			}
	return (top + bottom) / 2;
}

async function render(verticalAlign?: "top" | "middle" | "bottom") {
	await FontManager.register("assets/fonts/Inter.ttf");
	const comp = new Composition({
		width: W,
		height: BOX,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#ffffff",
	});
	comp.add(
		Layer.text("HH", {
			id: "t",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: BOX,
			fontFamily: "Inter",
			fontWeight: 700,
			fontSize: FONT,
			fill: "#000000",
			align: "center",
			verticalAlign,
		}),
	);
	return inkCentreY(await comp.renderFrame({ frame: 0 }));
}

describe("text verticalAlign", () => {
	it("centres, bottoms and tops the text block in its box", async () => {
		const top = await render();
		const middle = await render("middle");
		const bottom = await render("bottom");
		expect(top).toBeLessThan(FONT);
		expect(Math.abs(middle - BOX / 2)).toBeLessThan(FONT * 0.25);
		expect(bottom).toBeGreaterThan(BOX - FONT);
	});
});
