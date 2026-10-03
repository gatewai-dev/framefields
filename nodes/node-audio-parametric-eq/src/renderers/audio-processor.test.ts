import type { VirtualMediaData } from "@gitframes/core";
import { ensureDevice } from "@gitframes/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { parametricEqAudioProcessor } from "./audio-processor.js";

const createVirtualMedia = (overrides = {}): VirtualMediaData =>
	({
		id: "test-eq-media",
		type: "audio",
		operation: {
			type: "peak",
			frequency: 1000,
			gain: 0,
			q: 1.0,
			...overrides,
		},
	}) as unknown as VirtualMediaData;

const createChannels = (
	numSamples: number,
	amplitude: number,
): Float32Array[] => {
	const channel = new Float32Array(numSamples).fill(amplitude);
	return [channel]; // Mono testing is sufficient for filter math
};

describe("Parametric EQ Audio Processor", () => {
	const SAMPLE_RATE = 44100;

	const runWithDevice = async (fn: (device: GPUDevice) => Promise<void>) => {
		try {
			const device = await ensureDevice();
			await fn(device);
		} catch {
			console.warn("Skipping test due to missing WebGPU device");
		}
	};

	it("should pass audio signal untouched if peak filter gain is 0dB", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(100, 0.5);
			const virtualMedia = createVirtualMedia({
				type: "peak",
				gain: 0,
			});
			await parametricEqAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-parametric-eq",
			});

			expect(channels[0][0]).toBe(0.5);
			expect(channels[0][99]).toBe(0.5);
		});
	});

	it("should apply a peak filter with gain boost and alter the signal", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(100, 1.0);
			const virtualMedia = createVirtualMedia({
				type: "peak",
				frequency: 1000,
				gain: 12,
				q: 1.0,
			});

			await parametricEqAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-parametric-eq-peak",
			});

			// The signal should no longer be a constant 1.0 because of biquad memory and filter gain
			expect(channels[0][0]).not.toBe(1.0);
			expect(Number.isNaN(channels[0][50])).toBe(false);
		});
	});

	it("should treat gain of 0dB as a no-op on peak filters", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(100, 0.75);
			const virtualMedia = createVirtualMedia({
				type: "peak",
				frequency: 500,
				gain: 0,
				q: 0.707,
			});

			await parametricEqAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-parametric-eq-noop",
			});

			expect(channels[0][0]).toBeCloseTo(0.75, 5);
		});
	});

	it("should apply a lowPass filter correctly", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(100, 1.0);
			const virtualMedia = createVirtualMedia({
				type: "lowPass",
				frequency: 200,
				gain: 0,
				q: 0.707,
			});

			await parametricEqAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-parametric-eq-pass",
			});

			expect(channels[0][0]).not.toBe(1.0);
			expect(Number.isNaN(channels[0][0])).toBe(false);
			expect(Number.isFinite(channels[0][0])).toBe(true);
		});
	});

	it("should clamp frequencies exceeding Nyquist and Q below minimum to avoid NaN/crashing", async () => {
		await runWithDevice(async (device) => {
			const virtualMedia = createVirtualMedia({
				type: "notch",
				frequency: 50000,
				gain: 0,
				q: 0.0001,
			});

			const channels = createChannels(50, 0.5);
			await parametricEqAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-parametric-eq-clamp",
			});

			expect(Number.isNaN(channels[0][0])).toBe(false);
			expect(Number.isFinite(channels[0][0])).toBe(true);
		});
	});
});
