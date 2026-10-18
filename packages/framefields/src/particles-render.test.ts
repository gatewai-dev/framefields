/**
 * GPU particles and temporal effects through the real renderer: particles
 * appear where they are emitted, scrubbing back gives the same frame, and
 * Trails / Datamosh remember earlier frames.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	Composition,
	Datamosh,
	HeadlessMediaRenderer,
	Layer,
	Layer3D,
	LayerAnimation,
	Trails,
} from "./index.js";
import { decodePngPixels, getPixel } from "./test-utils/pixels.js";

const FPS = 30;

function stage(frames = 60) {
	return new Composition({
		width: 200,
		height: 200,
		fps: FPS,
		durationFrames: frames,
		backgroundColor: "#000000",
	});
}

async function frame(
	c: Composition,
	f: number,
	renderer?: HeadlessMediaRenderer,
) {
	return decodePngPixels(
		await c.renderFrame({ frame: f, ...(renderer && { renderer }) }),
	);
}

function brightPixels(
	img: Awaited<ReturnType<typeof decodePngPixels>>,
	x0 = 0,
	x1 = img.width,
) {
	let n = 0;
	for (let y = 0; y < img.height; y++) {
		for (let x = x0; x < x1; x++) if (getPixel(img, x, y).r > 60) n++;
	}
	return n;
}

describe("Layer.particles", () => {
	it("emits, moves and draws particles", async () => {
		const c = stage();
		c.add(
			Layer.particles({
				width: 200,
				height: 200,
				max: 2000,
				emitter: { shape: "point", x: 100, y: 180, rate: 600 },
				direction: -90,
				spread: 20,
				speed: [200, 260],
				lifetime: [3, 3],
				size: [6, 6],
				color: "#ffffff",
				fade: [0.001, 0.001],
			}),
		);
		const renderer = new HeadlessMediaRenderer();
		const early = await frame(c, 3, renderer);
		const later = await frame(c, 20, renderer);
		// Near the emitter early, risen ~150 px by frame 20.
		expect(getPixel(early, 100, 172).r).toBeGreaterThan(100);
		expect(brightPixels(early)).toBeGreaterThan(5);
		expect(getPixel(later, 100, 60).r).toBeGreaterThan(100);
		// Nothing left or right of the narrow fountain.
		expect(brightPixels(later, 0, 40) + brightPixels(later, 160, 200)).toBe(0);
	});

	it("gives the same frame when scrubbing back (snapshots + replay)", async () => {
		const c = stage(80);
		c.add(
			Layer.particles({
				width: 200,
				height: 200,
				max: 3000,
				emitter: { shape: "rect", rate: 900 },
				noise: { strength: 400, scale: 40 },
				lifetime: [1, 2],
				size: [4, 2],
				seed: 3,
			}),
		);
		const renderer = new HeadlessMediaRenderer();
		const a = await frame(c, 30, renderer);
		await frame(c, 70, renderer);
		const b = await frame(c, 30, renderer);
		expect(Buffer.from(b.pixels).equals(Buffer.from(a.pixels))).toBe(true);
	});
});

describe("moving emitters and glass", () => {
	it("emits where a driven emitter is each frame", async () => {
		const c = stage(40);
		c.add(
			Layer.particles({
				width: 200,
				height: 200,
				max: 3000,
				emitter: { shape: "point", x: (f) => 20 + f * 4, y: 100, rate: 1200 },
				speed: [0, 5],
				lifetime: [0.2, 0.2],
				size: [6, 6],
				fade: [0.001, 0.001],
				color: "#ffffff",
			}),
		);
		const renderer = new HeadlessMediaRenderer();
		let img = await frame(c, 0, renderer);
		for (let f = 1; f <= 30; f++) img = await frame(c, f, renderer);
		// Emitter at x = 140 now; the trail of the last 0.2 s reaches back ~24 px.
		expect(getPixel(img, 139, 100).r).toBeGreaterThan(100);
		expect(getPixel(img, 125, 100).r).toBeGreaterThan(100);
		expect(getPixel(img, 40, 100).r).toBeLessThan(20);
	});

	it("glass shows what is behind it instead of a flat surface", async () => {
		const scene = (material: "glass" | "lit") => {
			const c = stage(2);
			c.add([
				Layer.box({
					position: "absolute",
					x: 0,
					y: 0,
					width: 100,
					height: 200,
					background: "#ff0000",
				}),
				Layer.box({
					position: "absolute",
					x: 100,
					y: 0,
					width: 100,
					height: 200,
					background: "#0000ff",
				}),
				Layer3D.roundedBox({
					width: 120,
					height: 120,
					depth: 120,
					x: 100,
					y: 100,
					z: 0,
					color: "#ffffff",
					material,
				}),
			]);
			return c;
		};
		const glass = await frame(scene("glass"), 0);
		const left = getPixel(glass, 70, 100);
		const right = getPixel(glass, 130, 100);
		expect(left.r).toBeGreaterThan(left.b + 60);
		expect(right.b).toBeGreaterThan(right.r + 60);
		const lit = await frame(scene("lit"), 0);
		// An opaque white box hides the split.
		expect(
			Math.abs(getPixel(lit, 70, 100).r - getPixel(lit, 130, 100).r),
		).toBeLessThan(30);
	});
});

describe("temporal effects", () => {
	/** Renders a 30-frame clip of a white square sliding right 4 px per frame on black. */
	async function slidingClip(): Promise<string> {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-temporal-"));
		const file = path.join(dir, "slide.mp4");
		const c = stage(30);
		c.add(
			Layer.box({
				position: "absolute",
				x: 0,
				y: 80,
				width: 40,
				height: 40,
				background: "#ffffff",
			}).animate(
				LayerAnimation.keys("x", [
					[0, 0],
					[29, 116],
				]),
			),
		);
		const r = await c.renderVideo({ outputPath: file, quality: "lossless" });
		await r.cleanup?.();
		return file;
	}

	function withEffect(clip: string, effect: Trails | Datamosh | null) {
		const c = stage(30);
		const layer = Layer.video(clip, {
			position: "absolute",
			x: 0,
			y: 0,
			width: 200,
			height: 200,
			fit: "cover",
			muted: true,
		});
		c.add(effect ? layer.withEffect(effect) : layer);
		return c;
	}

	it("Trails leaves a fading echo behind a moving subject", async () => {
		const clip = await slidingClip();
		const renderer = new HeadlessMediaRenderer();
		const trails = withEffect(clip, new Trails({ decay: 0.8 }));
		let img = await frame(trails, 0, renderer);
		for (let f = 1; f <= 15; f++) img = await frame(trails, f, renderer);
		const plain = await frame(withEffect(clip, null), 15);
		// Square now covers x 60–100; x 50 was covered a few frames ago.
		expect(getPixel(plain, 50, 100).r).toBeLessThan(10);
		const echo = getPixel(img, 50, 100).r;
		expect(echo).toBeGreaterThan(20);
		expect(echo).toBeLessThan(250);
		// Far behind it, the echo has faded out.
		expect(getPixel(img, 5, 100).r).toBeLessThan(20);
		// Jumping straight to a frame replays enough history to match.
		const jumped = await frame(trails, 15, new HeadlessMediaRenderer());
		expect(Math.abs(getPixel(jumped, 50, 100).r - echo)).toBeLessThan(6);
	});

	it("Datamosh shows the clean picture on keyframes", async () => {
		const clip = await slidingClip();
		const renderer = new HeadlessMediaRenderer();
		const mosh = withEffect(clip, new Datamosh({ keyframes: [0, 12] }));
		for (let f = 0; f <= 12; f++) await frame(mosh, f, renderer);
		const atKey = await frame(mosh, 12, renderer);
		const plain = await frame(withEffect(clip, null), 12);
		expect(getPixel(atKey, 70, 100).r).toBeCloseTo(
			getPixel(plain, 70, 100).r,
			-1,
		);
		expect(getPixel(atKey, 20, 100).r).toBeLessThan(20);
	});
});
