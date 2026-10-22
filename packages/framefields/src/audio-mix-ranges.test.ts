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
