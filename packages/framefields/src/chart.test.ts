/**
 * Layer.chart builds charts from ordinary nodes: the reveal animation is plain
 * keyframes, and the rendered pixels come from the same box, path and text
 * pipelines as every other layer.
 */
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import {
	type ChartOptions,
	Composition,
	FontManager,
	Layer,
	type LayoutNode,
} from "./index.js";

const BG = "#000000";

async function pixels(png: Buffer) {
	const img = await loadImage(png);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, img.width, img.height).data;
	return (x: number, y: number) => {
		const i = (Math.round(y) * img.width + Math.round(x)) * 4;
		return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
	};
}

function comp(chart: ChartOptions) {
	const c = new Composition({
		width: 400,
		height: 300,
		fps: 30,
		durationFrames: 60,
		backgroundColor: BG,
	});
	const node = Layer.chart(
		{ width: 400, height: 300, legend: false, ...chart },
		{ id: "c", position: "absolute", x: 0, y: 0 },
	);
	c.add(node);
	return { c, node };
}

const find = (node: LayoutNode, id: string): LayoutNode | undefined => {
	if (node.id === id) return node;
	for (const child of (node as { children?: LayoutNode[] }).children ?? []) {
		const hit = find(child, id);
		if (hit) return hit;
	}
	return undefined;
};

describe("Layer.chart", () => {
	it("grows bars from the baseline and lands them at their values", async () => {
		await FontManager.register("assets/fonts/Inter.ttf");
		const { c, node } = comp({
			type: "bar",
			categories: ["a", "b"],
			data: [10, 5],
			colors: ["#ff0000"],
			yAxis: { min: 0, max: 10, show: false, grid: false },
			xAxis: { show: false },
			animate: { start: 0, duration: 20 },
		});
		const bar = find(node, "c-bar-0-0") as {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		expect(bar).toBeDefined();
		const cx = bar.x + bar.width / 2;
		const nearTop = bar.y + 4;
		const end = await pixels(await c.renderFrame({ frame: 40 }));
		expect(end(cx, nearTop)[0]).toBeGreaterThan(200);
		const start = await pixels(await c.renderFrame({ frame: 0 }));
		expect(start(cx, nearTop)[0]).toBeLessThan(40);
		// The half-height bar stops at half the plot height.
		const half = find(node, "c-bar-0-1") as { height: number };
		expect(half.height).toBeCloseTo(bar.height / 2, 0);
	});

	it("draws lines on with trimEnd and renders the stroke", async () => {
		await FontManager.register("assets/fonts/Inter.ttf");
		const { c, node } = comp({
			type: "line",
			colors: ["#00ff00"],
			series: [
				{
					data: [
						[0, 5],
						[1, 5],
					],
					curve: "linear",
					strokeWidth: 6,
				},
			],
			yAxis: { min: 0, max: 10, show: false, grid: false },
			xAxis: { show: false },
			animate: { duration: 20 },
		});
		const line = find(node, "c-line-0") as {
			animation: { tracks: { prop: string }[] };
		};
		expect(line.animation.tracks.map((t) => t.prop)).toEqual(["trimEnd"]);
		const frame = await pixels(await c.renderFrame({ frame: 59 }));
		// A horizontal line at y=5 of 0..10 crosses the middle of the plot.
		let hit = 0;
		for (let y = 100; y < 200; y++) if (frame(200, y)[1] > 200) hit++;
		expect(hit).toBeGreaterThan(2);
	});

	it("renders pie slices in their colours", async () => {
		await FontManager.register("assets/fonts/Inter.ttf");
		const { c } = comp({
			type: "pie",
			data: [
				{ label: "a", value: 1, color: "#ff0000" },
				{ label: "b", value: 1, color: "#0000ff" },
			],
			animate: false,
		});
		const frame = await pixels(await c.renderFrame({ frame: 0 }));
		// The first slice runs clockwise from 12 o'clock: right half red, left half blue.
		expect(frame(250, 150)[0]).toBeGreaterThan(200);
		expect(frame(150, 150)[2]).toBeGreaterThan(200);
	});

	it("is static with animate: false and has stable, unique ids", () => {
		const build = () =>
			Layer.chart(
				{
					type: "bar",
					categories: ["a", "b", "c"],
					series: [{ data: [1, 2, 3] }, { data: [3, 2, 1] }],
					valueLabels: true,
					legend: true,
					animate: false,
				},
				{ id: "s" },
			);
		const a = build();
		const ids: string[] = [];
		const walk = (n: LayoutNode) => {
			ids.push(n.id);
			expect(n.animation?.tracks ?? []).toEqual([]);
			for (const child of (n as { children?: LayoutNode[] }).children ?? [])
				walk(child);
		};
		walk(a);
		expect(new Set(ids).size).toBe(ids.length);
		expect(JSON.stringify(build())).toBe(JSON.stringify(a));
	});

	it("keeps keyframes on whole frames with uneven staggers", () => {
		const c = new Composition({
			width: 400,
			height: 300,
			fps: 30,
			durationFrames: 60,
		});
		c.add(
			Layer.chart({
				type: "line",
				categories: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
				series: [{ data: [1, 3, 2, 5, 4, 6, 5, 8, 7], pointRadius: 4 }],
				animate: { duration: 31 },
			}),
		);
		const frames: number[] = [];
		const walk = (n: LayoutNode) => {
			for (const t of n.animation?.tracks ?? [])
				for (const kf of t.keyframes) frames.push(kf.frame);
			for (const child of (n as { children?: LayoutNode[] }).children ?? [])
				walk(child);
		};
		for (const n of c.toSpec().layout as LayoutNode[]) walk(n);
		expect(frames.length).toBeGreaterThan(0);
		expect(frames.filter((f) => !Number.isInteger(f))).toEqual([]);
	});

	it("stacks bars on top of each other", () => {
		const node = Layer.chart(
			{
				type: "bar",
				stacked: true,
				categories: ["a"],
				series: [{ data: [2] }, { data: [3] }],
				yAxis: { min: 0, max: 5 },
				animate: false,
			},
			{ id: "st" },
		);
		const lower = find(node, "st-bar-0-0") as { y: number; height: number };
		const upper = find(node, "st-bar-1-0") as { y: number; height: number };
		expect(upper.y + upper.height).toBeCloseTo(lower.y, 0);
		expect(upper.height / lower.height).toBeCloseTo(1.5, 1);
	});
});
