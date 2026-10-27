/**
 * The mix decodes only the stretch of a source each clip plays and skips
 * silent layers. Both must leave the mix sample-for-sample what a whole-file
 * decode gives, including for compressed sources decoded from mid-file.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decodeAudioSource } from "@framefields/compositions";
import { beforeAll, describe, expect, it } from "vitest";
import { Composition, encodeStereoWav, Layer } from "./index.js";
import { HeadlessMediaRenderer } from "./renderer/index.js";

const SR = 48000;
const FPS = 30;
const SOURCE_SEC = 40;
const TRIM_SEC = 31.5;

const hasFfmpeg = (() => {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

/** Seeded noise, distinct per channel, quiet enough that no codec peak trips the mix's auto-gain. */
function noise(seconds: number, seed: number): Float32Array {
	const out = new Float32Array(Math.round(seconds * SR));
	let s = seed;
	for (let i = 0; i < out.length; i++) {
		s = (s * 1103515245 + 12345) >>> 0;
		out[i] = ((s / 2 ** 32) * 2 - 1) * 0.3;
	}
	return out;
}

let dir = "";
const sources: Record<string, string> = {};

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-mix-ranges-"));
	sources.wav = path.join(dir, "source.wav");
	await fs.writeFile(
		sources.wav,
		encodeStereoWav([noise(SOURCE_SEC, 1), noise(SOURCE_SEC, 2)], {
			sampleRate: SR,
		}),
	);
	sources.short = path.join(dir, "short.wav");
	await fs.writeFile(
		sources.short,
		encodeStereoWav([noise(1, 1), noise(1, 2)], { sampleRate: SR }),
	);
	if (hasFfmpeg) {
		for (const [ext, codec] of [
			["mp3", "libmp3lame"],
			["m4a", "aac"],
		]) {
			sources[ext] = path.join(dir, `source.${ext}`);
			execFileSync("ffmpeg", [
				...["-v", "error", "-y", "-i", sources.wav],
				...["-c:a", codec, "-b:a", "128k", sources[ext]],
			]);
		}
	}
}, 120_000);

async function mix(comp: Composition) {
	return new HeadlessMediaRenderer().renderAudio(comp.toVirtualMedia(), {
		fps: FPS,
		sampleRate: SR,
	});
}

describe("audio mix source ranges", () => {
	for (const ext of ["wav", "mp3", "m4a"]) {
		it.skipIf(ext !== "wav" && !hasFfmpeg)(
			`plays a clip late in a long ${ext} source as the whole file decodes it`,
			async () => {
				const comp = new Composition({
					width: 64,
					height: 64,
					fps: FPS,
					durationMs: 3000,
				});
				comp.addAudio(
					Layer.audio(sources[ext], {
						trimStartSec: TRIM_SEC,
						startFrame: 15,
						durationFrames: 60,
					}),
				);
				const { channels } = await mix(comp);

				const whole = await decodeAudioSource(sources[ext]);
				expect(whole?.sampleRate).toBe(SR);
				const from = Math.round(TRIM_SEC * SR);
				const start = Math.round((15 / FPS) * SR);
				const length = Math.round((60 / FPS) * SR);
				for (let c = 0; c < 2; c++) {
					const out = channels[c];
					const src = whole?.channels[c] as Float32Array;
					let mismatches = 0;
					for (let i = 0; i < length; i++) {
						// The mix's soft limiter is a plain tanh at this level
						if (out[start + i] !== Math.fround(Math.tanh(src[from + i]))) {
							mismatches++;
						}
					}
					expect(mismatches).toBe(0);
					expect(out[start - 1]).toBe(0);
					expect(out[start + length]).toBe(0);
				}
			},
			60_000,
		);
	}

	it("leaves the mix unchanged by silent visual layers", async () => {
		const build = (withVisuals: boolean) => {
			const comp = new Composition({
				width: 64,
				height: 64,
				fps: FPS,
				durationMs: 2000,
			});
			if (withVisuals) {
				for (let i = 0; i < 4; i++) comp.add(Layer.text(`t${i}`));
			}
			comp.addAudio(
				Layer.audio(sources.wav, { trimStartSec: 3, durationFrames: 45 }),
			);
			comp.addAudio(
				Layer.audio(sources.wav, {
					trimStartSec: 20,
					startFrame: 30,
					volume: 0.5,
				}),
			);
			return comp;
		};
		const plain = await mix(build(false));
		const withVisuals = await mix(build(true));
		for (let c = 0; c < 2; c++) {
			expect(withVisuals.channels[c]).toEqual(plain.channels[c]);
		}
		// Both clips are heard where they play
		expect(Math.abs(plain.channels[0][SR / 2])).toBeGreaterThan(0);
		expect(Math.abs(plain.channels[0][Math.round(1.5 * SR)])).toBeGreaterThan(
			0,
		);
	}, 60_000);
});

describe("media time remapping", () => {
	it("plays a constant negative rate backward", async () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: FPS,
			durationFrames: 30,
		});
		comp.addAudio(
			Layer.audio(sources.short, {
				durationFrames: 30,
				timeRemap: { kind: "rate", sourceStartSec: 0.9, rate: -0.5 },
			}),
		);
		const { channels } = await mix(comp);
		const whole = await decodeAudioSource(sources.short);
		if (!whole) throw new Error("source audio did not decode");
		for (const i of [0, 12000, 24000, 36000]) {
			const sourceIndex = Math.round(0.9 * SR - i / 2);
			expect(channels[0][i]).toBeCloseTo(
				Math.tanh(whole.channels[0][sourceIndex]),
				5,
			);
		}
	});
	it("keeps reverse samples continuous across bounded decode chunks", async () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: FPS,
			durationFrames: 90,
		});
		comp.addAudio(
			Layer.audio(sources.short, {
				durationFrames: 90,
				timeRemap: { kind: "rate", sourceStartSec: 0.9, rate: -0.25 },
			}),
		);
		const { channels } = await mix(comp);
		const whole = await decodeAudioSource(sources.short);
		if (!whole) throw new Error("source audio did not decode");
		for (const i of [2 * SR - 4, 2 * SR - 1, 2 * SR, 2 * SR + 1, 2 * SR + 4]) {
			const position = 0.9 * SR - i * 0.25;
			const index = Math.floor(position);
			const expected =
				whole.channels[0][index] +
				(whole.channels[0][index + 1] - whole.channels[0][index]) *
					(position - index);
			expect(channels[0][i]).toBeCloseTo(Math.tanh(expected), 5);
		}
	});
	it("plays reverse audio through direction changes and smooth ramps", async () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: FPS,
			durationFrames: 90,
		});
		comp.addAudio(
			Layer.audio(sources.short, {
				durationFrames: 90,
				timeRemap: {
					kind: "keyframes",
					keyframes: [
						{ frame: 0, sourceSec: 0.1, interpolation: "smooth" },
						{ frame: 30, sourceSec: 0.8 },
						{ frame: 60, sourceSec: 0.2 },
						{ frame: 90, sourceSec: 0.2 },
					],
				},
			}),
		);
		const { channels } = await mix(comp);
		const whole = await decodeAudioSource(sources.short);
		if (!whole) throw new Error("source audio did not decode");
		for (const [output, source] of [
			[0, 0.1],
			[0.5, 0.45],
			[1, 0.8],
			[1.5, 0.5],
			[1.9, 0.26],
		]) {
			const sourceIndex = source * SR;
			const index = Math.floor(sourceIndex);
			const expected =
				whole.channels[0][index] +
				(whole.channels[0][index + 1] - whole.channels[0][index]) *
					(sourceIndex - index);
			expect(channels[0][Math.round(output * SR)]).toBeCloseTo(
				Math.tanh(expected),
				4,
			);
		}
		for (const sample of [2 * SR, 2.5 * SR, 3 * SR - 1])
			expect(channels[0][sample]).toBe(0);
	});
	it("resolves nested layer start times without offsetting source time", async () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: FPS,
			durationFrames: 90,
		});
		comp.add(
			Layer.box({
				startFrame: 15,
				durationFrames: 75,
				children: [
					Layer.audio(sources.short, {
						startFrame: 15,
						durationFrames: 30,
						timeRemap: { kind: "rate", sourceStartSec: 0, rate: 1 },
					}),
				],
			}),
		);
		const { channels } = await mix(comp);
		const whole = await decodeAudioSource(sources.short);
		if (!whole) throw new Error("source audio did not decode");
		expect(channels[0][SR - 1]).toBe(0);
		for (const i of [0, 1000, 24000])
			expect(channels[0][SR + i]).toBeCloseTo(
				Math.tanh(whole.channels[0][i]),
				5,
			);
	});
	it("keeps slow audio audible beyond the original source duration", async () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: FPS,
			durationFrames: 60,
		});
		comp.addAudio(
			Layer.audio(sources.short, {
				durationFrames: 60,
				timeRemap: { kind: "rate", sourceStartSec: 0, rate: 0.5 },
			}),
		);
		const { channels } = await mix(comp);
		const whole = await decodeAudioSource(sources.short);
		if (!whole) throw new Error("source audio did not decode");
		for (const i of [48000, 72000, 90000]) {
			expect(channels[0][i]).toBeCloseTo(
				Math.tanh(whole.channels[0][i / 2]),
				5,
			);
		}
	});
	it("does not truncate retimed audio when source metadata has a shorter duration", async () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: FPS,
			durationFrames: 60,
		});
		comp.addAudio(
			Layer.audio(sources.short, {
				durationFrames: 60,
				timeRemap: { kind: "rate", sourceStartSec: 0, rate: 0.5 },
			}),
		);
		const vm = comp.toVirtualMedia();
		vm.children[0].children[0].metadata.durationMs = 1000;
		const { channels } = await new HeadlessMediaRenderer().renderAudio(vm, {
			fps: FPS,
			sampleRate: SR,
		});
		const whole = await decodeAudioSource(sources.short);
		if (!whole) throw new Error("source audio did not decode");
		expect(channels[0][72000]).toBeCloseTo(
			Math.tanh(whole.channels[0][36000]),
			5,
		);
	});
	it("maps source samples at sub-frame rates and outputs silence for holds", async () => {
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: FPS,
			durationFrames: 90,
		});
		comp.addAudio(
			Layer.audio(sources.wav, {
				startFrame: 15,
				durationFrames: 60,
				timeRemap: {
					kind: "keyframes",
					keyframes: [
						{ frame: 0, sourceSec: 2 },
						{ frame: 15, sourceSec: 2.25 },
						{ frame: 30, sourceSec: 2.25 },
						{ frame: 60, sourceSec: 3.25 },
					],
				},
			}),
		);
		const { channels } = await mix(comp);
		const whole = await decodeAudioSource(sources.wav);
		if (!whole) throw new Error("source audio did not decode");
		const base = SR / 2;
		for (const i of [0, 2, 200, 6000, 12000, 23998]) {
			const source = 2 * SR + i * 0.5;
			const index = Math.floor(source);
			const expected =
				whole.channels[0][index] +
				(whole.channels[0][index + 1] - whole.channels[0][index]) *
					(source - index);
			expect(channels[0][base + i]).toBeCloseTo(Math.tanh(expected), 5);
		}
		for (const i of [24000, 30000, 47999])
			expect(channels[0][base + i]).toBe(0);
		for (const i of [48000, 50000, 70000]) {
			const index = Math.round(2.25 * SR + (i - 48000));
			expect(channels[0][base + i]).toBeCloseTo(
				Math.tanh(whole.channels[0][index]),
				5,
			);
		}
	});
});
