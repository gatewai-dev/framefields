import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDevice } from "../device.js";
import { AudioSignalComputePipeline } from "./audio-signal-compute.js";

function loadWavChannels(filePath: string): {
	channels: Float32Array[];
	sampleRate: number;
} {
	const buf = fs.readFileSync(filePath);
	const numChannels = buf.readUInt16LE(22);
	const sampleRate = buf.readUInt32LE(24);
	let offset = 12;
	while (offset < buf.length - 8) {
		const id = buf.toString("ascii", offset, offset + 4);
		const size = buf.readUInt32LE(offset + 4);
		if (id === "data") {
			offset += 8;
			break;
		}
		offset += 8 + size;
	}
	const numSamples = Math.floor((buf.length - offset) / (numChannels * 2));
	const left = new Float32Array(numSamples);
	const right = new Float32Array(numSamples);
	for (let i = 0; i < numSamples; i++) {
		left[i] = buf.readInt16LE(offset + i * 4) / 32768.0;
		right[i] = buf.readInt16LE(offset + i * 4 + 2) / 32768.0;
	}
	return { channels: [left, right], sampleRate };
}

describe("AudioSignalComputePipeline WebGPU Extraction", () => {
	it("extracts real audio features from user WAV file on GPU", async () => {
		const wavPath = path.resolve(
			__dirname,
			"../../../../stracth/heavy-rough-synth-bass_130bpm_G_minor.wav",
		);
		if (!fs.existsSync(wavPath)) {
			console.warn("WAV file not found, skipping integration test");
			return;
		}

		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch {
			console.warn("Skipping due to no WebGPU device");
			return;
		}

		const { channels, sampleRate } = loadWavChannels(wavPath);
		expect(channels.length).toBe(2);
		expect(sampleRate).toBe(44100);

		const result = await AudioSignalComputePipeline.extractFeatures(
			device,
			channels,
			sampleRate,
			24,
			{
				extractionMode: "rms_envelope",
				sensitivity: 1.0,
			},
			512,
		);

		expect(result.primaryBuffer).toBeDefined();
		expect(result.texture).toBeDefined();
		expect(result.textureView).toBeDefined();
		expect(result.numFrames).toBeGreaterThan(0);
		expect(result.durationSec).toBeCloseTo(7.38, 1);

		// Read back primaryBuffer values from GPU to verify non-zero signal!
		const readBuffer = device.createBuffer({
			size: result.numFrames * 4,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});
		const encoder = device.createCommandEncoder();
		encoder.copyBufferToBuffer(
			result.primaryBuffer,
			0,
			readBuffer,
			0,
			result.numFrames * 4,
		);
		device.queue.submit([encoder.finish()]);

		await readBuffer.mapAsync(GPUMapMode.READ);
		const values = new Float32Array(readBuffer.getMappedRange().slice(0));
		readBuffer.unmap();
		readBuffer.destroy();

		let maxVal = 0;
		let nonZeroCount = 0;
		for (let i = 0; i < values.length; i++) {
			if (values[i] > 0.001) nonZeroCount++;
			if (values[i] > maxVal) maxVal = values[i];
		}

		console.log(
			`Extracted ${values.length} frames from synth bass. Max signal value: ${maxVal.toFixed(4)}, non-zero frames: ${nonZeroCount}/${values.length}`,
		);
		expect(maxVal).toBeGreaterThan(0.1);
		expect(nonZeroCount).toBeGreaterThan(10);
		expect(result.stats).toBeDefined();
		expect(result.stats.primary.max).toBeCloseTo(maxVal, 2);
		expect(result.stats.primary.min).toBeGreaterThanOrEqual(0.0);
		expect(result.stats.primary.max).toBeGreaterThan(result.stats.primary.min);
	});
});
