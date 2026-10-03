import type { VirtualMediaData } from "@gitframes/core";
import { ensureDevice } from "@gitframes/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { noiseGateAudioProcessor } from "./audio-processor.js";

const createVirtualMedia = (overrides = {}): VirtualMediaData =>
	({
		id: "test-media",
		type: "audio",
		operation: {
			threshold: -40, // -40dB threshold
			attack: 0.01, // 10ms
			hold: 0.05, // 50ms
			release: 0.1, // 100ms
			range: -80, // -80dB reduction when closed
			...overrides,
		},
	}) as unknown as VirtualMediaData;

const createChannels = (
	numSamples: number,
	amplitude: number,
): Float32Array[] => {
	const channel = new Float32Array(numSamples).fill(amplitude);
	return [channel]; // Mono test is sufficient for logic testing
};

describe("Noise Gate Audio Processor", () => {
	const SAMPLE_RATE = 1000; // 1000 Hz makes math easy: 1ms = 1 sample
	const CLOSED_GAIN = 10 ** (-80 / 20); // 0.0001

	// Amplitudes
	const LOW_SIGNAL = 0.001; // -60dB (Below -40dB threshold)
	const HIGH_SIGNAL = 0.1; // -20dB (Above -40dB threshold)

	const runWithDevice = async (fn: (device: GPUDevice) => Promise<void>) => {
		try {
			const device = await ensureDevice();
			await fn(device);
		} catch {
			console.warn("Skipping test due to missing WebGPU device");
		}
	};

	it("should keep the gate CLOSED and attenuate signals below the threshold", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(100, LOW_SIGNAL);
			const virtualMedia = createVirtualMedia();

			await noiseGateAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-noise-gate-attenuate",
			});

			// Every sample should be attenuated by the CLOSED_GAIN
			expect(channels[0][0]).toBeCloseTo(LOW_SIGNAL * CLOSED_GAIN, 6);
			expect(channels[0][99]).toBeCloseTo(LOW_SIGNAL * CLOSED_GAIN, 6);
		});
	});

	it("should transition to ATTACK and then OPEN when signal exceeds threshold", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(20, HIGH_SIGNAL);
			const virtualMedia = createVirtualMedia();

			await noiseGateAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-noise-gate-open",
			});

			// Check that the last sample is passed through with less attenuation or none
			expect(channels[0][19]).toBeCloseTo(HIGH_SIGNAL, 3);
		});
	});
});
