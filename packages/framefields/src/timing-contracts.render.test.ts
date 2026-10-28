import { describe, expect, it, vi } from "vitest";
import {
	Composition,
	HeadlessMediaRenderer,
	Layer,
	LayerAnimation,
	Sequence,
	signal,
} from "./index.js";
import { decodePngPixels, getPixel } from "./test-utils/pixels.js";

describe("inspection and sequence timing contracts", () => {
	it("runs hooks and draws the same timestamp-selected frame", async () => {
		const opacity = signal(0);
		const frames: number[] = [];
		const comp = new Composition({
			width: 32,
			height: 32,
			fps: 30,
			durationFrames: 60,
			backgroundColor: "#ff0000",
		});
		comp.add(
			Layer.box({ width: 32, height: 32, background: "#00ff00" }).animate(
				LayerAnimation.create().signal("opacity", opacity),
			),
		);
		comp.onRequestFrame((ctx) => {
			frames.push(ctx.frame);
			opacity.set(ctx.frame === 30 ? 1 : 0);
		});
		const renderer = new HeadlessMediaRenderer();
		const render = vi.spyOn(renderer, "renderFrame");
		const png = await comp.renderFrame({ frame: 0, atMs: 1000, renderer });
		expect(frames.every((f) => f === 30)).toBe(true);
		expect(frames).not.toHaveLength(0);
		expect(render.mock.calls[0][1]).toMatchObject({ frame: 30, fps: 30 });
		expect(render.mock.calls[0][1]).not.toHaveProperty("atMs");
		expect(getPixel(await decodePngPixels(png), 16, 16)).toMatchObject({
			r: 0,
			g: 255,
			b: 0,
		});
		await expect(comp.renderFrame({ fps: 24 })).rejects.toThrow(
			/Composition fps/,
		);
	});

	it("passes only canonical frames from fractional timestamp grids", async () => {
		const comp = new Composition({
			width: 32,
			height: 32,
			fps: 30,
			durationFrames: 30,
			backgroundColor: "#ff0000",
		});
		const renderer = new HeadlessMediaRenderer();
		const render = vi.spyOn(renderer, "renderFrame");
		await comp.renderFrameGrid({ timesMs: [16.6], renderer });
		expect(render.mock.calls[0][1]).toMatchObject({ frame: 0, fps: 30 });
		expect(render.mock.calls[0][1]).not.toHaveProperty("atMs");
	});

	it("clips nested content at the delayed scene layer's exclusive end", async () => {
		const sequence = Sequence.create({
			width: 32,
			height: 32,
			fps: 30,
			backgroundColor: "#000000",
		});
		sequence.addScene({
			id: "first",
			durationFrames: 10,
			layout: [
				Layer.box({
					id: "late",
					startFrame: 5,
					width: 32,
					height: 32,
					children: [
						Layer.box({ width: 32, height: 32, background: "#ff0000" }),
					],
				}),
			],
		});
		sequence.addScene({ id: "next", durationFrames: 10, layout: [] });
		const comp = new Composition({
			width: 32,
			height: 32,
			fps: 30,
			durationFrames: sequence.calculateTimeline().totalFrames,
			backgroundColor: "#000000",
		});
		for (const node of sequence.toProgram().layout) comp.add(node);
		const before = getPixel(
			await decodePngPixels(await comp.renderFrame({ frame: 9 })),
			16,
			16,
		);
		const after = getPixel(
			await decodePngPixels(await comp.renderFrame({ frame: 10 })),
			16,
			16,
		);
		expect(before).toMatchObject({ r: 255, g: 0, b: 0 });
		expect(after).toMatchObject({ r: 0, g: 0, b: 0 });
	});
});
