import { beforeAll, describe, expect, it } from "vitest";
import { FontManager } from "../fonts/index.js";
import { Composition, Layer } from "../index.js";
import { computeMse, decodePngPixels, getPixel } from "../test-utils/pixels.js";
import { ChatThread, Confetti, Spotlight, Toasts } from "./testing.js";

/**
 * Render tests for the M5 components: nothing shows before its time (the
 * renderer draws base values before a track's first key, so components pin
 * first keys at frame 0), the spotlight's hole is lit and the rest dimmed,
 * and particle frames don't depend on render order.
 */
beforeAll(async () => {
	await FontManager.register("assets/fonts/Inter.ttf");
	await FontManager.registerEmojiFont(
		"../renderer/src/assets/NotoColorEmoji.ttf",
	);
});
function comp(
	nodes: Parameters<Composition["add"]>[0],
	background = "#0d0e11",
) {
	const c = new Composition({
		width: 960,
		height: 540,
		fps: 30,
		durationMs: 8000,
		backgroundColor: background,
	});
	c.add(nodes);
	return c;
}
const frame = async (c: Composition, n: number) =>
	decodePngPixels(await c.renderFrame({ frame: n }));

describe("ChatThread (render)", () => {
	it("shows a reply only once it lands", async () => {
		const chat = ChatThread({
			width: 960,
			height: 540,
			messages: [
				{ from: "me", text: "Shipped?", at: 0 },
				{ from: "sam", text: "Yes!", at: 60 },
			],
		});
		const c = comp(chat);
		const before = await frame(c, 30);
		const empty = await frame(
			comp(
				ChatThread({
					width: 960,
					height: 540,
					messages: [{ from: "me", text: "Shipped?", at: 0 }],
				}),
			),
			30,
		);
		expect(computeMse(before.pixels, empty.pixels)).toBe(0);
		const after = await frame(c, 90);
		expect(computeMse(after.pixels, empty.pixels)).toBeGreaterThan(0);
	});
});

describe("ChatThread reactions (render)", () => {
	/** Clearly red pixels: the Noto heart (no theme colour is this red). */
	const reds = (data: Uint8ClampedArray) => {
		let n = 0;
		for (let i = 0; i < data.length; i += 4)
			if (
				(data[i] as number) > 180 &&
				(data[i + 1] as number) < 90 &&
				(data[i + 2] as number) < 90
			)
				n++;
		return n;
	};
	it("draws an emoji reaction from the color emoji font", async () => {
		const thread = (reaction?: string) =>
			ChatThread({
				width: 960,
				height: 540,
				messages: [
					{ from: "me", text: "Shipped?", at: 0 },
					{ from: "sam", text: "Yes!", at: 10, reaction },
				],
			});
		const withHeart = await frame(comp(thread("❤️")), 120);
		const without = await frame(comp(thread()), 120);
		expect(reds(without.pixels)).toBe(0);
		expect(reds(withHeart.pixels)).toBeGreaterThan(40);
		// "heart" is shorthand for the same emoji.
		const word = await frame(comp(thread("heart")), 120);
		expect(computeMse(word.pixels, withHeart.pixels)).toBe(0);
	});
});

describe("Toasts (render)", () => {
	it("is empty before the first toast arrives", async () => {
		const t = Toasts({
			width: 960,
			height: 540,
			items: [{ at: 30, title: "Saved", kind: "success" }],
		});
		const img = await frame(comp(t), 10);
		const empty = await frame(comp([]), 10);
		expect(computeMse(img.pixels, empty.pixels)).toBe(0);
	});
});

describe("Spotlight (render)", () => {
	it("keeps the target lit and dims the rest", async () => {
		const target = { x: 300, y: 200, width: 200, height: 120 };
		const c = comp(
			[
				Layer.box({
					position: "absolute",
					x: 0,
					y: 0,
					width: 960,
					height: 540,
					background: "#ffffff",
				}),
				Spotlight({
					width: 960,
					height: 540,
					glide: 6,
					targets: [{ at: 0, target, padding: 10 }],
				}),
			],
			"#ffffff",
		);
		const img = await frame(c, 20);
		expect(getPixel(img, 400, 260).r).toBeGreaterThan(240);
		expect(getPixel(img, 80, 80).r).toBeLessThan(110);
	});
});

describe("Confetti (render)", () => {
	it("renders the same frame in any order", async () => {
		const build = () =>
			comp(
				Confetti({
					width: 960,
					height: 540,
					bursts: [{ at: 2, origin: [480, 500], count: 80 }],
					floor: true,
				}),
			);
		const frames = [8, 30, 70];
		const forward = await Promise.all(frames.map((f) => frame(build(), f)));
		const c = build();
		for (const [i, f] of [...frames].reverse().entries()) {
			const img = await frame(c, f);
			expect(
				computeMse(
					img.pixels,
					(forward[frames.length - 1 - i] as typeof img).pixels,
				),
			).toBe(0);
		}
	});
});
