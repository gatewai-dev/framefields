/**
 * Emoji in text draw from the registered color emoji font: the renderer
 * preloads each one (text layers reach it as `kind: "text"`, and emoji as
 * whole graphemes such as "❤️"), and draws it on its own advance.
 */
import { fileURLToPath } from "node:url";
import { Canvas, loadImage } from "skia-canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { Composition, FontManager, Layer } from "./index.js";

const asset = (path: string) =>
	fileURLToPath(new URL(`../../../${path}`, import.meta.url));

beforeAll(async () => {
	await FontManager.register("assets/fonts/Inter.ttf");
	await FontManager.registerEmojiFont(
		asset("packages/renderer/src/assets/NotoColorEmoji.ttf"),
	);
});

async function render(text: string) {
	const comp = new Composition({
		width: 300,
		height: 100,
		fps: 30,
		durationFrames: 1,
		backgroundColor: "#000000",
	});
	comp.add(
		Layer.box({
			width: 300,
			height: 100,
			background: "#000000",
			children: [
				Layer.text(text, {
					position: "absolute",
					x: 20,
					y: 20,
					fontFamily: "Inter",
					fontSize: 40,
					fill: "#ffffff",
				}),
			],
		}),
	);
	const img = await loadImage(await comp.renderFrame({ frame: 0 }));
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	return ctx.getImageData(0, 0, img.width, img.height).data;
}

/** Pixels that are clearly coloured (not black, white or grey). */
function colored(data: Uint8ClampedArray): number {
	let n = 0;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] as number;
		const g = data[i + 1] as number;
		const b = data[i + 2] as number;
		if (Math.max(r, g, b) - Math.min(r, g, b) > 60) n++;
	}
	return n;
}

describe("emoji", () => {
	it("draw in color, with variation selectors", async () => {
		expect(colored(await render("ab"))).toBe(0);
		expect(colored(await render("a 🚀"))).toBeGreaterThan(200);
		expect(colored(await render("a ❤️"))).toBeGreaterThan(200);
	});
});
