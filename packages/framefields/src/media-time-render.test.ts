import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decodeAudioSource } from "@framefields/compositions";
import { beforeAll, describe, expect, it } from "vitest";
import {
	Blur,
	Composition,
	FilmGrain,
	HeadlessMediaRenderer,
	Layer,
	Signal,
} from "./index.js";
import { decodePngPixels, getPixel } from "./test-utils/pixels.js";

let source = "";
let sourceAv = "";
let sourceVfr = "";
let sourceShortAudio = "";
const hasFfmpeg = (() => {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();
beforeAll(async () => {
	if (!hasFfmpeg) return;
	source = path.join(
		await fs.mkdtemp(path.join(os.tmpdir(), "media-time-")),
		"source.mp4",
	);
	const colors = [
		[255, 0, 0],
		[0, 255, 0],
		[0, 0, 255],
		[255, 255, 255],
	];
	const raw = Buffer.alloc(16 * 16 * 3 * colors.length);
	for (let f = 0; f < colors.length; f++)
		for (let i = 0; i < 16 * 16; i++)
			for (let c = 0; c < 3; c++) raw[(f * 16 * 16 + i) * 3 + c] = colors[f][c];
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-y",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-s",
			"16x16",
			"-r",
			"4",
			"-i",
			"pipe:0",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-g",
			"1",
			source,
		],
		{ input: raw },
	);
	sourceAv = path.join(path.dirname(source), "source-av.mp4");
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-y",
		"-i",
		source,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=48000:duration=1",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-shortest",
		sourceAv,
	]);
	sourceVfr = path.join(path.dirname(source), "source-vfr.mp4");
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-y",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-s",
			"16x16",
			"-r",
			"4",
			"-i",
			"pipe:0",
			"-vf",
			"setpts=N*N/(4*TB)",
			"-fps_mode",
			"vfr",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-g",
			"1",
			sourceVfr,
		],
		{ input: raw },
	);
	sourceShortAudio = path.join(path.dirname(source), "source-short-audio.mp4");
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-y",
		"-i",
		source,
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:sample_rate=48000:duration=0.5",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		sourceShortAudio,
	]);
});

describe.skipIf(!hasFfmpeg)("remapped video", () => {
	it("selects reverse variable-frame-rate samples by their presentation timestamps", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 4,
		});
		comp.add(
			Layer.video(sourceVfr, {
				width: 16,
				height: 16,
				durationFrames: 4,
				timeRemap: { kind: "rate", sourceStartSec: 1.25, rate: -1 },
			}),
		);
		const renderer = new HeadlessMediaRenderer();
		const frame = async (i: number) =>
			getPixel(
				await decodePngPixels(await comp.renderFrame({ frame: i, renderer })),
				8,
				8,
			);
		expect((await frame(0)).b).toBeGreaterThan(200);
		expect((await frame(2)).g).toBeGreaterThan(200);
		expect((await frame(1)).b).toBeGreaterThan(200);
		expect((await frame(3)).g).toBeGreaterThan(200);
	});
	it("rejects an out-of-range turning point even when the endpoints are valid", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 8,
		});
		comp.add(
			Layer.video(source, {
				width: 16,
				height: 16,
				durationFrames: 8,
				timeRemap: {
					kind: "keyframes",
					keyframes: [
						{ frame: 0, sourceSec: 0.2 },
						{ frame: 4, sourceSec: 1.2 },
						{ frame: 8, sourceSec: 0.2 },
					],
				},
			}),
		);
		await expect(comp.renderFrame({ frame: 0 })).rejects.toThrow(/outside/);
	});
	it("renders reverse and a direction change with random-access seeks", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 8,
		});
		comp.add(
			Layer.video(source, {
				width: 16,
				height: 16,
				durationFrames: 8,
				timeRemap: {
					kind: "keyframes",
					keyframes: [
						{ frame: 0, sourceSec: 0 },
						{ frame: 4, sourceSec: 0.75, interpolation: "smooth" },
						{ frame: 8, sourceSec: 0 },
					],
				},
			}),
		);
		const renderer = new HeadlessMediaRenderer();
		const pixel = async (frame: number) =>
			getPixel(
				await decodePngPixels(await comp.renderFrame({ frame, renderer })),
				8,
				8,
			);
		const blue = await pixel(5);
		const red = await pixel(0);
		const white = await pixel(4);
		const green = await pixel(6);
		expect(red.r).toBeGreaterThan(200);
		expect(red.g).toBeLessThan(40);
		expect(white.r).toBeGreaterThan(200);
		expect(white.g).toBeGreaterThan(200);
		expect(white.b).toBeGreaterThan(200);
		expect(blue.b).toBeGreaterThan(200);
		expect(blue.r).toBeLessThan(40);
		expect(green.g).toBeGreaterThan(200);
		expect(green.r).toBeLessThan(40);
	});
	it("does not require muted audio to span the picture mapping", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 4,
		});
		comp.add(
			Layer.video(sourceShortAudio, {
				width: 16,
				height: 16,
				durationFrames: 4,
				muted: true,
				timeRemap: { kind: "rate", sourceStartSec: 0, rate: 1 },
			}),
		);
		await expect(comp.renderFrame({ frame: 3 })).resolves.toBeInstanceOf(
			Buffer,
		);
	});
	it("continues animated effects during a video hold", async () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: 4,
			durationFrames: 4,
		});
		comp.add(
			Layer.video(source, {
				width: 64,
				height: 64,
				durationFrames: 4,
				timeRemap: {
					kind: "keyframes",
					keyframes: [
						{ frame: 0, sourceSec: 0.25 },
						{ frame: 4, sourceSec: 0.25 },
					],
				},
			}).apply(new FilmGrain({ strength: 60, animated: true, speed: 50 })),
		);
		const renderer = new HeadlessMediaRenderer();
		const first = await comp.renderFrame({ frame: 0, renderer });
		const next = await comp.renderFrame({ frame: 1, renderer });
		expect(first.equals(next)).toBe(false);
	});
	it("selects variable-frame-rate samples by their timestamps", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 4,
		});
		comp.add(
			Layer.video(sourceVfr, {
				width: 16,
				height: 16,
				durationFrames: 4,
				timeRemap: { kind: "rate", sourceStartSec: 0.5, rate: 1 },
			}),
		);
		const green = getPixel(
			await decodePngPixels(await comp.renderFrame({ frame: 0 })),
			8,
			8,
		);
		const blue = getPixel(
			await decodePngPixels(await comp.renderFrame({ frame: 2 })),
			8,
			8,
		);
		expect(green.g).toBeGreaterThan(200);
		expect(blue.b).toBeGreaterThan(200);
	});
	it("retimes a video's embedded audio with its picture", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 8,
		});
		comp.add(
			Layer.video(sourceAv, {
				width: 16,
				height: 16,
				durationFrames: 8,
				timeRemap: { kind: "rate", sourceStartSec: 0, rate: 0.5 },
			}),
		);
		const result = await new HeadlessMediaRenderer().renderAudio(
			comp.toVirtualMedia(),
			{ fps: 4, sampleRate: 48000 },
		);
		const original = await decodeAudioSource(sourceAv);
		if (!original) throw new Error("embedded audio did not decode");
		for (const i of [48000, 72000, 90000])
			expect(result.channels[0][i]).toBeCloseTo(
				Math.tanh(original.channels[0][i / 2]),
				4,
			);
	});
	it("maps nested layer timing from the layer's own start", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 8,
		});
		comp.add(
			Layer.box({
				width: 16,
				height: 16,
				startFrame: 1,
				durationFrames: 7,
				children: [
					Layer.video(source, {
						width: 16,
						height: 16,
						startFrame: 1,
						durationFrames: 4,
						timeRemap: { kind: "rate", sourceStartSec: 0, rate: 0.5 },
					}),
				],
			}),
		);
		const pixel = getPixel(
			await decodePngPixels(await comp.renderFrame({ frame: 4 })),
			8,
			8,
		);
		expect(pixel.g).toBeGreaterThan(200);
		expect(pixel.r).toBeLessThan(40);
	});
	it("renders the mapped source frame at a layer-local clock, including a hold", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 10,
		});
		comp.add(
			Layer.video(sourceAv, {
				width: 16,
				height: 16,
				startFrame: 2,
				durationFrames: 8,
				timeRemap: {
					kind: "keyframes",
					keyframes: [
						{ frame: 0, sourceSec: 0 },
						{ frame: 2, sourceSec: 0.25 },
						{ frame: 4, sourceSec: 0.25 },
						{ frame: 8, sourceSec: 0.75 },
					],
				},
			}),
		);
		const renderer = new HeadlessMediaRenderer();
		const pixel = async (frame: number) =>
			getPixel(
				await decodePngPixels(await comp.renderFrame({ frame, renderer })),
				8,
				8,
			);
		const red = await pixel(2);
		const green = await pixel(4);
		const hold = await pixel(5);
		const blue = await pixel(8);
		expect(red.r).toBeGreaterThan(200);
		expect(red.g).toBeLessThan(40);
		expect(green.g).toBeGreaterThan(200);
		expect(green.r).toBeLessThan(40);
		expect(hold.g).toBeGreaterThan(200);
		expect(hold.r).toBeLessThan(40);
		expect(blue.b).toBeGreaterThan(200);
		expect(blue.g).toBeLessThan(40);
	});
	it("rejects a map beyond the source duration", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 8,
		});
		comp.add(
			Layer.video(source, {
				width: 16,
				height: 16,
				durationFrames: 8,
				timeRemap: { kind: "rate", sourceStartSec: 0, rate: 1 },
			}),
		);
		await expect(comp.renderFrame({ frame: 0 })).rejects.toThrow(/outside/);
		await expect(comp.renderVideo()).rejects.toThrow(/outside/);
	});
	it("keeps effect signals on the composition clock", async () => {
		const frames: number[] = [];
		const strength = Signal.builder({
			type: "custom",
			fn: (ctx) => {
				frames.push(ctx.frame);
				return 2;
			},
		});
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 8,
		});
		comp.add(
			Layer.video(source, {
				width: 16,
				height: 16,
				startFrame: 2,
				durationFrames: 4,
				timeRemap: { kind: "rate", sourceStartSec: 0, rate: 0.5 },
			}).apply(new Blur({ strength })),
		);
		await comp.renderFrame({ frame: 4 });
		expect(frames).toContain(4);
		expect(frames).not.toContain(1);
	});
	it("encodes the same retimed sequence", async () => {
		const comp = new Composition({
			width: 16,
			height: 16,
			fps: 4,
			durationFrames: 8,
		});
		comp.add(
			Layer.video(sourceAv, {
				width: 16,
				height: 16,
				durationFrames: 8,
				timeRemap: { kind: "rate", sourceStartSec: 0, rate: 0.5 },
			}),
		);
		const result = await comp.renderVideo();
		try {
			const probe = JSON.parse(
				execFileSync(
					"ffprobe",
					[
						"-v",
						"error",
						"-select_streams",
						"v:0",
						"-show_entries",
						"stream=nb_frames",
						"-of",
						"json",
						result.filePath,
					],
					{ encoding: "utf8" },
				),
			) as { streams: { nb_frames: string }[] };
			expect(Number(probe.streams[0].nb_frames)).toBe(8);
			const bytes = execFileSync("ffmpeg", [
				"-v",
				"error",
				"-i",
				result.filePath,
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			]);
			const pixel = (frame: number, channel: number) =>
				bytes[(frame * 16 * 16 + 8 * 16 + 8) * 3 + channel];
			expect(pixel(0, 0)).toBeGreaterThan(200);
			expect(pixel(2, 1)).toBeGreaterThan(200);
			expect(pixel(4, 2)).toBeGreaterThan(200);
			const audio = execFileSync("ffmpeg", [
				"-v",
				"error",
				"-i",
				result.filePath,
				"-map",
				"0:a:0",
				"-f",
				"f32le",
				"-ac",
				"1",
				"-ar",
				"48000",
				"pipe:1",
			]);
			let energy = 0;
			for (let i = 48000; i < 72000; i++)
				energy += audio.readFloatLE(i * 4) ** 2;
			expect(Math.sqrt(energy / 24000)).toBeGreaterThan(0.02);
		} finally {
			await result.cleanup();
		}
	});
});
