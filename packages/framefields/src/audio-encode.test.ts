import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Composition, encodeStereoWav, Layer } from "./index.js";

const hasFfmpeg = (() => {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

/**
 * Seeded noise, low-passed (~600 Hz) so the codec reproduces it faithfully:
 * any reordered or overwritten chunk still destroys its correlation.
 */
function noise(seconds: number, sampleRate: number): Float32Array {
	const out = new Float32Array(Math.round(seconds * sampleRate));
	const a = 1 - Math.exp((-2 * Math.PI * 600) / sampleRate);
	let s = 12345;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < out.length; i++) {
		s = (s * 1103515245 + 12345) >>> 0;
		y1 += a * ((s / 2 ** 32) * 2 - 1 - y1);
		y2 += a * (y1 - y2);
		out[i] = y2;
	}
	const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
	return out.map((v) => (v / peak) * 0.5);
}

function decodeMono(file: string, sampleRate: number): Float32Array {
	const raw = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			file,
			"-ac",
			"1",
			"-ar",
			String(sampleRate),
			"-f",
			"f32le",
			"pipe:1",
		],
		{
			maxBuffer: 1 << 28,
		},
	);
	return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

/** Best normalized correlation of `a` against `b` over lags 0..maxLag (encoder priming delays the output). */
function bestCorrelation(
	a: Float32Array,
	b: Float32Array,
	maxLag: number,
): number {
	let best = -1;
	const n = Math.min(a.length, b.length) - maxLag;
	for (let lag = 0; lag <= maxLag; lag++) {
		let dot = 0;
		let na = 0;
		let nb = 0;
		for (let i = 0; i < n; i++) {
			const x = a[i + lag];
			const y = b[i];
			dot += x * y;
			na += x * x;
			nb += y * y;
		}
		best = Math.max(best, dot / Math.sqrt(na * nb + 1e-12));
	}
	return best;
}

describe("renderVideo audio", () => {
	it.skipIf(!hasFfmpeg)(
		"encodes the mixed soundtrack without corrupting chunks",
		async () => {
			const sampleRate = 48_000;
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gf-audio-"));
			const source = noise(1.5, sampleRate);
			await fs.writeFile(
				path.join(dir, "noise.wav"),
				encodeStereoWav([source, source], { sampleRate }),
			);

			const comp = new Composition({
				width: 64,
				height: 64,
				fps: 30,
				durationFrames: 45,
				backgroundColor: "#000000",
			});
			comp.add(
				Layer.audio(path.join(dir, "noise.wav"), {
					id: "noise",
					volume: 1,
					durationFrames: 45,
				}),
			);
			const out = path.join(dir, "out.mp4");
			const result = await comp.renderVideo({ outputPath: out });
			await result.cleanup?.();

			// Compare at 8 kHz over the middle second; AAC priming is ~21 ms (≤ 400 samples at 8 kHz).
			const rate = 8000;
			const encoded = decodeMono(out, rate).subarray(
				rate / 4,
				rate / 4 + rate + 400,
			);
			const reference = decodeMono(path.join(dir, "noise.wav"), rate).subarray(
				rate / 4,
				rate / 4 + rate,
			);
			expect(bestCorrelation(encoded, reference, 400)).toBeGreaterThan(0.9);
		},
		60_000,
	);
});
