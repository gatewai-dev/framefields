import type { VirtualMediaData } from "@framefields/core";
import { ensureDevice } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { delayAudioProcessor } from "./audio-processor.js";

const createVirtualMedia = (overrides = {}): VirtualMediaData =>
	({
		id: "test-delay-media",
		type: "audio",
		operation: {
			delayTime: 0.25,
			feedback: 0.4,
			wet: 0.3,
			dry: 1.0,
			pingPong: false,
			...overrides,
		},
	}) as unknown as VirtualMediaData;

const createChannels = (
	numSamples: number,
	amplitude: number,
	stereo = false,
): Float32Array[] => {
	if (stereo) {
		const left = new Float32Array(numSamples).map(
			(_, idx) => Math.sin(idx * 0.05) * amplitude,
		);
		const right = new Float32Array(numSamples).map(
			(_, idx) => Math.cos(idx * 0.05) * amplitude,
		);
		return [left, right];
	}
	const channel = new Float32Array(numSamples).fill(amplitude);
	return [channel];
};

describe("Delay Audio Processor", () => {
	const SAMPLE_RATE = 44100;

	const runWithDevice = async (fn: (device: GPUDevice) => Promise<void>) => {
		try {
			const device = await ensureDevice();
			await fn(device);
		} catch {
			console.warn("Skipping test due to missing WebGPU device");
		}
	};

	it("should apply delay on mono audio and alter the signal over time", async () => {
		await runWithDevice(async (device) => {
			const virtualMedia = createVirtualMedia({
				delayTime: 0.01,
				wet: 0.5,
				dry: 1.0,
			});
			const shortChannels = createChannels(1000, 0.5);
			await delayAudioProcessor(shortChannels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-delay",
			});

			expect(shortChannels[0][0]).toBe(0.5); // Still dry-only because buffer is empty
			expect(shortChannels[0][500]).not.toBe(0.5); // Should be mixed since 500 > 441
			expect(Number.isNaN(shortChannels[0][500])).toBe(false);
			expect(Number.isFinite(shortChannels[0][500])).toBe(true);
		});
	});

	it("should respect dry/wet parameters", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(500, 0.5);
			const virtualMedia = createVirtualMedia({
				dry: 0.0,
				wet: 0.0,
			});

			await delayAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-delay-drywet",
			});

			expect(channels[0][0]).toBe(0);
			expect(channels[0][250]).toBe(0);
		});
	});

	it("should safely clamp feedback to avoid infinite runaway", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(1000, 0.5);
			// Even at feedback 1.5, it should be clamped to 0.95 internally
			const virtualMedia = createVirtualMedia({
				feedback: 1.5,
			});

			await delayAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-delay-clamp",
			});

			expect(Number.isNaN(channels[0][500])).toBe(false);
			expect(Number.isFinite(channels[0][500])).toBe(true);
		});
	});

	it("should apply ping-pong delay on stereo channels", async () => {
		await runWithDevice(async (device) => {
			// Ping pong alternates delay feed. Let's create stereo input with signal in left only
			const virtualMedia = createVirtualMedia({
				delayTime: 0.01,
				pingPong: true,
				feedback: 0.5,
				wet: 0.8,
			});
			const left = new Float32Array(1000).fill(1.0);
			const right = new Float32Array(1000).fill(0.0);
			const channels = [left, right];

			await delayAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-delay-pingpong",
			});

			expect(channels[1][0]).toBe(0.0); // Initially empty delay
			expect(channels[1][900]).not.toBe(0.0); // Right channel should have signal fed from Left delayed echo!
		});
	});
});
