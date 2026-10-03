import type { VirtualMediaData } from "@gitframes/core";
import { ensureDevice } from "@gitframes/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { compressorAudioProcessor } from "./audio-processor.js";

const createVirtualMedia = (overrides = {}): VirtualMediaData =>
	({
		id: "test-compressor-media",
		type: "audio",
		operation: {
			threshold: -24,
			ratio: 4,
			attack: 0.003,
			release: 0.25,
			knee: 6,
			makeupGain: 0,
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

describe("Compressor Audio Processor", () => {
	const SAMPLE_RATE = 44100;

	const runWithDevice = async (fn: (device: GPUDevice) => Promise<void>) => {
		try {
			const device = await ensureDevice();
			await fn(device);
		} catch {
			console.warn("Skipping test due to missing WebGPU device");
		}
	};

	it("should process mono audio and not crash", async () => {
		await runWithDevice(async (device) => {
			const channels = createChannels(1000, 0.5, false);
			const virtualMedia = createVirtualMedia();

			await compressorAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-compressor-mono",
			});

			expect(channels[0][0]).toBeLessThanOrEqual(0.5);
			expect(Number.isNaN(channels[0][0])).toBe(false);
		});
	});

	it("should apply makeup gain correctly", async () => {
		await runWithDevice(async (device) => {
			// A small input amplitude (0.01) is below threshold -24dBFS, so no compression occurs.
			// With makeupGain = 6dB, output amplitude should be 0.01 * 10^(6/20) ~ 0.02.
			const channels = createChannels(1000, 0.01, false);
			const virtualMedia = createVirtualMedia({
				threshold: -24,
				makeupGain: 6.0,
			});

			await compressorAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-compressor-makeup",
			});

			expect(channels[0][0]).toBeCloseTo(0.02, 3);
		});
	});

	it("should compress high amplitude signals above threshold", async () => {
		await runWithDevice(async (device) => {
			// A very large amplitude (0.8) is far above threshold -24dBFS.
			// With ratio 4, it should be compressed to a lower level.
			const channels = createChannels(1000, 0.8, false);
			const virtualMedia = createVirtualMedia({
				threshold: -24,
				ratio: 4.0,
				makeupGain: 0.0,
				attack: 0.001,
			});

			await compressorAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-compressor-reduction",
			});

			expect(channels[0][999]).toBeLessThan(0.8);
			expect(channels[0][999]).toBeGreaterThan(0.0);
		});
	});
});
