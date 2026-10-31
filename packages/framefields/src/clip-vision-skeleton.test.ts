/**
 * A `withVision({ mode: "skeleton" })` layer of a clip that `comp.vision`
 * analyses draws the pose the clip matched to its subject, not the first
 * person a render-time pass detects.
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
const SAM3 = { prompts: [{ frame: 0, text: "person" }] };

function stage() {
	return new Composition({
		width: SIZE,
		height: SIZE,
		fps: FPS,
		durationFrames: 10,
		backgroundColor: "#000000",
	});
}

/** A 10-frame solid green clip. */
async function greenClip(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-clip-skeleton-"));
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

/** A standing person in the left half: 17 COCO keypoints as [x, y, visibility], source px. */
function leftPerson(): number[] {
	const points: [number, number][] = [
		[50, 30], // nose
		[46, 26],
		[54, 26], // eyes
		[42, 28],
		[58, 28], // ears
		[40, 60],
		[60, 60], // shoulders
		[40, 100],
		[60, 100], // elbows
		[40, 130],
		[60, 130], // wrists
		[42, 120],
		[58, 120], // hips
		[42, 155],
		[58, 155], // knees
		[42, 190],
		[58, 190], // ankles
	];
	return points.flatMap(([x, y]) => [x, y, 1]);
}

const skeleton = (clip: string) =>
	Layer.video(clip, {
		position: "absolute",
		x: 0,
		y: 0,
		width: SIZE,
		height: SIZE,
		fit: "cover",
		muted: true,
	}).withVision({
		mode: "skeleton",
		// Unreachable: any pose pass during render would fail.
		baseUrl: "http://127.0.0.1:9/",
	});

function litPixels(
	image: Awaited<ReturnType<typeof decodePngPixels>>,
	x0: number,
	x1: number,
): number {
	let lit = 0;
	for (let y = 0; y < SIZE; y += 2)
		for (let x = x0; x < x1; x += 2) {
			const p = getPixel(image, x, y);
			if (p.r + p.g + p.b > 60) lit++;
		}
	return lit;
}

describe("skeleton reuses comp.vision", () => {
	it("draws the clip's matched pose from the first frame, and nothing where it has none", async () => {
		const file = await greenClip();
		const c = stage();
		const layer = skeleton(file);
		c.add(layer);
		const clip = c.vision(layer, { cacheDir: false, sam3: SAM3, pose: true });
		seedClipVision(
			clip,
			{ width: SIZE, height: SIZE },
			Array.from({ length: 40 }, (_, frame) => ({
				kp: frame === 1 ? null : leftPerson(),
				mask: null,
				subject: null,
			})),
		);
		const renderer = new HeadlessMediaRenderer();
		const first = await decodePngPixels(
			await c.renderFrame({ frame: 0, renderer }),
		);
		expect(litPixels(first, 0, 100)).toBeGreaterThan(20);
		// Only the skeleton: the green footage never shows through.
		expect(litPixels(first, 100, SIZE)).toBe(0);
		const empty = await decodePngPixels(
			await c.renderFrame({ frame: 1, renderer }),
		);
		expect(litPixels(empty, 0, SIZE)).toBe(0);
	});

	it("links skeleton layers only to clips that track pose", () => {
		const c = stage();
		const plain = skeleton("clip.mp4");
		c.add(plain);
		c.vision("clip.mp4", { cacheDir: false, pose: false });
		(c as unknown as { linkClipLayers(): void }).linkClipLayers();
		expect(CLIP_SUBJECT in (plain.vision as object)).toBe(false);

		const d = stage();
		const prompted = skeleton("clip.mp4");
		d.add(prompted);
		d.vision("clip.mp4", { cacheDir: false, sam3: SAM3 });
		expect(() =>
			(d as unknown as { linkClipLayers(): void }).linkClipLayers(),
		).toThrow(/needs `pose: true`/);
	});
});
