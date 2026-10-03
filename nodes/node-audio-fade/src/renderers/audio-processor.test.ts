import type { VirtualMediaData } from "@gitframes/core";
import { ensureDevice } from "@gitframes/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { fadeAudioProcessor } from "./audio-processor.js";

const createVirtualMedia = (
	durationMs = 2000,
	overrides = {},
): VirtualMediaData =>
	({
		id: "test-fade-media",
		type: "audio",
		metadata: {
			durationMs,
			sampleRate: 44100,
			channels: 1,
		},
		operation: {
			fadeInDuration: 0.5,
			fadeOutDuration: 0.5,
			fadeInCurve: "linear",
			fadeOutCurve: "linear",
			...overrides,
		},
	}) as unknown as VirtualMediaData;

const createChannels = (
	numSamples: number,
	amplitude = 1.0,
): Float32Array[] => {
	const channel = new Float32Array(numSamples).fill(amplitude);
	return [channel];
};

describe("Fade Audio Processor", () => {
	const SAMPLE_RATE = 44100;

	const runWithDevice = async (fn: (device: GPUDevice) => Promise<void>) => {
		try {
			const device = await ensureDevice();
			await fn(device);
		} catch {
			console.warn("Skipping test due to missing WebGPU device");
		}
	};

	it("should apply linear fade in", async () => {
		await runWithDevice(async (device) => {
			// fadeInDuration = 0.5 seconds = 22050 samples at 44100
			const virtualMedia = createVirtualMedia(2000, {
				fadeInDuration: 0.5,
				fadeOutDuration: 0.0,
				fadeInCurve: "linear",
			});

			const channels = createChannels(22050); // exactly 0.5s of audio
			await fadeAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-fade-linear",
			});

			// First sample should be 0.0
			expect(channels[0][0]).toBeCloseTo(0.0, 5);

			// Halfway (0.25s) should be around 0.5
			expect(channels[0][11025]).toBeCloseTo(0.5, 3);

			// End of fade in (0.5s) should be exactly 1.0
			expect(channels[0][22049]).toBeCloseTo(1.0, 3);
		});
	});

	it("should apply exponential fade in", async () => {
		await runWithDevice(async (device) => {
			// Curve is p^2
			const virtualMedia = createVirtualMedia(2000, {
				fadeInDuration: 0.5,
				fadeOutDuration: 0.0,
				fadeInCurve: "exponential",
			});

			const channels = createChannels(22050);
			await fadeAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-fade-exponential",
			});

			// Halfway should be p^2 = 0.5^2 = 0.25
			expect(channels[0][11025]).toBeCloseTo(0.25, 3);
		});
	});

	it("should apply scurve fade in", async () => {
		await runWithDevice(async (device) => {
			// Curve is 3p^2 - 2p^3
			const virtualMedia = createVirtualMedia(2000, {
				fadeInDuration: 0.5,
				fadeOutDuration: 0.0,
				fadeInCurve: "scurve",
			});

			const channels = createChannels(22050);
			await fadeAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-fade-scurve",
			});

			// Halfway (p = 0.5) should be 3(0.25) - 2(0.125) = 0.75 - 0.25 = 0.5
			expect(channels[0][11025]).toBeCloseTo(0.5, 3);

			// One quarter (p = 0.25) should be 3(0.0625) - 2(0.015625) = 0.1875 - 0.03125 = 0.15625
			expect(channels[0][5512]).toBeCloseTo(0.15625, 3);
		});
	});

	it("should apply fade out to the end of the clip", async () => {
		await runWithDevice(async (device) => {
			// clip duration is 1.0 second = 44100 samples. fadeOutDuration = 0.5 seconds (starts at 0.5s, ends at 1.0s)
			const virtualMedia = createVirtualMedia(1000, {
				fadeInDuration: 0.0,
				fadeOutDuration: 0.5,
				fadeOutCurve: "linear",
			});

			const channels = createChannels(44100);
			await fadeAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-fade-out",
			});

			// First 22050 samples (first 0.5s) are outside of the fade out region, so should be unmodified (1.0)
			expect(channels[0][0]).toBe(1.0);
			expect(channels[0][22049]).toBe(1.0);

			// Halfway through the fade out (0.75s, index 33075) should be 0.5
			expect(channels[0][33075]).toBeCloseTo(0.5, 3);

			// Last sample (1.0s) should be 0.0
			expect(channels[0][44099]).toBeCloseTo(0.0, 3);
		});
	});

	it("should clamp fadeIn and fadeOut durations to midpoint if they overlap", async () => {
		await runWithDevice(async (device) => {
			// Duration is 1.0s. fadeIn = 0.8s, fadeOut = 0.8s.
			// Since 0.8 + 0.8 = 1.6 > 1.0, both should clamp to 0.5s.
			const virtualMedia = createVirtualMedia(1000, {
				fadeInDuration: 0.8,
				fadeOutDuration: 0.8,
				fadeInCurve: "linear",
				fadeOutCurve: "linear",
			});

			const channels = createChannels(44100);
			await fadeAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-fade-clamp",
			});

			// Fade in should finish exactly at 0.5s (index 22050)
			expect(channels[0][0]).toBeCloseTo(0.0, 5);
			expect(channels[0][11025]).toBeCloseTo(0.5, 3);
			expect(channels[0][22049]).toBeCloseTo(1.0, 3);

			// Fade out should start immediately at 0.5s (index 22050) and hit 0.5 at 0.75s (index 33075)
			expect(channels[0][33075]).toBeCloseTo(0.5, 3);
			expect(channels[0][44099]).toBeCloseTo(0.0, 3);
		});
	});

	it("should not apply fade in to a cut segment that starts after fadeInDuration (elapsedMs >= fadeInDuration)", async () => {
		await runWithDevice(async (device) => {
			// fadeInDuration = 0.5s. Cut segment starts at 1.0s (elapsedMs = 1000)
			const virtualMedia = createVirtualMedia(3000, {
				fadeInDuration: 0.5,
				fadeOutDuration: 0.0,
				fadeInCurve: "linear",
			});

			const channels = createChannels(22050); // 0.5s chunk
			await fadeAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-fade-cut-after",
				elapsedMs: 1000, // starts at 1.0s of original media (after 0.5s fade in)
			});

			// Samples should remain at 1.0 throughout (100% gain, no fade-in)
			expect(channels[0][0]).toBe(1.0);
			expect(channels[0][11025]).toBe(1.0);
			expect(channels[0][22049]).toBe(1.0);
		});
	});

	it("should evaluate partial fade in when cut segment starts inside fadeInDuration", async () => {
		await runWithDevice(async (device) => {
			// fadeInDuration = 1.0s. Cut segment starts at 0.5s (elapsedMs = 500)
			const virtualMedia = createVirtualMedia(3000, {
				fadeInDuration: 1.0,
				fadeOutDuration: 0.0,
				fadeInCurve: "linear",
			});

			const channels = createChannels(22050); // 0.5s chunk (from 0.5s to 1.0s of original media)
			await fadeAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-fade-cut-inside",
				elapsedMs: 500, // starts at 0.5s (halfway through 1.0s fade)
			});

			// First sample of chunk (0.5s mark of media) should start at gain = 0.5
			expect(channels[0][0]).toBeCloseTo(0.5, 3);

			// End sample of chunk (1.0s mark of media) should reach gain = 1.0
			expect(channels[0][22049]).toBeCloseTo(1.0, 3);
		});
	});

	it("should modulate fadeInDuration dynamically from a connected 1D Signal", async () => {
		await runWithDevice(async (device) => {
			const virtualMedia = createVirtualMedia(2000, {
				fadeInDuration: 0.0,
				fadeOutDuration: 0.0,
				fadeInDurationHandleId: "fade-sig-handle",
				inputs: {
					"fade-sig-handle": {
						connectionValid: true,
						outputItem: {
							type: "Signal",
							data: {
								type: "generator",
								nodeId: "dynamic-sig-1",
								offset: 0.5,
							},
						},
					},
				},
			});

			const channels = createChannels(22050); // 0.5s chunk
			await fadeAudioProcessor(channels, SAMPLE_RATE, virtualMedia, {
				device,
				frame: 0,
				fps: 24,
				renderId: "test-fade-signal-modulation",
			});

			// Modulated fadeInDuration should be 0.5s from the signal
			expect(channels[0][0]).toBeCloseTo(0.0, 5);
			expect(channels[0][11025]).toBeCloseTo(0.5, 3);
			expect(channels[0][22049]).toBeCloseTo(1.0, 3);
		});
	});
});
