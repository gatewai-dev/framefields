import { loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import {
	Composition,
	computeGridLayout,
	Layer,
	LayerAnimation,
	renderFrameGrid,
	resolveSamplePoints,
} from "./index.js";

describe("FrameGrid Rendering Conformance & Validations", () => {
	it("resolves sample points by frame range with step", () => {
		const { samples, fps } = resolveSamplePoints(
			{
				startFrame: 10,
				endFrame: 30,
				stepFrames: 5,
				fps: 30,
			},
			30,
		);

		expect(fps).toBe(30);
		expect(samples.length).toBe(5); // 10, 15, 20, 25, 30
		expect(samples[0]).toEqual({ frame: 10, timeMs: 333 });
		expect(samples[4]).toEqual({ frame: 30, timeMs: 1000 });
	});

	it("resolves sample points by millisecond range", () => {
		const { samples } = resolveSamplePoints(
			{
				startMs: 0,
				endMs: 500,
				stepMs: 100,
				fps: 20,
			},
			20,
		);

		expect(samples.length).toBe(6); // 0, 100, 200, 300, 400, 500
		expect(samples[0]).toEqual({ frame: 0, timeMs: 0 });
		expect(samples[3]).toEqual({ frame: 6, timeMs: 300 });
	});

	it("resolves sample points from explicit frame array", () => {
		const { samples } = resolveSamplePoints(
			{
				frames: [0, 12, 24, 48],
				fps: 24,
			},
			24,
		);

		expect(samples.length).toBe(4);
		expect(samples.map((s) => s.frame)).toEqual([0, 12, 24, 48]);
	});

	it("throws on invalid ranges and bounds", () => {
		expect(() => resolveSamplePoints({ startFrame: 50, endFrame: 10 })).toThrow(
			/startFrame must be <= endFrame/,
		);

		expect(() => resolveSamplePoints({ startMs: 1000, endMs: 200 })).toThrow(
			/startMs must be <= endMs/,
		);

		expect(() => resolveSamplePoints({ stepFrames: 0 })).toThrow(
			/stepFrames.*Must be > 0/,
		);

		expect(() => resolveSamplePoints({ stepMs: -10 })).toThrow(
			/stepMs.*Must be > 0/,
		);
	});

	it("throws safety error when requested frames exceed maxFrames limit", () => {
		expect(() =>
			resolveSamplePoints({
				startFrame: 0,
				endFrame: 1000,
				stepFrames: 1, // 1001 frames!
				maxFrames: 40,
			}),
		).toThrow(/exceeds the safety threshold/);
	});

	it("computes balanced grid dimensions and clamps to max canvas size", () => {
		const layout = computeGridLayout(16, 16 / 9, {
			cellWidth: 320,
			gap: 10,
			padding: 20,
		});

		expect(layout.columns).toBe(4);
		expect(layout.rows).toBe(4);
		expect(layout.cellWidth).toBe(320);
		expect(layout.cellHeight).toBe(180);
		expect(layout.totalWidth).toBe(4 * 320 + 3 * 10 + 20 * 2); // 1350
		expect(layout.totalHeight).toBe(
			4 * 180 + 3 * 10 + 20 * 2 + layout.headerHeight,
		);
	});

	it("downscales cell sizes automatically if total grid exceeds maxGridWidth/Height", () => {
		const layout = computeGridLayout(25, 16 / 9, {
			columns: 5,
			cellWidth: 800, // 5 * 800 = 4000px without gap/padding
			maxGridWidth: 1600, // force aggressive downscale
			gap: 10,
			padding: 10,
		});

		expect(layout.totalWidth).toBeLessThanOrEqual(1600);
		expect(layout.cellWidth).toBeLessThan(800);
	});

	it("renders a multi-frame animation into a consolidated PNG grid", async () => {
		const comp = new Composition({
			width: 320,
			height: 240,
			fps: 24,
			durationMs: 1000,
			backgroundColor: "#05070a",
		});

		const anim = LayerAnimation.create().fromTo("x", 10, 200, {
			from: 0,
			to: 24,
		});

		comp.add(
			Layer.shape("rect", {
				width: 60,
				height: 60,
				y: 90,
				fillColor: "#6366f1",
			}).animate(anim),
		);

		// Render a 5-frame contact sheet
		const gridPng = await comp.renderFrameGrid({
			startFrame: 0,
			endFrame: 20,
			stepFrames: 5,
			cellWidth: 160,
			showHeader: true,
			showLabels: true,
		});

		expect(gridPng).toBeInstanceOf(Buffer);
		expect(gridPng.length).toBeGreaterThan(1000);

		// Verify valid PNG header (0x89 50 4E 47 0D 0A 1A 0A)
		expect(gridPng[0]).toBe(0x89);
		expect(gridPng[1]).toBe(0x50);
		expect(gridPng[2]).toBe(0x4e);
		expect(gridPng[3]).toBe(0x47);

		// Verify image decodability using skia-canvas
		const img = await loadImage(gridPng);
		expect(img.width).toBeGreaterThan(300);
		expect(img.height).toBeGreaterThan(200);

		// Also verify standalone renderFrameGrid export directly
		const standalonePng = await renderFrameGrid(comp, {
			startFrame: 0,
			endFrame: 10,
			stepFrames: 5,
			cellWidth: 160,
		});
		expect(standalonePng).toBeInstanceOf(Buffer);
		expect(standalonePng.length).toBeGreaterThan(1000);
	});
});
