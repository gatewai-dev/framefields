import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type Sam2Point,
	Sam2Tracker,
	Sam3Tracker,
} from "@framefields/vision-sam";
import { mediaDecoderCache } from "@framefields/webgpu-renderers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClipVision } from "./clip-vision.js";

const points = [{ x: 0.25, y: 0.5, label: 1 as const }];
afterEach(() => vi.restoreAllMocks());

describe("SAM source scheduling and persistence", () => {
	it("propagates skipped frames, applies correction prompts, and reuses disk masks on seek", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "framefields-sam-clip-"));
		const source = path.join(dir, "source.mp4");
		await writeFile(source, "decoder test fixture");
		const process = vi.fn(
			async (
				_image: unknown,
				frame: number,
				_points?: readonly Sam2Point[],
			) => ({
				mask: Uint8Array.from({ length: 32 }, (_, i) =>
					i % 8 === frame ? 255 : 0,
				),
				width: 8,
				height: 4,
				score: 4,
				iou: 0.9,
			}),
		);
		const release = vi.fn();
		vi.spyOn(Sam2Tracker, "create").mockResolvedValue({
			process,
			release,
		} as unknown as Sam2Tracker);
		vi.spyOn(mediaDecoderCache, "getVideo").mockReturnValue({
			durationSec: async () => 10,
			getFrame: async () => ({
				width: 8,
				height: 4,
				buffer: new Uint8Array(128),
			}),
		} as unknown as ReturnType<typeof mediaDecoderCache.getVideo>);
		const options = {
			cacheDir: dir,
			sam2: {
				prompts: [
					{ frame: 1, points },
					{ frame: 3, points },
				],
			},
		};
		try {
			const clip = new ClipVision(source, 24, options);
			const signals = clip.signals;
			await clip.ready(4);
			expect(process.mock.calls.map((call) => call[1])).toEqual([1, 2, 3, 4]);
			expect(process.mock.calls[0]?.[2]).toEqual(points);
			expect(process.mock.calls[1]?.[2]).toBeUndefined();
			expect(process.mock.calls[2]?.[2]).toEqual(points);
			expect(clip.subject(0, 24)).toBeNull();
			expect(signals.getMaskResult(4)[0]?.mask[4]).toBe(255);
			clip.release();
			const restored = new ClipVision(source, 24, options);
			await restored.ready(2);
			expect(restored.subject(2, 24)?.mask[2]).toBe(255);
			expect(process).toHaveBeenCalledTimes(4);
			const invalid = new ClipVision(source, 24, {
				cacheDir: false,
				sam2: {
					prompts: [
						{ frame: 0, points },
						{ frame: 300, points },
					],
				},
			});
			await expect(invalid.ready(0)).rejects.toThrow("inside the source video");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("gives concurrent clips of one source their own decoders", async () => {
		// A decoder drops a pending request when a newer one arrives, so shared
		// decoders made one clip read `null` frames while another advanced.
		vi.spyOn(Sam2Tracker, "create").mockResolvedValue({
			process: async () => ({
				mask: new Uint8Array(32),
				width: 8,
				height: 4,
				score: 1,
				iou: 1,
			}),
			release: () => {},
		} as unknown as Sam2Tracker);
		const getVideo = vi.spyOn(mediaDecoderCache, "getVideo").mockReturnValue({
			durationSec: async () => 1,
			getFrame: async () => ({
				width: 8,
				height: 4,
				buffer: new Uint8Array(128),
			}),
		} as unknown as ReturnType<typeof mediaDecoderCache.getVideo>);
		const clips = [0.25, 0.75].map(
			(x) =>
				new ClipVision("shared.mp4", 24, {
					cacheDir: false,
					sam2: { prompts: [{ frame: 0, points: [{ x, y: 0.5, label: 1 }] }] },
				}),
		);
		await Promise.all(clips.map((clip) => clip.ready(2)));
		const ids = new Set(getVideo.mock.calls.map((call) => call[2]));
		expect(ids.size).toBe(2);
	});

	it("publishes every SAM 3 track under its own ID", async () => {
		const columns = (from: number) =>
			Uint8Array.from({ length: 32 }, (_, i) =>
				i % 8 >= from && i % 8 < from + 2 ? 255 : 0,
			);
		vi.spyOn(Sam3Tracker, "create").mockResolvedValue({
			process: async () => ({
				width: 8,
				height: 4,
				objects: [
					{ id: 1, mask: columns(0), score: 3, iou: 1 },
					{ id: 2, mask: columns(5), score: 2, iou: 1 },
				],
			}),
			release: () => {},
		} as unknown as Sam3Tracker);
		vi.spyOn(mediaDecoderCache, "getVideo").mockReturnValue({
			durationSec: async () => 1,
			getFrame: async () => ({
				width: 8,
				height: 4,
				buffer: new Uint8Array(128),
			}),
		} as unknown as ReturnType<typeof mediaDecoderCache.getVideo>);
		const clip = new ClipVision("crowd.mp4", 24, {
			cacheDir: false,
			sam3: { category: "person", maxObjects: 2, text: "student" },
		});
		const signals = clip.signals;
		await clip.ready(0);
		const objects = signals.getObjectResult(0).objects;
		expect(objects.map((o) => [o.trackId, o.boundingBox.originX])).toEqual([
			[1, 0],
			[2, 5],
		]);
		expect(signals.getMaskResult(0).map((m) => m.trackId)).toEqual([1, 2]);
		expect(signals.segmentation.matte.at(0)?.coverage).toBe(0.5);
		clip.release();
	});
});
