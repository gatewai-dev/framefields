/**
 * A `withVision({ mode: "matte" })` layer of a clip that `comp.vision` already
 * analyses reuses the clip's per-frame subject instead of segmenting again.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CLIP_SUBJECT } from "@framefields/vision";
import { describe, expect, it } from "vitest";
import { seedClipVision } from "./clip-vision.js";
import { Composition, HeadlessMediaRenderer, Layer } from "./index.js";
import { decodePngPixels, getPixel } from "./test-utils/pixels.js";

const FPS = 30;
const SIZE = 200;

function stage(background = "#000000") {
	return new Composition({
		width: SIZE,
		height: SIZE,
		fps: FPS,
		durationFrames: 10,
		backgroundColor: background,
	});
}

/** A 10-frame solid green clip. */
async function greenClip(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-clip-matte-"));
	const file = path.join(dir, "green.mp4");
	const c = stage();
	c.add(
		Layer.box({
			position: "absolute",
			x: 0,
			y: 0,
			width: SIZE,
			height: SIZE,
			background: "#00ff00",
		}),
	);
	const r = await c.renderVideo({ outputPath: file, quality: "lossless" });
	await r.cleanup?.();
	return file;
}

/** Subject: the left half of the frame. */
function leftHalf(): Uint8Array {
	const mask = new Uint8Array(SIZE * SIZE);
	for (let y = 0; y < SIZE; y++) mask.fill(255, y * SIZE, y * SIZE + SIZE / 2);
	return mask;
}

const cutout = (clip: string, vision: Record<string, unknown> = {}) =>
	Layer.video(clip, {
		position: "absolute",
		x: 0,
		y: 0,
		width: SIZE,
		height: SIZE,
		fit: "cover",
		muted: true,
	}).withVision({
		mode: "matte",
		// Unreachable: any segmentation pass during render would fail.
		baseUrl: "http://127.0.0.1:9/",
		...vision,
	});

describe("matte reuses comp.vision", () => {
	it("fails clearly when an explicit prompted mask cannot align with the layer aspect", async () => {
		const file = await greenClip();
		const c = stage();
		const layer = Layer.video(file, {
			width: SIZE,
			height: SIZE / 2,
			fit: "cover",
			muted: true,
		}).withVision({ mode: "matte" });
		c.add(layer);
		const clip = c.vision(layer, {
			cacheDir: false,
			sam2: {
				prompts: [{ frame: 0, points: [{ x: 0.25, y: 0.5, label: 1 }] }],
			},
		});
		seedClipVision(
			clip,
			{ width: SIZE, height: SIZE },
			Array.from({ length: 40 }, () => ({
				kp: null,
				mask: null,
				subject: leftHalf(),
			})),
		);
		await expect(c.renderFrame({ frame: 0 })).rejects.toThrow(/aspect ratio/);
	});

	it("renders an authoritative absent subject as empty instead of holding an earlier mask", async () => {
		const file = await greenClip();
		const c = stage("#0000ff");
		const layer = cutout(file);
		c.add(layer);
		const clip = c.vision(layer, { cacheDir: false, smoothing: 0 });
		seedClipVision(
			clip,
			{ width: SIZE, height: SIZE },
			Array.from({ length: 40 }, (_, frame) => ({
				kp: null,
				mask: null,
				subject: frame === 0 ? leftHalf() : null,
			})),
		);
		const renderer = new HeadlessMediaRenderer();
		await c.renderFrame({ frame: 0, renderer });
		const image = await decodePngPixels(
			await c.renderFrame({ frame: 1, renderer }),
		);
		expect(getPixel(image, 50, 100).b).toBeGreaterThan(240);
		expect(getPixel(image, 50, 100).g).toBeLessThan(15);
	});

	it("follows a clip's subject while its media plays in reverse", async () => {
		const file = await greenClip();
		const c = stage("#0000ff");
		const layer = Layer.video(file, {
			position: "absolute",
			x: 0,
			y: 0,
			width: SIZE,
			height: SIZE,
			durationFrames: 2,
			muted: true,
			timeRemap: { kind: "rate", sourceStartSec: 2 / FPS, rate: -1 },
		}).withVision({ mode: "matte", baseUrl: "http://127.0.0.1:9/" });
		c.add(layer);
		const clip = c.vision(layer, { cacheDir: false, smoothing: 0 });
		const right = leftHalf().map((v) => 255 - v);
		seedClipVision(
			clip,
			{ width: SIZE, height: SIZE },
			Array.from({ length: 40 }, (_, i) => ({
				kp: null,
				mask: null,
				subject: i === 2 ? right : leftHalf(),
			})),
		);
		const first = await decodePngPixels(await c.renderFrame({ frame: 0 }));
		const next = await decodePngPixels(await c.renderFrame({ frame: 1 }));
		expect(getPixel(first, 150, 100).g).toBeGreaterThan(240);
		expect(getPixel(next, 50, 100).g).toBeGreaterThan(240);
	});
	it("uses mapped source time to select the rendered matte", async () => {
		const file = await greenClip();
		const c = stage("#0000ff");
		const layer = Layer.video(file, {
			position: "absolute",
			x: 0,
			y: 0,
			width: SIZE,
			height: SIZE,
			durationFrames: 4,
			muted: true,
			timeRemap: {
				kind: "keyframes",
				keyframes: [
					{ frame: 0, sourceSec: 1 / FPS },
					{ frame: 4, sourceSec: 1 / FPS },
				],
			},
		}).withVision({ mode: "matte", baseUrl: "http://127.0.0.1:9/" });
		c.add(layer);
		const clip = c.vision(layer, { cacheDir: false, smoothing: 0 });
		const right = leftHalf().map((v) => 255 - v);
		seedClipVision(
			clip,
			{ width: SIZE, height: SIZE },
			Array.from({ length: 40 }, (_, i) => ({
				kp: null,
				mask: null,
				subject: i === 0 ? leftHalf() : right,
			})),
		);
		const img = await decodePngPixels(await c.renderFrame({ frame: 0 }));
		expect(getPixel(img, 50, 100).b).toBeGreaterThan(240);
		expect(getPixel(img, 150, 100).g).toBeGreaterThan(240);
	});
	it("links each remapped layer to its own vision clock", () => {
		const c = stage();
		const first = Layer.video("clip.mp4", {
			durationFrames: 10,
			timeRemap: { kind: "rate", sourceStartSec: 0, rate: 0.5 },
		}).withVision({ mode: "matte" });
		const second = Layer.video("clip.mp4", {
			durationFrames: 10,
			timeRemap: { kind: "rate", sourceStartSec: 1, rate: 1 },
		}).withVision({ mode: "matte" });
		c.add([first, second]);
		const a = c.vision(first, { cacheDir: false });
		const b = c.vision(second, { cacheDir: false });
		(c as unknown as { linkClipMattes(): void }).linkClipMattes();
		expect((first.vision as { [CLIP_SUBJECT]?: unknown })[CLIP_SUBJECT]).toBe(
			a,
		);
		expect((second.vision as { [CLIP_SUBJECT]?: unknown })[CLIP_SUBJECT]).toBe(
			b,
		);
	});
	it("cuts the layer out with the clip's cached subject, from the first frame", async () => {
		const file = await greenClip();
		const c = stage("#0000ff");
		const clip = c.vision(file, { cacheDir: false, smoothing: 0 });
		seedClipVision(
			clip,
			{ width: SIZE, height: SIZE },
			Array.from({ length: 40 }, () => ({
				kp: null,
				mask: null,
				subject: leftHalf(),
			})),
		);
		c.add(cutout(file));
		const renderer = new HeadlessMediaRenderer();
		for (const f of [0, 1, 5]) {
			const img = await decodePngPixels(
				await c.renderFrame({ frame: f, renderer }),
			);
			// Without reuse frame 0 has no subject yet (inference runs one frame behind).
			const inside = getPixel(img, 50, 100);
			expect(inside.g).toBeGreaterThan(240);
			expect(inside.b).toBeLessThan(15);
			const outside = getPixel(img, 150, 100);
			expect(outside.b).toBeGreaterThan(240);
			expect(outside.g).toBeLessThan(15);
		}
	});

	it("links only layers whose settings give the clip's subject", async () => {
		const c = stage();
		c.vision("clip.mp4", { cacheDir: false });
		const same = cutout("clip.mp4");
		const classes = cutout("clip.mp4", { classes: ["person"] });
		const keyed = cutout("clip.mp4", { keyBackground: true });
		const other = cutout("other.mp4");
		c.add([same, classes, keyed, other]);
		(c as unknown as { linkClipMattes(): void }).linkClipMattes();
		const linked = (n: { vision?: object }) =>
			CLIP_SUBJECT in (n.vision as object);
		expect(linked(same as never)).toBe(true);
		expect(linked(classes as never)).toBe(false);
		expect(linked(keyed as never)).toBe(false);
		expect(linked(other as never)).toBe(false);
	});
});
