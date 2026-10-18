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
