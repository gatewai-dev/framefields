import type { VirtualMediaData } from "@framefields/core";
import { ensureDevice } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { stereoPanningAudioProcessor } from "./audio-processor.js";

const createVirtualMedia = (overrides = {}): VirtualMediaData =>
	({
		id: "test-panning-media",
		type: "audio",
		operation: {
			pan: 0.0,
			...overrides,
		},
	}) as unknown as VirtualMediaData;

const createChannels = (
	numSamples: number,
	amplitude: number,
	stereo = false,
): Float32Array[] => {
	if (stereo) {
		const left = new Float32Array(numSamples).fill(amplitude);
		const right = new Float32Array(numSamples).fill(amplitude);
		return [left, right];
	}
	const channel = new Float32Array(numSamples).fill(amplitude);
	return [channel];
};

describe("Stereo Panning Audio Processor", () => {
	const SAMPLE_RATE = 44100;

	const runWithDevice = async (fn: (device: GPUDevice) => Promise<void>) => {
		try {
			const device = await ensureDevice();
			await fn(device);
		} catch {
			console.warn("Skipping test due to missing WebGPU device");
		}
	};

	it("should keep audio unchanged when pan is centered", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(100, 0.5, true);
			const virtualMedia = createVirtualMedia({ pan: 0.0 });

			await stereoPanningAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-panning-center",
			});

			expect(channels[0][0]).toBeCloseTo(0.5, 5);
			expect(channels[1][0]).toBeCloseTo(0.5, 5);
		});
	});

	it("should reduce right channel volume when panning to the left", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(100, 0.5, true);
			const virtualMedia = createVirtualMedia({ pan: -0.5 });

			await stereoPanningAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-panning-left",
			});

			// Left gain should be 1.0 (amplitude = 0.5)
			expect(channels[0][0]).toBeCloseTo(0.5, 5);
			// Right gain should be 1.0 + (-0.5) = 0.5 (amplitude = 0.25)
			expect(channels[1][0]).toBeCloseTo(0.25, 5);
		});
	});

	it("should silence left channel when panning fully to the right", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(100, 0.5, true);
			const virtualMedia = createVirtualMedia({ pan: 1.0 });

			await stereoPanningAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-panning-full-right",
			});

			// Left gain should be 1.0 - 1.0 = 0.0 (amplitude = 0.0)
			expect(channels[0][0]).toBeCloseTo(0.0, 5);
			// Right gain should be 1.0 (amplitude = 0.5)
			expect(channels[1][0]).toBeCloseTo(0.5, 5);
		});
	});

	it("should reduce left channel volume for mono audio when panning to the right", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(100, 0.5, false);
			const virtualMedia = createVirtualMedia({ pan: 0.5 });

			await stereoPanningAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-panning-mono-right",
			});

			// Left gain should be 1.0 - 0.5 = 0.5 (amplitude = 0.25)
			expect(channels[0][0]).toBeCloseTo(0.25, 5);
			// Right gain should be 1.0 (amplitude = 0.5)
			expect(channels[1][0]).toBeCloseTo(0.5, 5);
		});
	});

	it("should dynamically modulate panning from left to right when pan is driven by a signal", async () => {
		await runWithDevice(async (device) => {
			const numSamples = 200;
			const channels = createChannels(numSamples, 0.5, true);

			// Signal sweeping pan from -1.0 (full left) to +1.0 (full right)
			const panSignal = {
				value: -1.0,
				peek: () => -1.0,
				get: (ctx?: { progress?: number }) => {
					const p = ctx?.progress ?? 0;
					return -1.0 + 2.0 * p;
				},
			};

			const virtualMedia = createVirtualMedia({ pan: panSignal });

			await stereoPanningAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-panning-signal-sweep",
			});

			// At start (sample 0): pan ~ -1.0 -> Left gain = 1.0 (0.5), Right gain = 0.0 (0.0)
			expect(channels[0][0]).toBeCloseTo(0.5, 4);
			expect(channels[1][0]).toBeCloseTo(0.0, 4);

			// At end (sample numSamples - 1): pan ~ +1.0 -> Left gain = 0.0 (0.0), Right gain = 1.0 (0.5)
			expect(channels[0][numSamples - 1]).toBeCloseTo(0.0, 4);
			expect(channels[1][numSamples - 1]).toBeCloseTo(0.5, 4);
		});
	});
});
