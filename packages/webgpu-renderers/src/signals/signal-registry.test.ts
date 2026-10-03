import { describe, expect, it, vi } from "vitest";

// Polyfill WebGPU globals for the test runner environment
if (typeof globalThis.GPUBufferUsage === "undefined") {
	globalThis.GPUBufferUsage = {
		MAP_READ: 1,
		MAP_WRITE: 2,
		COPY_SRC: 4,
		COPY_DST: 8,
		INDEX: 16,
		VERTEX: 32,
		UNIFORM: 64,
		STORAGE: 128,
		INDIRECT: 256,
		QUERY_RESOLVE: 512,
	} as unknown as typeof GPUBufferUsage;
}

if (typeof globalThis.GPUTextureUsage === "undefined") {
	globalThis.GPUTextureUsage = {
		COPY_SRC: 1,
		COPY_DST: 2,
		TEXTURE_BINDING: 4,
		STORAGE_BINDING: 8,
		RENDER_ATTACHMENT: 16,
	} as unknown as typeof GPUTextureUsage;
}

import { SignalRegistry } from "./signal-registry.js";

describe("SignalRegistry", () => {
	it("should allocate, cache, and reuse 1D buffers", () => {
		const registry = new SignalRegistry();

		const mockBuffer = {
			destroy: vi.fn(),
		} as unknown as GPUBuffer;

		const mockDevice = {
			createBuffer: vi.fn().mockReturnValue(mockBuffer),
			queue: {
				writeBuffer: vi.fn(),
			},
		} as unknown as GPUDevice;

		const mockEncoder = {} as unknown as GPUCommandEncoder;

		const nodeId = "test-signal-node";
		const frame = 0;
		const fps = 24;
		const signalData = { type: "generator", offset: 1.5 };
		const numSamples = 128;
		const sampleRate = 48000;
		const renderId = "render-abc";

		// 1. Initial creation
		const buffer1 = registry.getOrCreate1DBuffer(
			mockDevice,
			mockEncoder,
			nodeId,
			frame / fps,
			0,
			signalData,
			numSamples,
			sampleRate,
			renderId,
			frame,
			fps,
		);

		expect(mockDevice.createBuffer).toHaveBeenCalledTimes(1);
		expect(mockDevice.queue.writeBuffer).toHaveBeenCalledTimes(1);
		expect(buffer1).toBe(mockBuffer);

		// 2. Querying on same frame -> should return cached buffer without rewriting
		const buffer2 = registry.getOrCreate1DBuffer(
			mockDevice,
			mockEncoder,
			nodeId,
			frame / fps,
			0,
			signalData,
			numSamples,
			sampleRate,
			renderId,
			frame,
			fps,
		);

		expect(mockDevice.createBuffer).toHaveBeenCalledTimes(1);
		expect(mockDevice.queue.writeBuffer).toHaveBeenCalledTimes(1);
		expect(buffer2).toBe(mockBuffer);

		// 3. Querying on a new frame -> should rewrite buffer but not recreate it
		const buffer3 = registry.getOrCreate1DBuffer(
			mockDevice,
			mockEncoder,
			nodeId,
			(frame + 1) / fps,
			0,
			signalData,
			numSamples,
			sampleRate,
			renderId,
			frame + 1,
			fps,
		);

		expect(mockDevice.createBuffer).toHaveBeenCalledTimes(1);
		expect(mockDevice.queue.writeBuffer).toHaveBeenCalledTimes(2);
		expect(buffer3).toBe(mockBuffer);
	});

	it("should allocate, cache, and reuse 2D textures", () => {
		const registry = new SignalRegistry();

		const mockTextureView = {} as unknown as GPUTextureView;
		const mockTexture = {
			width: 16,
			height: 1,
			createView: vi.fn().mockReturnValue(mockTextureView),
			destroy: vi.fn(),
		} as any;

		const mockDevice = {
			createTexture: vi.fn().mockImplementation((desc) => {
				mockTexture.width = desc.size[0];
				mockTexture.height = desc.size[1] ?? 1;
				return mockTexture as unknown as GPUTexture;
			}),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
			},
		} as unknown as GPUDevice;

		const mockEncoder = {} as unknown as GPUCommandEncoder;

		const nodeId = "test-signal-2d";
		const frame = 0;
		const fps = 24;
		const signalData = { type: "generator", offset: 0.5 };
		const width = 16;
		const height = 16;
		const renderId = "render-123";

		// 1. Initial creation
		const view1 = registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			nodeId,
			frame / fps,
			0,
			signalData,
			width,
			height,
			renderId,
			frame,
			fps,
		);

		expect(mockDevice.createTexture).toHaveBeenCalledTimes(1);
		expect(mockTexture.createView).toHaveBeenCalledTimes(1);
		expect(mockDevice.queue.writeTexture).toHaveBeenCalledTimes(1);
		expect(view1).toBe(mockTextureView);

		// 2. Querying on same frame -> should return cached view without rewriting
		const view2 = registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			nodeId,
			frame / fps,
			0,
			signalData,
			width,
			height,
			renderId,
			frame,
			fps,
		);

		expect(mockDevice.createTexture).toHaveBeenCalledTimes(1);
		expect(mockDevice.queue.writeTexture).toHaveBeenCalledTimes(1);
		expect(view2).toBe(mockTextureView);

		// 3. Querying on a new frame -> should rewrite texture but not recreate it
		const view3 = registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			nodeId,
			(frame + 1) / fps,
			0,
			signalData,
			width,
			height,
			renderId,
			frame + 1,
			fps,
		);

		expect(mockDevice.createTexture).toHaveBeenCalledTimes(1);
		expect(mockDevice.queue.writeTexture).toHaveBeenCalledTimes(2);
		expect(view3).toBe(mockTextureView);
	});

	it("should clear cached resources on clear() with renderId", () => {
		const registry = new SignalRegistry();

		const mockBuffer = {
			destroy: vi.fn(),
		} as unknown as GPUBuffer;
		const mockTexture = {
			destroy: vi.fn(),
		} as unknown as GPUTexture;

		const mockDevice = {
			createBuffer: vi.fn().mockReturnValue(mockBuffer),
			createTexture: vi.fn().mockReturnValue(mockTexture),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
			},
		} as unknown as GPUDevice;

		const mockEncoder = {} as unknown as GPUCommandEncoder;

		// Create 1D buffer under renderId 'render-1'
		registry.getOrCreate1DBuffer(
			mockDevice,
			mockEncoder,
			"node-1",
			0,
			0,
			{ type: "generator", offset: 1.0 },
			64,
			48000,
			"render-1",
			0,
			24,
		);

		// Create 2D texture under renderId 'render-1'
		const mockTextureView = {} as unknown as GPUTextureView;
		mockTexture.createView = vi.fn().mockReturnValue(mockTextureView);
		registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			"node-2",
			0,
			0,
			{ type: "generator", offset: 0.5 },
			8,
			8,
			"render-1",
			0,
			24,
		);

		// Clear render-1
		registry.clear("render-1", mockDevice);

		expect(mockBuffer.destroy).toHaveBeenCalledTimes(1);
		expect(mockTexture.destroy).toHaveBeenCalledTimes(1);
	});

	it("should recursively discover and extract audio sources in ensureAudioSourcesExtracted", async () => {
		const registry = new SignalRegistry();
		const mockDevice = {
			queue: { onSubmittedWorkDone: vi.fn().mockResolvedValue(undefined) },
		} as unknown as GPUDevice;

		const extractSpy = vi
			.spyOn(registry, "extractFromAudioSource")
			.mockResolvedValue(undefined);

		const nestedTree = {
			type: "signal_math",
			operation: "add",
			signalA: {
				type: "signal_math",
				operation: "multiply",
				signalA: {
					nodeId: "extractor-beat",
					sourceUrl: "http://example.com/song.mp3",
					extractionMode: "transient_beat",
				},
				signalB: 2.5,
			},
			signalB: {
				nodeId: "extractor-bass",
				sourceUrl: "http://example.com/song.mp3",
				extractionMode: "bass",
			},
		};

		await registry.ensureAudioSourcesExtracted(
			mockDevice,
			nestedTree,
			30,
			"render-test",
		);

		expect(extractSpy).toHaveBeenCalledTimes(2);
		expect(extractSpy).toHaveBeenCalledWith(
			mockDevice,
			"http://example.com/song.mp3",
			expect.objectContaining({ extractionMode: "transient_beat" }),
			"extractor-beat",
			30,
			"render-test",
		);
		expect(extractSpy).toHaveBeenCalledWith(
			mockDevice,
			"http://example.com/song.mp3",
			expect.objectContaining({ extractionMode: "bass" }),
			"extractor-bass",
			30,
			"render-test",
		);
	});

	it("should evaluate masterAudio via 2D render pass when present", () => {
		const registry = new SignalRegistry();

		const mockTexture = {
			width: 128,
			height: 1,
			destroy: vi.fn(),
			createView: vi.fn().mockReturnValue({}),
		} as unknown as GPUTexture;

		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			draw: vi.fn(),
			end: vi.fn(),
		};

		const mockEncoder = {
			beginRenderPass: vi.fn().mockReturnValue(mockPass),
			finish: vi.fn().mockReturnValue({}),
		} as unknown as GPUCommandEncoder;

		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		};

		const mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue({ size: 64, destroy: vi.fn() }),
			createBindGroup: vi.fn().mockReturnValue({}),
			createShaderModule: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
			createSampler: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
				submit: vi.fn(),
				onSubmittedWorkDone: vi.fn().mockResolvedValue(undefined),
			},
		} as unknown as GPUDevice;

		// Mock master audio registration
		const masterTex = {
			width: 512,
			height: 1,
			createView: vi.fn().mockReturnValue({}),
		} as unknown as GPUTexture;

		// Access device resources map to register master audio
		const dr = (
			registry as unknown as {
				getDeviceResources: (d: GPUDevice) => {
					masterAudioTextures: Map<string, unknown>;
				};
			}
		).getDeviceResources(mockDevice);
		dr.masterAudioTextures.set("render-audio:audio-ext-1", {
			texture: masterTex,
			textureView: masterTex.createView(),
			durationSec: 10,
			stats: { min: 0, max: 1 },
		});

		// Query 2D view for audio-ext-1 with null encoder -> should create and submit internal encoder
		const view = registry.getOrCreate2DTextureView(
			mockDevice,
			null,
			"audio-ext-1",
			1.5,
			10,
			{ extractionMode: "rms_envelope" },
			128,
			1,
			"render-audio",
			36,
			24,
		);

		expect(view).toBeDefined();
		expect(mockDevice.createCommandEncoder).toHaveBeenCalled();
		expect(mockEncoder.beginRenderPass).toHaveBeenCalled();
		expect(mockPass.setPipeline).toHaveBeenCalled();
		expect(mockPass.draw).toHaveBeenCalledWith(4);
		expect(mockDevice.queue.submit).toHaveBeenCalled();
	});

	it("creates dummy 1x1 texture with rgba16float format", () => {
		const registry = new SignalRegistry();
		const mockTexture = {
			createView: vi.fn().mockReturnValue({}),
		} as unknown as GPUTexture;
		const mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			queue: {
				writeTexture: vi.fn(),
			},
		} as unknown as GPUDevice;

		const dummyView = registry.getDummy1x1TextureView(mockDevice);
		expect(dummyView).toBeDefined();
		expect(mockDevice.createTexture).toHaveBeenCalledWith(
			expect.objectContaining({
				size: [1, 1, 1],
				format: "rgba16float",
			}),
		);
		expect(mockDevice.queue.writeTexture).toHaveBeenCalledWith(
			expect.objectContaining({ texture: mockTexture }),
			expect.any(Uint16Array),
			expect.objectContaining({ bytesPerRow: 8, rowsPerImage: 1 }),
			[1, 1, 1],
		);
	});

	it("caches and retrieves channel samples via setChannelSamples and getChannelSamples", () => {
		const registry = new SignalRegistry();
		const primary = new Float32Array([0.1, 0.2, 0.3]);
		const beat = new Float32Array([0.0, 1.0, 0.0]);
		const bass = new Float32Array([0.5, 0.6, 0.7]);
		const energy = new Float32Array([0.9, 0.8, 0.7]);

		registry.setChannelSamples("test-node-audio", {
			primary,
			beat,
			bass,
			energy,
		});

		expect(registry.getChannelSamples("test-node-audio", "primary")).toBe(
			primary,
		);
		expect(registry.getChannelSamples("test-node-audio", "beat")).toBe(beat);
		expect(registry.getChannelSamples("test-node-audio", "bass")).toBe(bass);
		expect(registry.getChannelSamples("test-node-audio", "energy")).toBe(
			energy,
		);
		expect(registry.getChannelSamples("test-node-audio", "unknown")).toBe(
			primary,
		);
		expect(
			registry.getChannelSamples("non-existent-node", "primary"),
		).toBeUndefined();
	});

	it("dispatches WebGPU compute shader for audio_extractor 1D buffer when masterTex exists", () => {
		const registry = new SignalRegistry();

		const mockComputePass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			dispatchWorkgroups: vi.fn(),
			end: vi.fn(),
		};

		const mockEncoder = {
			beginComputePass: vi.fn().mockReturnValue(mockComputePass),
			finish: vi.fn().mockReturnValue({}),
		} as unknown as GPUCommandEncoder;

		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		};

		const mockDevice = {
			createBuffer: vi.fn().mockImplementation((desc) => ({
				size: desc.size,
				destroy: vi.fn(),
			})),
			createShaderModule: vi.fn().mockReturnValue({}),
			createComputePipeline: vi.fn().mockReturnValue(mockPipeline),
			createSampler: vi.fn().mockReturnValue({}),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		const masterTex = {
			width: 512,
			height: 1,
			createView: vi.fn().mockReturnValue({}),
		} as unknown as GPUTexture;

		// Register master audio texture
		const dr = (
			registry as unknown as {
				getDeviceResources: (d: GPUDevice) => {
					masterAudioTextures: Map<string, unknown>;
				};
			}
		).getDeviceResources(mockDevice);
		dr.masterAudioTextures.set("render-audio-1d:audio-ext-node", {
			texture: masterTex,
			textureView: masterTex.createView(),
			durationSec: 10,
			stats: { min: 0, max: 1 },
		});

		// 1. Primary / default channel with null encoder
		const buf = registry.getOrCreate1DBuffer(
			mockDevice,
			null,
			"audio-ext-node",
			0.5,
			10,
			{ type: "audio_extractor", channel: "bass" },
			128,
			48000,
			"render-audio-1d",
			12,
			24,
		);

		expect(buf).toBeDefined();
		expect(mockDevice.createCommandEncoder).toHaveBeenCalledWith(
			expect.objectContaining({
				label: "signal_1d_audio_encoder_audio-ext-node",
			}),
		);
		expect(mockEncoder.beginComputePass).toHaveBeenCalledWith(
			expect.objectContaining({ label: "audio_1d_compute_pass" }),
		);
		expect(mockComputePass.setPipeline).toHaveBeenCalledWith(mockPipeline);
		expect(mockComputePass.dispatchWorkgroups).toHaveBeenCalledWith(
			Math.ceil(128 / 64),
		);
		expect(mockComputePass.end).toHaveBeenCalled();
		expect(mockDevice.queue.submit).toHaveBeenCalled();
	});

	it("resamples samples array with timebase when signalData.samples is present", () => {
		const registry = new SignalRegistry();
		const mockDevice = {
			createBuffer: vi.fn().mockReturnValue({ size: 256, destroy: vi.fn() }),
			queue: {
				writeBuffer: vi.fn(),
			},
		} as unknown as GPUDevice;

		const samples = [0.1, 0.2, 0.5, 0.8, 1.0];
		registry.getOrCreate1DBuffer(
			mockDevice,
			null,
			"array-signal",
			0.0,
			1.0,
			{ samples, fps: 24 },
			64,
			48000,
		);

		expect(mockDevice.queue.writeBuffer).toHaveBeenCalledTimes(1);
	});

	it("dispatches WebGPU compute shader for signal_math 1D operations", () => {
		const registry = new SignalRegistry();

		const mockComputePass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			dispatchWorkgroups: vi.fn(),
			end: vi.fn(),
		};
		const mockEncoder = {
			beginComputePass: vi.fn().mockReturnValue(mockComputePass),
			finish: vi.fn().mockReturnValue({}),
		};
		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		};
		const mockDevice = {
			createBuffer: vi.fn().mockReturnValue({ size: 256, destroy: vi.fn() }),
			createShaderModule: vi.fn().mockReturnValue({}),
			createComputePipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		const mathSignal = {
			type: "signal_math",
			operation: "add",
			signalA: { type: "generator", offset: 1.0 },
			signalB: 2.0,
		};

		const buf = registry.getOrCreate1DBuffer(
			mockDevice,
			null,
			"math-node",
			0.0,
			1.0,
			mathSignal,
			64,
			48000,
			"render-math",
			0,
			24,
		);

		expect(buf).toBeDefined();
		expect(mockDevice.createCommandEncoder).toHaveBeenCalledWith(
			expect.objectContaining({ label: "signal_1d_math_encoder_math-node" }),
		);
		expect(mockEncoder.beginComputePass).toHaveBeenCalledWith(
			expect.objectContaining({ label: "math_1d_compute_pass" }),
		);
		expect(mockComputePass.setPipeline).toHaveBeenCalledWith(mockPipeline);
		expect(mockComputePass.dispatchWorkgroups).toHaveBeenCalledWith(
			Math.ceil(64 / 64),
		);
		expect(mockComputePass.end).toHaveBeenCalled();
		expect(mockDevice.queue.submit).toHaveBeenCalled();
	});

	it("creates an independent command encoder and submits it to avoid locking caller's active render pass", () => {
		const registry = new SignalRegistry();
		const mockEncoder = {
			beginComputePass: vi.fn().mockReturnValue({
				setPipeline: vi.fn(),
				setBindGroup: vi.fn(),
				dispatchWorkgroups: vi.fn(),
				end: vi.fn(),
			}),
			finish: vi.fn().mockReturnValue({}),
		};
		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		};
		const mockDevice = {
			createBuffer: vi.fn().mockReturnValue({ size: 256, destroy: vi.fn() }),
			createShaderModule: vi.fn().mockReturnValue({}),
			createComputePipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		const mathSignal = {
			type: "signal_math",
			operation: "add",
			signalA: { type: "generator", offset: 1.0 },
			signalB: 2.0,
		};

		const callerEncoder = {} as GPUCommandEncoder;

		const buf = registry.getOrCreate1DBuffer(
			mockDevice,
			callerEncoder,
			"math-node-caller",
			0.0,
			1.0,
			mathSignal,
			64,
			48000,
			"render-math-caller",
			0,
			24,
		);

		expect(buf).toBeDefined();
		expect(mockDevice.createCommandEncoder).toHaveBeenCalled();
		expect(mockDevice.queue.submit).toHaveBeenCalled();
	});

	it("renders 2D texture view and registers stats for SignalGate", () => {
		const registry = new SignalRegistry();
		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			draw: vi.fn(),
			end: vi.fn(),
		};
		const mockEncoder = {
			beginRenderPass: vi.fn().mockReturnValue(mockPass),
			finish: vi.fn().mockReturnValue({}),
		};
		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		};
		const mockTexture = {
			createView: vi.fn().mockReturnValue({}),
			destroy: vi.fn(),
		};
		const mockDevice = {
			createBuffer: vi.fn().mockReturnValue({ size: 256, destroy: vi.fn() }),
			createShaderModule: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createSampler: vi.fn().mockReturnValue({}),
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		const gateSignal = {
			type: "gate",
			mode: "gate",
			threshold: 0.5,
			invert: false,
			sourceSignal: { type: "generator", offset: 0.8 },
		};

		const callerEncoder = {} as GPUCommandEncoder;

		const view = registry.getOrCreate2DTextureView(
			mockDevice,
			callerEncoder,
			"gate-node-1",
			0.0,
			1.0,
			gateSignal,
			128,
			1,
			"render-gate",
			0,
			24,
		);

		expect(view).toBeDefined();
		expect(mockDevice.createCommandEncoder).toHaveBeenCalled();
		expect(mockEncoder.beginRenderPass).toHaveBeenCalled();
		expect(mockPass.draw).toHaveBeenCalledWith(4);
		expect(mockDevice.queue.submit).toHaveBeenCalled();
		expect(registry.getStats("gate-node-1")).toEqual({ min: 0.0, max: 1.0 });
	});

	it("dispatches 1D buffer compute pass for SignalGate", () => {
		const registry = new SignalRegistry();
		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			dispatchWorkgroups: vi.fn(),
			end: vi.fn(),
		};
		const mockEncoder = {
			beginComputePass: vi.fn().mockReturnValue(mockPass),
			finish: vi.fn().mockReturnValue({}),
		};
		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		};
		const mockDevice = {
			createBuffer: vi.fn().mockReturnValue({ size: 256, destroy: vi.fn() }),
			createShaderModule: vi.fn().mockReturnValue({}),
			createComputePipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		const gateSignal = {
			type: "gate",
			mode: "trigger",
			threshold: 0.5,
			holdFrames: 4,
			sourceSignal: { type: "generator", offset: 0.7 },
		};

		const callerEncoder = {} as GPUCommandEncoder;

		const buf = registry.getOrCreate1DBuffer(
			mockDevice,
			callerEncoder,
			"gate-node-1d",
			0.0,
			1.0,
			gateSignal,
			128,
			48000,
			"render-gate-1d",
			0,
			24,
		);

		expect(buf).toBeDefined();
		expect(mockDevice.createCommandEncoder).toHaveBeenCalled();
		expect(mockEncoder.beginComputePass).toHaveBeenCalled();
		expect(mockPass.dispatchWorkgroups).toHaveBeenCalled();
		expect(mockDevice.queue.submit).toHaveBeenCalled();
	});
});
