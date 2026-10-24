import type { AudioLevels } from "@framefields/components";
import { beforeAll, describe, expect, it } from "vitest";
import { FontManager } from "../fonts/index.js";
import { Composition } from "../index.js";
import { computeMse, decodePngPixels, getPixel } from "../test-utils/pixels.js";
import {
	Backdrop,
	Captions,
	LogoReveal,
	Waveform,
	WordCycle,
} from "./index.js";

/**
 * Render tests for the M7 components: the lockup's name waits behind the
 * mark, draw and pop settle on the same frame, backdrops loop exactly, bars
 * follow their band on the composition's clock, a word roll stays inside
 * its slot, and the voice pulse only moves the active word.
 */
beforeAll(async () => {
	await FontManager.register("assets/fonts/Inter.ttf");
});
function comp(nodes: Parameters<Composition["add"]>[0], durationMs = 12000) {
	const c = new Composition({
		width: 960,
		height: 540,
		fps: 30,
		durationMs,
		backgroundColor: "#0d0e11",
	});
	c.add(nodes);
	return c;
}
const frame = async (c: Composition, n: number) =>
	decodePngPixels(await c.renderFrame({ frame: n }));
type Image = Awaited<ReturnType<typeof frame>>;

/** Pixels in a rect brighter than the background. */
function lit(img: Image, x0: number, y0: number, x1: number, y1: number) {
	let n = 0;
	for (let y = Math.round(y0); y < y1; y += 2)
		for (let x = Math.round(x0); x < x1; x += 2) {
			const p = getPixel(img, x, y);
			if (p.r + p.g + p.b > 120) n++;
		}
	return n;
}

const MARK = {
	d: "M0 0L100 0L100 100L0 100Z",
	viewBox: [100, 100] as [number, number],
	color: "#ffffff",
};

describe("LogoReveal (render)", () => {
	it("slide: the name stays hidden until the mark glides", async () => {
		const logo = LogoReveal({
			x: 100,
			y: 200,
			mark: MARK,
			name: "frames",
			markSize: 80,
			nameSize: 80,
			glint: false,
		});
		const c = comp(logo);
		const W = logo.width as number;
		// Right of the centred mark, inside the name's final box.
		const region = [100 + (W + 80) / 2 + 4, 200, 100 + W, 200 + 100] as const;
		const before = await frame(c, 10);
		expect(lit(before, ...region)).toBe(0);
		const after = await frame(c, (logo.cues.revealed[0]?.frame ?? 0) + 5);
		expect(lit(after, ...region)).toBeGreaterThan(20);
	});

	it("a path mark settles identically drawn or popped", async () => {
		const at = (style: "draw" | "pop") =>
			frame(
				comp(LogoReveal({ x: 200, y: 180, mark: MARK, name: "frames", style })),
				300,
			);
		const draw = await at("draw");
		const pop = await at("pop");
		expect(computeMse(draw.pixels, pop.pixels)).toBeLessThan(0.5);
	});

	it("extrudes the name in 3D", async () => {
		const logo = LogoReveal({
			x: 180,
			y: 200,
			name: "frames",
			depth: 30,
			nameSize: 100,
		});
		const img = await frame(comp(logo), 200);
		expect(
			lit(img, 180, 200, 180 + (logo.width as number), 320),
		).toBeGreaterThan(20);
	});
});

describe("Backdrop (render)", () => {
	for (const kind of ["mesh", "grid", "dots"] as const)
		it(`${kind}: frame f equals frame f + loop`, async () => {
			const c = comp(
				Backdrop({ kind, loop: 60, grain: false, width: 960, height: 540 }),
			);
			for (const f of [7, 33]) {
				const a = await frame(c, f);
				const b = await frame(c, f + 60);
				expect(computeMse(a.pixels, b.pixels)).toBe(0);
			}
		});

	it("grains the surface", async () => {
		const at = (grain: number | false) =>
			frame(
				comp(Backdrop({ kind: "solid", grain, width: 960, height: 540 })),
				5,
			);
		const clean = await at(false);
		expect(computeMse((await at(0.6)).pixels, clean.pixels)).toBeGreaterThan(0);
	});

	it("seeds the mesh", async () => {
		const at = (seed: number) =>
			frame(
				comp(Backdrop({ seed, grain: false, width: 960, height: 540 })),
				20,
			);
		const one = await at(1);
		expect(computeMse(one.pixels, (await at(1)).pixels)).toBe(0);
		expect(computeMse(one.pixels, (await at(2)).pixels)).toBeGreaterThan(0);
	});
});

describe("Waveform (render)", () => {
	// One band: full on audio frame 10, silent on 20.
	const audio: AudioLevels = {
		fps: 30,
		frames: 40,
		bands: [Array.from({ length: 40 }, (_, f) => (f === 10 ? 1 : 0))],
		level: new Array(40).fill(0),
		beats: [],
	};
	const bar = (at: number) =>
		Waveform({
			at,
			x: 400,
			y: 100,
			width: 100,
			height: 300,
			audio,
			kind: "bars",
			floor: 0,
			smoothing: 0,
			color: "#ffffff",
		});

	it("a bar's height follows its band on the composition's clock", async () => {
		for (const at of [0, 15]) {
			const c = comp(bar(at));
			const top = await frame(c, at + 10);
			expect(lit(top, 420, 110, 480, 140)).toBeGreaterThan(10);
			const quiet = await frame(c, at + 20);
			expect(lit(quiet, 400, 100, 500, 400)).toBe(0);
		}
	});
});

describe("WordCycle (render)", () => {
	const cycle = (words: string[], transition: "roll" | "fade" = "roll") =>
		WordCycle({
			x: 100,
			y: 200,
			text: "Make it {} now",
			words,
			every: 40,
			fontSize: 64,
			transition,
		});

	it("shows only the current word at rest", async () => {
		const a = await frame(comp(cycle(["fast", "beta"])), 20);
		const b = await frame(comp(cycle(["fast", "zeta"])), 20);
		expect(computeMse(a.pixels, b.pixels)).toBe(0);
	});

	it("a roll never shows a word outside the slot", async () => {
		const node = cycle(["fast", "together"]);
		const c = comp(node);
		const mid = await frame(c, 40 + 4);
		const H = node.height as number;
		// Above and below the line, across its whole width.
		expect(lit(mid, 100, 120, 100 + (node.width as number), 198)).toBe(0);
		expect(lit(mid, 100, 200 + H + 2, 100 + (node.width as number), 400)).toBe(
			0,
		);
		// And the incoming word is on its way inside it.
		expect(
			lit(mid, 100, 200, 100 + (node.width as number), 200 + H),
		).toBeGreaterThan(0);
	});
});

describe("Captions pulse (render)", () => {
	const words = "one two three"
		.split(" ")
		.map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.45 }));
	const levels = (v: number): AudioLevels => ({
		fps: 30,
		frames: 60,
		bands: [],
		level: new Array(60).fill(v),
		beats: [],
	});
	const at = (pulse: AudioLevels | false) =>
		frame(
			comp(
				Captions({ words, pulse, style: "karaoke", width: 960, height: 540 }),
			),
			20,
		);

	it("moves the active word only with the voice", async () => {
		const none = await at(false);
		expect(computeMse((await at(levels(0))).pixels, none.pixels)).toBe(0);
		expect(
			computeMse((await at(levels(1))).pixels, none.pixels),
		).toBeGreaterThan(0);
	});
});
