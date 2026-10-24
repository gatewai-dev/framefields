import { beforeAll, describe, expect, it } from "vitest";
import { FontManager } from "../fonts/index.js";
import { Composition } from "../index.js";
import { computeMse, decodePngPixels } from "../test-utils/pixels.js";
import { Captions, Terminal } from "./testing.js";

/**
 * Render tests for the M3 components (spec §7.3, §7.8): word colour changes
 * on its exact frame, and frames don't depend on render order.
 */
beforeAll(async () => {
	await FontManager.register("assets/fonts/Inter.ttf");
	await FontManager.register("assets/fonts/JetBrainsMono.ttf");
});

const W = 960;
const H = 540;
function comp(nodes: Parameters<Composition["add"]>[0]) {
	const c = new Composition({
		width: W,
		height: H,
		fps: 30,
		durationMs: 8000,
		backgroundColor: "#202833",
	});
	c.add(nodes);
	return c;
}
const frame = async (c: Composition, n: number) =>
	decodePngPixels(await c.renderFrame({ frame: n }));
const words = "one two three"
	.split(" ")
	.map((text, i) => ({ text, start: 0.5 + i, end: 1.3 + i }));

describe("Captions (render)", () => {
	it("karaoke: a word changes colour on round(start × fps), not a frame before", async () => {
		const c = comp(Captions({ words, style: "karaoke", width: W, height: H }));
		const at = Math.round((words[1]?.start ?? 0) * 30); // word 2 starts at 1.5 s
		expect(at).toBe(45);
		const before = await frame(c, at - 2);
		const justBefore = await frame(c, at - 1);
		const on = await frame(c, at);
		expect(computeMse(before.pixels, justBefore.pixels)).toBe(0);
		expect(computeMse(justBefore.pixels, on.pixels)).toBeGreaterThan(0);
	});

	it("renders the same frame in any order", async () => {
		const build = () =>
			comp(Captions({ words, style: "highlight", width: W, height: H }));
		const frames = [20, 47, 80];
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

describe("Terminal (render)", () => {
	const script = [
		{ cmd: "pnpm add framefields" },
		{ spinner: "Resolving", for: 20, done: "1 package added" },
		{ output: Array.from({ length: 14 }, (_, i) => `line ${i}`) },
	];

	it("renders the same frame in any order (typing, spinner, scroll)", async () => {
		const build = () =>
			comp(Terminal({ script, rows: 6, x: 40, y: 40, seed: 3 }));
		const done =
			Terminal({ script, rows: 6, seed: 3 }).cues.done[0]?.frame ?? 100;
		const frames = [15, 60, done - 2, done + 5];
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

	it("holds still once the script is done (bar the caret blink)", async () => {
		const t = Terminal({ script, rows: 6, x: 40, y: 40, caret: "bar" });
		const done = t.cues.done[0]?.frame ?? 0;
		const c = comp(t);
		// Two frames inside one solid caret phase after the scroll has settled.
		const a = await frame(c, done + 6);
		const b = await frame(c, done + 12);
		expect(computeMse(a.pixels, b.pixels)).toBe(0);
	});
});
