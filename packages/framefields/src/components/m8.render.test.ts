import { beforeAll, describe, expect, it } from "vitest";
import { FontManager } from "../fonts/index.js";
import { Composition, Layer } from "../index.js";
import { computeMse, decodePngPixels, getPixel } from "../test-utils/pixels.js";
import {
	BeforeAfter,
	CardStack,
	DeviceFrame,
	Selection,
	TouchPoint,
} from "./index.js";

/**
 * Render tests for the M8 components: device content fills exactly the
 * screen, touches leave nothing behind, the split shows each side on its
 * own side of the divider, a selection draws, and a full card cycle comes
 * back to the frame it started on.
 */
beforeAll(async () => {
	await FontManager.register("assets/fonts/Inter.ttf");
});
function comp(nodes: Parameters<Composition["add"]>[0]) {
	const c = new Composition({
		width: 960,
		height: 540,
		fps: 30,
		durationMs: 12000,
		backgroundColor: "#0d0e11",
	});
	c.add(nodes);
	return c;
}
const frame = async (c: Composition, n: number) =>
	decodePngPixels(await c.renderFrame({ frame: n }));
const red = (p: { r: number; g: number; b: number }) =>
	p.r > 200 && p.g < 60 && p.b < 60;

describe("DeviceFrame (render)", () => {
	it("content authored in points fills the screen, and nothing else", async () => {
		const phone = DeviceFrame({
			x: 380,
			y: 20,
			height: 500,
			enter: false,
			elevation: 0,
			statusBar: false,
			island: false,
			content: Layer.box({
				position: "absolute",
				x: 0,
				y: 0,
				width: 393,
				height: 852,
				background: "#ff0000",
			}),
		});
		const r = phone.screenRect;
		const img = await frame(comp(phone), 0);
		const cx = r.x + r.width / 2;
		const cy = r.y + r.height / 2;
		expect(red(getPixel(img, Math.round(cx), Math.round(cy)))).toBe(true);
		// Just inside each edge (mid-side, clear of the rounded corners).
		expect(red(getPixel(img, Math.round(r.x + 2), Math.round(cy)))).toBe(true);
		expect(
			red(getPixel(img, Math.round(r.x + r.width - 3), Math.round(cy))),
		).toBe(true);
		expect(red(getPixel(img, Math.round(cx), Math.round(r.y + 2)))).toBe(true);
		// Just outside: bezel, not content.
		expect(red(getPixel(img, Math.round(r.x - 3), Math.round(cy)))).toBe(false);
		expect(
			red(getPixel(img, Math.round(cx), Math.round(r.y + r.height + 3))),
		).toBe(false);
	});
});

describe("TouchPoint (render)", () => {
	it("draws only while a finger is down", async () => {
		const t = TouchPoint({
			width: 960,
			height: 540,
			touches: [{ to: [480, 270], at: 30 }],
		});
		const c = comp(t);
		const empty = await frame(comp([]), 0);
		expect(computeMse((await frame(c, 10)).pixels, empty.pixels)).toBe(0);
		expect(
			computeMse((await frame(c, 31)).pixels, empty.pixels),
		).toBeGreaterThan(0);
		expect(
			computeMse((await frame(c, t.span.duration + 2)).pixels, empty.pixels),
		).toBe(0);
	});
});

describe("BeforeAfter (render)", () => {
	const side = (color: string) =>
		Layer.box({
			position: "absolute",
			x: 0,
			y: 0,
			width: 960,
			height: 540,
			background: color,
		});

	it("shows before left of the divider and after right of it", async () => {
		const ba = BeforeAfter({
			width: 960,
			height: 540,
			before: side("#ff0000"),
			after: side("#0000ff"),
			split: [
				[0, 0.3],
				[30, 0.7, "power2.inOut"],
			],
			handle: false,
			labels: false,
		});
		const c = comp(ba);
		for (const [f, at] of [
			[0, 0.3],
			[30, 0.7],
		] as const) {
			const img = await frame(c, f);
			const x = 960 * at;
			expect(red(getPixel(img, Math.round(x - 8), 270))).toBe(true);
			const right = getPixel(img, Math.round(x + 8), 270);
			expect(right.b > 200 && right.r < 60).toBe(true);
		}
	});
});

describe("Selection (render)", () => {
	it("highlights the selected text", async () => {
		const text = Layer.text("select these words", {
			position: "absolute",
			x: 100,
			y: 200,
			fontFamily: "Inter",
			fontSize: 48,
			fill: "#ffffff",
		});
		const sel = Selection({
			width: 960,
			height: 540,
			target: { text, match: "these" },
			drag: { frame: 0, end: 20 },
			color: "#3b82f6",
		});
		const plain = await frame(comp(text), 30);
		const lit = await frame(comp([sel, text]), 30);
		expect(computeMse(plain.pixels, lit.pixels)).toBeGreaterThan(0);
		const before = await frame(comp([sel, text]), 0);
		expect(computeMse(plain.pixels, before.pixels)).toBe(0);
	});
});

describe("CardStack (render)", () => {
	it("a full cycle comes back to the starting frame", async () => {
		const stack = CardStack({
			x: 160,
			y: 0,
			cards: [{ title: "One" }, { title: "Two" }, { title: "Three" }],
			every: 40,
			cardWidth: 420,
			cardHeight: 260,
		});
		const c = comp(stack);
		const first = await frame(c, 0);
		const back = await frame(c, (stack.cues.changes.at(-1)?.frame ?? 0) + 80);
		expect(computeMse(first.pixels, back.pixels)).toBeLessThan(0.5);
		const mid = await frame(c, 40 + 10);
		expect(computeMse(first.pixels, mid.pixels)).toBeGreaterThan(0);
	});
});
