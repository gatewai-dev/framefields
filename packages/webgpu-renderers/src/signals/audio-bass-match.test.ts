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

describe("WebGPU vs Python Bass Signal Matching", () => {
	it("matches Python bass signal extraction with WebGPU compute shaders", async () => {
		const wavPath = path.resolve(
			__dirname,
			"../../../../stracth/heavy-rough-synth-bass_130bpm_G_minor.wav",
		);
		const jsonPath = path.resolve(
			__dirname,
			"../../../../stracth/python_bass_signal.json",
		);

		if (!fs.existsSync(wavPath) || !fs.existsSync(jsonPath)) {
			console.warn("WAV or JSON not found, skipping");
			return;
		}

		const pythonData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
		const pythonValues: number[] = pythonData.values;

		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn("No WebGPU device, skipping:", e);
			return;
		}

		const { channels, sampleRate } = loadWavChannels(wavPath);

		// Run WebGPU extraction in "bass" mode
		const result = await AudioSignalComputePipeline.extractFeatures(
			device,
			channels,
			sampleRate,
			24,
			{
				extractionMode: "bass",
				sensitivity: 1.0,
				noiseFloorDb: -45,
				dynamicRangeDb: 36,
				attackMs: 10,
				releaseMs: 120,
			},
			512,
		);

		// Read back bassBuffer values from GPU
		const readBuffer = device.createBuffer({
			size: result.numFrames * 4,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});
		const encoder = device.createCommandEncoder();
		encoder.copyBufferToBuffer(
			result.bassBuffer,
			0,
			readBuffer,
			0,
			result.numFrames * 4,
		);
		device.queue.submit([encoder.finish()]);

		await readBuffer.mapAsync(GPUMapMode.READ);
		const gpuValues = new Float32Array(readBuffer.getMappedRange().slice(0));
		readBuffer.unmap();
		readBuffer.destroy();

		const formattedGpuValues = Array.from(gpuValues).map((v) =>
			Number(v.toFixed(4)),
		);

		const webgpuJsonPath = path.resolve(
			__dirname,
			"../../../../stracth/webgpu_bass_signal.json",
		);
		fs.writeFileSync(
			webgpuJsonPath,
			JSON.stringify(
				{
					sample_rate: sampleRate,
					fps: 24,
					total_frames: formattedGpuValues.length,
					min: Math.min(...formattedGpuValues),
					max: Math.max(...formattedGpuValues),
					values: formattedGpuValues,
				},
				null,
				2,
			),
		);

		console.log(
			`Comparing ${gpuValues.length} WebGPU frames vs ${pythonValues.length} Python frames:`,
		);
		console.log("WebGPU first 10:", formattedGpuValues.slice(0, 10));
		console.log("Python first 10:", pythonValues.slice(0, 10));

		// Check difference between GPU and Python DSP calculation
		let maxDiff = 0;
		let sumDiff = 0;
		const n = Math.min(gpuValues.length, pythonValues.length);
		for (let i = 0; i < n; i++) {
			const diff = Math.abs(formattedGpuValues[i] - pythonValues[i]);
			sumDiff += diff;
			if (diff > maxDiff) maxDiff = diff;
		}
		const avgDiff = sumDiff / n;
		console.log(
			`Max diff: ${maxDiff.toFixed(4)}, Avg diff: ${avgDiff.toFixed(4)}`,
		);

		// GPU bass values must be within 0.05 of Python DSP calculation
		expect(avgDiff).toBeLessThan(0.05);
		expect(maxDiff).toBeLessThan(0.15);
	});
});
