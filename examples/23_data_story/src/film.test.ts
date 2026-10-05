import { CompositorProgramSchema, type LayoutNode } from "framefields";
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { boxOf, findNode } from "./chart-geometry.js";
import { buildFilm } from "./film.js";
import { morph } from "./morph.js";
import { liveScene, userStream, WINDOW } from "./scenes/live.js";
import { MONTHLY, mixScene } from "./scenes/mix.js";
import { revenueScene, YEARS } from "./scenes/revenue.js";
import { BREATHE, breatheAt, PULSE, pulseAt } from "./signals.js";
import { BEAT } from "./theme.js";
import { DURATION, REVENUE, SCENES } from "./timeline.js";

type Tracked = LayoutNode & { children?: LayoutNode[] };

function walk(nodes: LayoutNode[], visit: (n: Tracked) => void): void {
	for (const n of nodes as Tracked[]) {
		visit(n);
		walk(n.children ?? [], visit);
	}
}

/** The value a keyframe track settles on. */
function lastKey(node: LayoutNode, prop: string): number | undefined {
	const track = node.animation?.tracks.find((t) => t.prop === prop);
	return track?.keyframes[track.keyframes.length - 1]?.value as
		| number
		| undefined;
}

describe("timeline", () => {
	it("scenes tile the film with no gaps or overlaps", () => {
		expect(SCENES[0].from).toBe(0);
		for (let i = 1; i < SCENES.length; i++)
			expect(SCENES[i].from).toBe(SCENES[i - 1].to);
		expect(SCENES[SCENES.length - 1].to).toBe(DURATION);
	});
});

describe("signals", () => {
	it("pulse hits 1 on every beat and decays along expo.out", () => {
		for (const beat of [0, BEAT, 7 * BEAT])
			expect(pulseAt(beat)).toBeCloseTo(1, 5);
		expect(pulseAt(Math.round(BEAT / 2))).toBeLessThan(0.1);
	});

	it("breathe stays in 0..1 and swells over four beats", () => {
		const values = Array.from({ length: BEAT * 4 }, (_, f) => breatheAt(f));
		expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...values)).toBeLessThanOrEqual(1);
		expect(breatheAt(BEAT * 2)).toBeCloseTo(1, 5);
	});
});

describe("morph", () => {
	it("keys only what changes, and settles on the last state", () => {
		const box = (h: number) =>
			({
				id: "b",
				kind: "box",
				x: 0,
				y: 100 - h,
				width: 10,
				height: h,
			}) as LayoutNode;
		const node = morph([
			{ at: 0, node: box(10) },
			{ at: 30, node: box(40) },
			{ at: 60, node: box(20) },
		]);
		const props = node.animation?.tracks.map((t) => t.prop).sort();
		expect(props).toEqual(["height", "y"]);
		expect(lastKey(node, "height")).toBe(20);
		expect(lastKey(node, "y")).toBe(80);
	});

	it("keys layers with their own startFrame on their own clock", () => {
		const ring = (y: number) =>
			({ id: "r", kind: "box", y, startFrame: 40 }) as LayoutNode;
		const node = morph([
			{ at: 0, node: ring(10) },
			{ at: 70, node: ring(50) },
		]);
		const frames = node.animation?.tracks[0]?.keyframes.map((k) => k.frame);
		expect(frames).toEqual([30, 54]);
	});

	it("eases each revenue bar to its final year", () => {
		const scene = revenueScene();
		const final = YEARS[YEARS.length - 1];
		const tallest = findNode(scene, "revenue-chart-bar-0-7");
		const ratio = (lastKey(tallest, "height") ?? 0) / (final.revenue[7] ?? 1);
		// Same axis every year, so height is proportional to value.
		const jan = findNode(scene, "revenue-chart-bar-0-0");
		expect((lastKey(jan, "height") ?? 0) / final.revenue[0]).toBeCloseTo(
			ratio,
			1,
		);
	});

	it("slides the live window one sample per tick", () => {
		const values = userStream();
		const scene = liveScene();
		const now = findNode(scene, `live-chart-point-0-${WINDOW - 1}`);
		const y = now.animation?.tracks.find((t) => t.prop === "y");
		// One change per tick, two keys each.
		expect(y?.keyframes.length).toBeGreaterThanOrEqual(
			2 * (values.length - WINDOW) - 2,
		);
	});

	it("re-trims the donut to each month's shares", () => {
		const scene = mixScene();
		const search = findNode(scene, "mix-donut-slice-1");
		const end = lastKey(search, "trimEnd") ?? 0;
		const start = lastKey(search, "trimStart") ?? 0;
		const last = MONTHLY[MONTHLY.length - 1].shares;
		const share = last[1] / last.reduce((a, b) => a + b, 0);
		expect(end - start).toBeGreaterThan(share - 0.06);
		expect(end - start).toBeLessThan(share);
	});
});

describe("film", () => {
	it("builds a spec its schema accepts", async () => {
		const film = await buildFilm();
		const result = CompositorProgramSchema.safeParse(film.toSpec());
		expect(result.success ? [] : result.error.issues.slice(0, 5)).toEqual([]);
	});

	it("binds signals by registered name", async () => {
		const film = await buildFilm();
		expect(Object.keys(film.signals).sort()).toEqual([BREATHE, PULSE].sort());
		const bound: string[] = [];
		walk(film.toSpec().layout as LayoutNode[], (n) => {
			for (const t of n.animation?.tracks ?? []) {
				if (t.source?.type === "signal") bound.push(t.source.inputHandleId);
			}
		});
		expect(bound.length).toBeGreaterThan(0);
		for (const name of bound) expect(film.signals).toHaveProperty(name);
	});

	it("renders the revenue bars at each year's height", async () => {
		const film = await buildFilm();
		const scene = revenueScene();
		const bar = boxOf(
			findNode(scene, "revenue-chart"),
			"revenue-chart-bar-0-7",
		);
		const ink = async (frame: number) => {
			const img = await loadImage(await film.renderFrame({ frame }));
			const canvas = new Canvas(img.width, img.height);
			const ctx = canvas.getContext("2d");
			ctx.drawImage(img, 0, 0);
			// Count bar-coloured pixels up the bar's centre column.
			const x = Math.round(bar.x + bar.width / 2);
			let n = 0;
			for (let y = 260; y < 990; y++) {
				const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
				if (b > 200 && r > 70 && r < 130 && g < 130) n++;
			}
			return n;
		};
		const y2023 = await ink(REVENUE.from + YEARS[1].at - 2);
		const y2025 = await ink(REVENUE.from + YEARS[2].at + 40);
		// Aug revenue grew from $21k to $36k on a fixed axis.
		expect(y2025 / y2023).toBeGreaterThan(1.5);
		expect(y2025 / y2023).toBeLessThan(1.9);
	}, 120_000);
});
