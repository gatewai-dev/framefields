import { beforeAll, describe, expect, it } from "vitest";
import { FontManager } from "../fonts/index.js";
import { Composition, Layer, themes } from "../index.js";
import { computeMse, decodePngPixels, getPixel } from "../test-utils/pixels.js";
import { Annotate, Counter, TextReveal } from "./testing.js";

/**
 * Render tests for the M2 components (spec §7.4–7.6): reveals end on exactly
 * the static text, frames don't depend on render order, marks land where the
 * text is.
 */
const W = 960;
const H = 320;

beforeAll(async () => {
	await FontManager.register("assets/fonts/Inter.ttf");
});

function comp(
	nodes: Parameters<Composition["add"]>[0],
	background = "#0d0e11",
) {
	const c = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationMs: 6000,
		backgroundColor: background,
	});
	c.add(nodes);
	return c;
}
const frame = async (c: Composition, n: number) =>
	decodePngPixels(await c.renderFrame({ frame: n }));

describe("TextReveal (render)", () => {
	const text = "Ship it faster";
	const placed = { x: 40, y: 100, fontSize: 80 };
	const reference = () =>
		Layer.text(text, {
			position: "absolute",
			...placed,
			fontFamily: "Inter",
			fill: themes.graphite.color.ink,
			align: "start",
		});

	for (const style of [
		"rise",
		"blur",
		"slam",
		"scramble",
		"type",
		"wipe",
		"flip",
		"stream",
	] as const) {
		it(`${style} ends on exactly the static text`, async () => {
			const node = TextReveal({ text, style, caret: false, ...placed });
			const end = (node.cues.revealed[0]?.frame ?? 0) + 2;
			const got = await frame(comp(node), end);
			const want = await frame(comp(reference()), end);
			expect(computeMse(got.pixels, want.pixels)).toBeLessThan(0.05);
		});
	}

	it("is not there before its units start", async () => {
		const node = TextReveal({ text, style: "rise", ...placed, at: 10 });
		const img = await frame(comp(node), 5);
		const empty = await frame(comp([]), 5);
		expect(computeMse(img.pixels, empty.pixels)).toBe(0);
	});

	it("renders the same frame in any order (scramble)", async () => {
		const build = () =>
			comp(TextReveal({ text, style: "scramble", seed: 4, ...placed }));
		const frames = [3, 9, 15];
		const forward = await Promise.all(frames.map((f) => frame(build(), f)));
		const c = build();
		const backward: Awaited<ReturnType<typeof frame>>[] = [];
		for (const f of [...frames].reverse()) backward.unshift(await frame(c, f));
		forward.forEach((img, i) => {
			expect(computeMse(img.pixels, (backward[i] as typeof img).pixels)).toBe(
				0,
			);
		});
	});
});

describe("Counter (render)", () => {
	it("holds still once settled", async () => {
		const node = Counter({ to: 48210, x: 40, y: 60, fontSize: 120 });
		const settled = node.cues.settled[0]?.frame ?? 0;
		const c = comp(node);
		const a = await frame(c, settled + 1);
		const b = await frame(c, settled + 30);
		expect(computeMse(a.pixels, b.pixels)).toBe(0);
		// Digits are drawn (bright ink in the number's band).
		let ink = 0;
		for (let x = 40; x < 500; x += 3) if (getPixel(a, x, 130).r > 180) ink++;
		expect(ink).toBeGreaterThan(5);
	});
});

describe("Annotate (render)", () => {
	it("underlines each line of a wrapped phrase", async () => {
		const head = Layer.text("mark these words", {
			position: "absolute",
			x: 40,
			y: 40,
			width: 380,
			fontSize: 64,
			fontFamily: "Inter",
			fill: "#1a1814",
		});
		const mark = Annotate({
			target: { text: head, match: "these words" },
			color: "#ff0000",
			hand: false,
		});
		const lines = mark.cues.drawn[0]?.frame ?? 0;
		const img = await frame(comp([head, mark], "#ffffff"), lines + 2);
		const redRows = new Set<number>();
		for (let y = 40; y < 260; y++)
			for (let x = 40; x < 420; x += 4) {
				const p = getPixel(img, x, y);
				if (p.r > 200 && p.g < 90 && p.b < 90) redRows.add(Math.round(y / 20));
			}
		// Two separate bands of red: one under each line.
		const bands = [...redRows].sort((a, b) => a - b);
		expect(bands.length).toBeGreaterThanOrEqual(2);
		expect(
			(bands[bands.length - 1] as number) - (bands[0] as number),
		).toBeGreaterThanOrEqual(2);
	});
});
