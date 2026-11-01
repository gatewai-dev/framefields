/**
 * A render split into chunks (`renderVideo({ frames, audio: false })`) and
 * joined by `stitchChunks` matches the same render done in one go: every
 * frame, including the first one after a seam (where particles and trails
 * rebuild their state), and the soundtrack.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	ALL_FORMATS,
	EncodedPacketSink,
	FilePathSource,
	Input,
} from "mediabunny";
import { describe, expect, it } from "vitest";
import {
	Composition,
	encodeStereoWav,
	Layer,
	LayerAnimation,
	Trails,
} from "./index.js";
import { stitchChunks } from "./renderer/index.js";

const hasFfmpeg = (() => {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

const W = 160;
const H = 96;
const FPS = 30;
const FRAMES = 30;
const SEAM = 13;

function tone(seconds: number, sampleRate: number): Float32Array {
	const out = new Float32Array(Math.round(seconds * sampleRate));
	for (let i = 0; i < out.length; i++)
		out[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
	return out;
}

async function film(dir: string, width = W): Promise<Composition> {
	const wav = path.join(dir, "tone.wav");
	const source = tone(FRAMES / FPS, 48_000);
	await fs.writeFile(
		wav,
		encodeStereoWav([source, source], { sampleRate: 48_000 }),
	);
	const comp = new Composition({
		width,
		height: H,
		fps: FPS,
		durationFrames: FRAMES,
		backgroundColor: "#000000",
	});
	comp.add(
		Layer.particles({
			width,
			height: H,
			max: 1000,
			emitter: { shape: "point", x: width / 2, y: H - 8, rate: 300 },
			direction: -90,
			spread: 30,
			speed: [60, 90],
			lifetime: [2, 2],
			size: [4, 4],
			color: "#ffffff",
		}),
	);
	comp.add(
		Layer.shape("rect", {
			fillColor: "#ff4040",
			width: 20,
			height: 20,
			x: 0,
			y: 10,
		})
			.animate(
				LayerAnimation.create().fromTo("x", 0, width - 20, {
					start: 0,
					end: FRAMES,
				}),
			)
			.withEffect(new Trails({ decay: 0.8 })),
	);
	comp.add(Layer.audio(wav, { volume: 1, durationFrames: FRAMES }));
	return comp;
}

function decodeFrames(file: string): Buffer[] {
	const raw = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			file,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		{ maxBuffer: 1 << 28 },
	);
	const size = W * H * 3;
	return Array.from({ length: raw.length / size }, (_, i) =>
		raw.subarray(i * size, (i + 1) * size),
	);
}

function decodeAudio(file: string): Float32Array {
	const raw = execFileSync(
		"ffmpeg",
		["-v", "error", "-i", file, "-vn", "-ac", "1", "-f", "f32le", "pipe:1"],
		{ maxBuffer: 1 << 28 },
	);
	return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

function meanAbsDiff(a: Buffer, b: Buffer): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
	return sum / a.length;
}

async function packetCount(
	file: string,
): Promise<{ video: number; audio: number }> {
	const input = new Input({
		source: new FilePathSource(file),
		formats: ALL_FORMATS,
	});
	try {
		const count = async (
			track: Parameters<typeof EncodedPacketSink>[0] | null,
		) => {
			let n = 0;
			if (track)
				for await (const _ of new EncodedPacketSink(track).packets()) n++;
			return n;
		};
		return {
			video: await count(await input.getPrimaryVideoTrack()),
			audio: await count(await input.getPrimaryAudioTrack()),
		};
	} finally {
		input.dispose();
	}
}

describe("chunked render + stitchChunks", () => {
	it.skipIf(!hasFfmpeg)(
		"matches the render done in one go, frame for frame and in audio",
		async () => {
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-chunks-"));
			const comp = await film(dir);
			const full = path.join(dir, "full.mp4");
			await comp.renderVideo({ outputPath: full });

			const chunks = [path.join(dir, "a.mp4"), path.join(dir, "b.mp4")];
			// Each chunk on its own composition, as a worker builds it.
			await (await film(dir)).renderVideo({
				outputPath: chunks[0],
				frames: { start: 0, end: SEAM },
				audio: false,
			});
			await (await film(dir)).renderVideo({
				outputPath: chunks[1],
				frames: { start: SEAM, end: FRAMES },
				audio: false,
			});
			const audio = path.join(dir, "audio.mp4");
			await (await film(dir)).renderVideo({ outputPath: audio, codec: "aac" });

			expect(await packetCount(chunks[0])).toEqual({ video: SEAM, audio: 0 });
			expect((await packetCount(chunks[1])).video).toBe(FRAMES - SEAM);

			const stitched = path.join(dir, "stitched.mp4");
			const result = await stitchChunks({
				chunks,
				audio,
				outputPath: stitched,
			});
			expect(result.frames).toBe(FRAMES);
			expect(result.durationSec).toBeCloseTo(FRAMES / FPS, 3);
			expect((await packetCount(stitched)).video).toBe(FRAMES);

			const want = decodeFrames(full);
			const got = decodeFrames(stitched);
			expect(got).toHaveLength(FRAMES);
			// The scene really moves: consecutive frames differ.
			expect(meanAbsDiff(want[SEAM - 1], want[SEAM])).toBeGreaterThan(1);
			// Same pictures; a chunk's first frame is a fresh keyframe, so allow
			// for the codec, not for wrong content.
			for (let f = 0; f < FRAMES; f++)
				expect(meanAbsDiff(got[f], want[f]), `frame ${f}`).toBeLessThan(0.5);

			const a = decodeAudio(full);
			const b = decodeAudio(stitched);
			expect(b.length).toBe(a.length);
			expect(meanAbsDiff(Buffer.from(a.buffer), Buffer.from(b.buffer))).toBe(0);
		},
		120_000,
	);

	it("rejects a frame range outside the composition", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-chunks-"));
		const comp = await film(dir);
		await expect(
			comp.renderVideo({ frames: { start: 10, end: FRAMES + 1 } }),
		).rejects.toThrow(/Invalid frames/);
		await expect(
			comp.renderVideo({ frames: { start: 5, end: 5 } }),
		).rejects.toThrow(/Invalid frames/);
	});

	it("refuses to stitch chunks encoded differently", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-chunks-"));
		const a = path.join(dir, "a.mp4");
		const b = path.join(dir, "b.mp4");
		await (await film(dir)).renderVideo({
			outputPath: a,
			frames: { start: 0, end: 4 },
			audio: false,
		});
		await (await film(dir, W + 32)).renderVideo({
			outputPath: b,
			frames: { start: 4, end: 8 },
			audio: false,
		});
		const out = path.join(dir, "out.mp4");
		await expect(
			stitchChunks({ chunks: [a, b], outputPath: out }),
		).rejects.toThrow(/size/);
		await expect(fs.stat(out)).rejects.toThrow();
	}, 60_000);
});
