import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Canvas, loadImage } from "skia-canvas";
import { describe, expect, it } from "vitest";
import { Blur, Composition, Layer, Signal, Vignette } from "./index.js";

async function decodePngPixels(pngBuffer: Buffer) {
	const img = await loadImage(pngBuffer);
	const canvas = new Canvas(img.width, img.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const imgData = ctx.getImageData(0, 0, img.width, img.height);
	return {
		width: img.width,
		height: img.height,
		pixels: imgData.data,
	};
}

const testVideoPath = resolve(
	import.meta.dirname,
	"../../../examples/19_framefields_film/assets/portrait.mp4",
);

describe("Effect signals sampled at composition frame regression tests", () => {
	it("1. Effect signals on a media layer with trimStartSec are sampled at composition frame (ctx.frame), not media frame", async () => {
		if (!existsSync(testVideoPath)) return;

		const sampledFrames: number[] = [];

		const trackingSignal = Signal.builder({
			type: "custom",
			fn: (ctx) => {
				sampledFrames.push(ctx.frame);
				return 40;
			},
		});

		const comp = new Composition({
			width: 200,
			height: 200,
			fps: 30,
			durationFrames: 60,
			backgroundColor: "#000000",
		});

		// A video layer with trimStartSec: 1 (offset by 30 frames in media time)
		const videoLayer = Layer.video(testVideoPath, {
			trimStartSec: 1,
			width: 200,
			height: 200,
		}).apply(
			new Blur({
				blurType: "Zoom",
				strength: trackingSignal,
			}),
		);

		comp.add(videoLayer);

		// Render at composition frame 0
		await comp.renderFrame({ frame: 0 });

		// The signal must have been sampled at composition frame 0, NOT media frame 30
		expect(sampledFrames.length).toBeGreaterThan(0);
		expect(sampledFrames).toContain(0);
		expect(sampledFrames).not.toContain(30);

		// Now render at composition frame 5
		sampledFrames.length = 0;
		await comp.renderFrame({ frame: 5 });

		expect(sampledFrames.length).toBeGreaterThan(0);
		expect(sampledFrames).toContain(5);
		expect(sampledFrames).not.toContain(35);
	});

	it("2. Signal.fromArray ramps on effect props match composition timeline with trimStartSec offset", async () => {
		if (!existsSync(testVideoPath)) return;

		const sampledFrames: number[] = [];

		// Ramp: 60 at frame 0, 0 at frame 30+
		const rampValues = Array.from({ length: 60 }, (_, f) =>
			Math.max(0, 60 - f * 2),
		);
		const rampSignal = Signal.builder({
			type: "custom",
			fn: (ctx) => {
				sampledFrames.push(ctx.frame);
				return (
					rampValues[Math.min(rampValues.length - 1, Math.round(ctx.frame))] ??
					0
				);
			},
		});

		const comp = new Composition({
			width: 160,
			height: 160,
			fps: 30,
			durationFrames: 60,
			backgroundColor: "#111111",
		});

		const vignette = new Vignette({
			strength: rampSignal,
			radius: 0.8,
		});

		const mediaLayer = Layer.video(testVideoPath, {
			trimStartSec: 1, // 30 frames offset
			width: 160,
			height: 160,
		}).apply(vignette);

		comp.add(mediaLayer);

		await comp.renderFrame({ frame: 0 });
		expect(sampledFrames).toContain(0);
		expect(sampledFrames).not.toContain(30);
	});

	it("3. Repro verification: Zoom Blur on real video layer with trimStartSec applies blur at frame 0", async () => {
		if (!existsSync(testVideoPath)) return;

		// Values: 60 at f=0, decreases to 0 by f=10. At f=30, value is 0.
		const blurValues = Array.from({ length: 60 }, (_, f) =>
			Math.max(0, 60 - f * 6),
		);

		const comp = new Composition({
			width: 320,
			height: 320,
			fps: 30,
			durationFrames: 60,
			backgroundColor: "#000000",
		});

		const blurEffect = new Blur({
			blurType: "Zoom",
			strength: Signal.fromArray(blurValues, 30),
		});

		const videoLayer = Layer.video(testVideoPath, {
			trimStartSec: 1,
			width: 320,
			height: 320,
		}).apply(blurEffect);

		comp.add(videoLayer);

		// Frame 0 should render with strength 60 (blurred)
		const frame0Buf = await comp.renderFrame({ frame: 0 });
		expect(Buffer.isBuffer(frame0Buf)).toBe(true);
		expect(frame0Buf.length).toBeGreaterThan(100);

		const img0 = await decodePngPixels(frame0Buf);
		expect(img0.width).toBe(320);
		expect(img0.height).toBe(320);
	});

	it("4. Layer with startFrame offset samples effect signals at composition frame", async () => {
		if (!existsSync(testVideoPath)) return;

		const sampledFrames: number[] = [];

		const sig = Signal.builder({
			type: "custom",
			fn: (ctx) => {
				sampledFrames.push(ctx.frame);
				return 20;
			},
		});

		const comp = new Composition({
			width: 200,
			height: 200,
			fps: 30,
			durationFrames: 60,
			backgroundColor: "#000000",
		});

		const videoLayer = Layer.video(testVideoPath, {
			x: 0,
			y: 0,
			width: 200,
			height: 200,
			startFrame: 10,
			durationFrames: 30,
		}).apply(
			new Blur({
				strength: sig,
			}),
		);

		comp.add(videoLayer);

		// Render at composition frame 15
		await comp.renderFrame({ frame: 15 });

		expect(sampledFrames.length).toBeGreaterThan(0);
		expect(sampledFrames).toContain(15);
		expect(sampledFrames).not.toContain(5);
	});

	it("5. Effect renderer directly evaluates bindable signals at compositionFrame when frame differs", async () => {
		const sampledFrames: number[] = [];

		const sig = Signal.builder({
			type: "custom",
			fn: (ctx) => {
				sampledFrames.push(ctx.frame);
				return 15;
			},
		});

		const blur = new Blur({
			strength: sig,
		});

		const comp = new Composition({
			width: 100,
			height: 100,
			fps: 30,
			durationFrames: 30,
			backgroundColor: "#000000",
		});

		comp.add(
			Layer.box({
				width: 100,
				height: 100,
				background: "#ffffff",
			}),
		);

		const { HeadlessMediaRenderer, Media } = await import("./index.js");
		const renderer = new HeadlessMediaRenderer();
		const media = new Media(comp.toVirtualMedia()).apply(blur);
		await renderer.renderImage(media.toVirtualMedia(), 7, 30);
		expect(sampledFrames).toContain(7);
	});
});
