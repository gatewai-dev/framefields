import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeAudioSource } from "./audio-extractor.js";

const hasFfmpeg = (() => {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

function encodeTestWav(
	samples: Float32Array,
	sampleRate = 48000,
	numChannels = 1,
): Buffer {
	const bytesPerSample = 2;
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = samples.length * bytesPerSample;
	const buf = Buffer.alloc(44 + dataSize);

	buf.write("RIFF", 0, "ascii");
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write("WAVE", 8, "ascii");
	buf.write("fmt ", 12, "ascii");
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(numChannels, 22);
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(byteRate, 28);
	buf.writeUInt16LE(blockAlign, 32);
	buf.writeUInt16LE(16, 34);
	buf.write("data", 36, "ascii");
	buf.writeUInt32LE(dataSize, 40);

	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
		const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
		buf.writeInt16LE(Math.round(int16), offset);
		offset += 2;
	}
	return buf;
}

describe("Audio Extractor: decodeAudioSource", () => {
	it("decodes 16-bit PCM WAV to normalized Float32Array without bit mangling", async () => {
		const sampleRate = 48000;
		const testSamples = new Float32Array(sampleRate); // 1.0 sec
		for (let i = 0; i < testSamples.length; i++) {
			testSamples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.75;
		}

		const testWavPath = path.resolve("/tmp/audio_extractor_test_440.wav");
		await fs.writeFile(testWavPath, encodeTestWav(testSamples, sampleRate, 1));

		const result = await decodeAudioSource(testWavPath);
		expect(result).toBeDefined();
		expect(result?.sampleRate).toBe(sampleRate);
		expect(result?.channels.length).toBe(1);

		const channel0 = result!.channels[0]!;
		expect(channel0.length).toBe(sampleRate);

		let maxAbs = 0;
		for (let i = 0; i < channel0.length; i++) {
			const v = channel0[i]!;
			expect(Number.isFinite(v)).toBe(true);
			expect(Number.isNaN(v)).toBe(false);
			const abs = Math.abs(v);
			if (abs > maxAbs) maxAbs = abs;
			// All samples must be in [-1.0, 1.0], never astronomical float values like 1e36
			expect(abs).toBeLessThanOrEqual(1.0);
		}

		// Peak amplitude of decoded sine wave should be very close to 0.75 (within quantization tolerance)
		expect(maxAbs).toBeGreaterThan(0.7);
		expect(maxAbs).toBeLessThanOrEqual(0.76);
	});

	it.skipIf(!hasFfmpeg)(
		"decodes a source longer than a few minutes in full",
		async () => {
			// 48 kHz stereo float is 384 KB/s: five minutes is past any small
			// output cap a decoder pipe might have.
			const file = path.join(
				await fs.mkdtemp(path.join(os.tmpdir(), "audio-extractor-")),
				"long.mp3",
			);
			execFileSync("ffmpeg", [
				...["-v", "error", "-y", "-f", "lavfi"],
				...["-i", "sine=frequency=440:sample_rate=48000:duration=300"],
				...["-ac", "2", "-c:a", "libmp3lame", "-b:a", "64k", file],
			]);

			const result = await decodeAudioSource(file);
			expect(result?.channels.length).toBe(2);
			expect(result?.channels[0]?.length ?? 0).toBeGreaterThanOrEqual(
				299 * (result?.sampleRate ?? 0),
			);
		},
		120_000,
	);
});
