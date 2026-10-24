import { beforeAll, describe, expect, it } from "vitest";
import { FontManager } from "../fonts/index.js";
import { Composition } from "../index.js";
import { computeMse, decodePngPixels, getPixel } from "../test-utils/pixels.js";
import { CodeBlock, Meter, TitleCard } from "./index.js";

/**
 * Render tests for the M4 components (spec §7.9–7.12): a settled diff is the
 * new code, fractional stars fill partway, frames don't depend on order.
 */
beforeAll(async () => {
	await FontManager.register("assets/fonts/Inter.ttf");
	await FontManager.register("assets/fonts/JetBrainsMono.ttf");
});
function comp(nodes: Parameters<Composition["add"]>[0]) {
	const c = new Composition({
		width: 960,
		height: 540,
		fps: 30,
		durationMs: 8000,
		backgroundColor: "#0d0e11",
	});
	c.add(nodes);
	return c;
}
const frame = async (c: Composition, n: number) =>
	decodePngPixels(await c.renderFrame({ frame: n }));

describe("CodeBlock (render)", () => {
	it("a settled diff looks exactly like the new code", async () => {
		const before = "const a = 1;\nconst b = 2;\nlog(a + b);";
		const after = "const a = 1;\n  log(a);\nconst c = 3;\nlog(a + b);";
		const diffed = CodeBlock({
			code: before,
			diff: { to: after, at: 5, duration: 20 },
			x: 40,
			y: 40,
		});
		const end = (diffed.cues.diff[0]?.end ?? 0) + 40;
		const got = await frame(comp(diffed), end);
		const want = await frame(
			comp(CodeBlock({ code: after, x: 40, y: 40 })),
			end,
		);
		expect(computeMse(got.pixels, want.pixels)).toBeLessThan(0.05);
	});
});

describe("Meter (render)", () => {
	it("3.5 stars fill three stars and half of the fourth", async () => {
		const m = Meter({
			value: 3.5,
			kind: "stars",
			size: 500,
			x: 0,
			y: 100,
			countDuration: 10,
		});
		const img = await frame(comp(m), 30);
		const cell = (500 - 500 * 0.03 * 4) / 5;
		const at = (k: number, f: number) =>
			getPixel(img, k * (cell + 500 * 0.03) + cell * f, 100 + cell * 0.55);
		const accent = (p: { b: number; r: number }) => p.b > 200 && p.r < 150;
		expect(accent(at(2, 0.5))).toBe(true);
		expect(accent(at(3, 0.3))).toBe(true);
		expect(accent(at(3, 0.7))).toBe(false);
		expect(accent(at(4, 0.5))).toBe(false);
	});
});

describe("TitleCard (render)", () => {
	it("renders the same frames in any order", async () => {
		const build = () =>
			comp(
				TitleCard({
					kicker: "Chapter",
					title: "Ship it",
					subtitle: "faster",
					x: 80,
					y: 80,
					width: 800,
				}),
			);
		const frames = [6, 20, 60];
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
