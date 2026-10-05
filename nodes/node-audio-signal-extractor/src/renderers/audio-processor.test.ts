import type { VirtualMediaData } from "@framefields/core";
import {
	AudioSignalComputePipeline,
	shaderStore,
	signalRegistry,
} from "@framefields/webgpu-renderers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { audioSignalExtractorAudioProcessor } from "./audio-processor.js";

describe("audioSignalExtractorAudioProcessor", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("extracts audio features via WebGPU and registers them in signalRegistry and shaderStore", async () => {
		const mockDevice = {} as GPUDevice;
		const mockPrimaryBuffer = {} as GPUBuffer;
		const mockBeatBuffer = {} as GPUBuffer;
		const mockBassBuffer = {} as GPUBuffer;
		const mockEnergyBuffer = {} as GPUBuffer;
		const mockTexture = {} as GPUTexture;
		const mockTextureView = {} as GPUTextureView;

		vi.spyOn(AudioSignalComputePipeline, "extractFeatures").mockResolvedValue({
			primaryBuffer: mockPrimaryBuffer,
			beatBuffer: mockBeatBuffer,
			bassBuffer: mockBassBuffer,
			energyBuffer: mockEnergyBuffer,
			texture: mockTexture,
			textureView: mockTextureView,
			numFrames: 100,
			durationSec: 4.16,
		});

		const registerBufferSpy = vi.spyOn(signalRegistry, "registerBuffer");
		const registerTextureSpy = vi.spyOn(signalRegistry, "registerTexture");
		const shaderStoreSpy = vi.spyOn(shaderStore, "register");

		const mockVM: VirtualMediaData = {
			metadata: { durationMs: 4160, fps: 24 },
			operation: {
				op: "AudioSignalExtractor",
				nodeId: "my-extractor-node",
				extractionMode: "rms_envelope",
			},
			children: [],
		};

		const channels = [new Float32Array(48000)];
		await audioSignalExtractorAudioProcessor(channels, 48000, mockVM, {
			device: mockDevice,
			frame: 0,
			fps: 24,
			renderId: "test-render",
		});

		expect(AudioSignalComputePipeline.extractFeatures).toHaveBeenCalledWith(
			mockDevice,
			channels,
			48000,
			24,
			expect.objectContaining({ extractionMode: "rms_envelope" }),
			512,
		);

		// Verified 4 channel buffer registrations
		expect(registerBufferSpy).toHaveBeenCalledWith(
			mockDevice,
			"my-extractor-node",
			mockPrimaryBuffer,
			"test-render",
		);
		expect(registerBufferSpy).toHaveBeenCalledWith(
			mockDevice,
			"my-extractor-node_beat",
			mockBeatBuffer,
			"test-render",
		);

		// Verified texture registration
		expect(registerTextureSpy).toHaveBeenCalledWith(
			mockDevice,
			"my-extractor-node",
			mockTexture,
			mockTextureView,
			"test-render",
		);

		// Verified shaderStore registration
		expect(shaderStoreSpy).toHaveBeenCalledWith(
			"my-extractor-node",
			expect.objectContaining({
				name: "signal_my_extractor_node",
				outputType: "f32",
			}),
			"test-render",
		);
	});
});
