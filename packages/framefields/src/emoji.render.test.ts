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
	await FontManager.register("assets/fonts/JetBrainsMono.ttf");
	await FontManager.registerEmojiFont(
		asset("packages/renderer/src/assets/NotoColorEmoji.ttf"),
	);
});

async function render(text: string, fontFamily = "Inter") {
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
					fontFamily,
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

/** Pixels with any ink (not the black background). */
function inked(data: Uint8ClampedArray): number {
	let n = 0;
	for (let i = 0; i < data.length; i += 4)
		if (
			Math.max(
				data[i] as number,
				data[i + 1] as number,
				data[i + 2] as number,
			) > 60
		)
			n++;
	return n;
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

	it("draws symbols like ✓ and © from the text font, not as blank emoji", async () => {
		for (const symbol of ["✓", "©", "★"]) {
			const img = await render(`a ${symbol}`);
			// White text ink, no color bitmap, and more ink than "a" alone.
			expect(colored(img)).toBe(0);
			expect(inked(img)).toBeGreaterThan(inked(await render("a")) + 30);
		}
	});

	it("takes a glyph the font lacks from another registered family", async () => {
		// JetBrains Mono has no ✓ or ★; Inter does.
		for (const symbol of ["✓", "★"]) {
			const img = await render(symbol, "JetBrains Mono");
			expect(colored(img)).toBe(0);
			expect(inked(img)).toBeGreaterThan(30);
		}
	});

	it("keeps text-default pictographs as text when the font has them", async () => {
		// Inter has ❤ (drawn white); ✈ it lacks, so that one is the color emoji.
		expect(colored(await render("a ❤"))).toBe(0);
		expect(colored(await render("a ✈"))).toBeGreaterThan(200);
	});
});
