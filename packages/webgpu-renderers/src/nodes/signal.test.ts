import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMockCommandEncoder,
	createMockDevice,
	createMockRenderPassEncoder,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { signalRegistry } from "../signals/signal-registry.js";
import { drawSignalNode } from "./signal.js";

vi.mock("../signals/signal-registry.js", () => {
	const mockExtract = vi.fn().mockResolvedValue(undefined);
	const mockEnsure = vi
		.fn()
		.mockImplementation(async (device, sd, fps, renderId) => {
			if (!sd) return;
			const check = async (s: any) => {
				if (!s || typeof s !== "object") return;
				if (s.sourceUrl && s.nodeId) {
					await mockExtract(device, s.sourceUrl, s, s.nodeId, fps, renderId);
				}
				if (s.signalA) await check(s.signalA);
				if (s.signalB) await check(s.signalB);
			};
			await check(sd);
		});

	return {
		signalRegistry: {
			getOrCreate2DTextureView: vi.fn().mockReturnValue({}),
			getMasterTextureView: vi.fn().mockReturnValue(undefined),
			getDuration: vi.fn().mockReturnValue(undefined),
			getStats: vi.fn().mockReturnValue(undefined),
			extractFromAudioSource: mockExtract,
			ensureAudioSourcesExtracted: mockEnsure,
		},
	};
});

describe("Signal Node", () => {
	beforeAll(() => {
		ensureDOMGlobals();
		globalThis.GPUBufferUsage = {
			UNIFORM: 1,
		} as any;
	});

	let mockDevice: any;
	let mockEncoder: any;
	let mockPass: any;
	let mockCtx: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockDevice = createMockDevice();
		mockDevice.createRenderPipeline.mockReturnValue({
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		});
		mockEncoder = createMockCommandEncoder();
		mockPass = createMockRenderPassEncoder();

		mockCtx = {
			device: mockDevice,
			renderer: {
				format: "rgba8unorm",
				getTemporaryBuffer: vi.fn().mockReturnValue({}),
				samplerCache: {
					getSampler: vi.fn().mockReturnValue({}),
				},
			},
		};
	});

	it("should compile pipeline, create bind groups, and draw signal", async () => {
		const props = {
			nodeId: "sig-1",
			func: "sine",
			amplitude: 2,
			frequency: 5,
			phase: 0,
			offset: 1,
			signalConfig: {
				amplitudeMin: -1,
				amplitudeMax: 3,
			},
			frame: 10,
			fps: 30,
			width: 256,
			height: 256,
		};

		await drawSignalNode(
			mockCtx,
			mockEncoder,
			mockPass,
			props as unknown as Parameters<typeof drawSignalNode>[3],
		);

		expect(signalRegistry.getOrCreate2DTextureView).toHaveBeenCalledWith(
			mockDevice,
			mockEncoder,
			"sig-1",
			10 / 30,
			0,
			props.signalConfig,
			256,
			256,
			undefined,
			10,
			30,
		);

		expect(mockDevice.createShaderModule).toHaveBeenCalled();
		expect(mockDevice.createRenderPipeline).toHaveBeenCalled();
		expect(mockCtx.renderer.getTemporaryBuffer).toHaveBeenCalled();
		expect(mockDevice.createBindGroup).toHaveBeenCalledTimes(2);

		expect(mockPass.setPipeline).toHaveBeenCalled();
		expect(mockPass.setBindGroup).toHaveBeenCalledTimes(2);
		expect(mockPass.draw).toHaveBeenCalledWith(4);
	});

	it("should return early if no signalConfig is provided", async () => {
		const props = {
			func: "sine",
			amplitude: 1,
			frequency: 1,
			phase: 0,
			offset: 0,
			frame: 0,
			fps: 30,
			width: 100,
			height: 100,
		};

		await drawSignalNode(
			mockCtx,
			mockEncoder,
			mockPass,
			props as unknown as Parameters<typeof drawSignalNode>[3],
		);

		expect(signalRegistry.getOrCreate2DTextureView).not.toHaveBeenCalled();
		expect(mockPass.draw).not.toHaveBeenCalled();
	});

	it("extracts audio into signalA.nodeId for signal_math nodes without overwriting math nodeId", async () => {
		const props = {
			nodeId: "math-node-1",
			signalConfig: {
				type: "signal_math",
				operation: "remap",
				inMin: 0,
				inMax: 1,
				outMin: 2,
				outMax: 5,
				signalA: {
					nodeId: "audio-extractor-1",
					sourceUrl: "http://example.com/audio.wav",
				},
			},
			frame: 0,
			fps: 30,
			width: 256,
			height: 256,
		};

		await drawSignalNode(
			mockCtx,
			mockEncoder,
			mockPass,
			props as unknown as Parameters<typeof drawSignalNode>[3],
		);

		expect(signalRegistry.extractFromAudioSource).toHaveBeenCalledWith(
			mockDevice,
			"http://example.com/audio.wav",
			props.signalConfig.signalA,
			"audio-extractor-1",
			30,
			undefined,
		);

		expect(signalRegistry.getOrCreate2DTextureView).toHaveBeenCalledWith(
			mockDevice,
			mockEncoder,
			"math-node-1",
			0,
			0,
			props.signalConfig,
			256,
			256,
			undefined,
			0,
			30,
		);
	});

	it("recursively resolves audio extractors across chained SignalMath nodes without overwriting any math node", async () => {
		const upstreamAudioConfig = {
			nodeId: "audio-extractor-root",
			sourceUrl: "http://example.com/beat.wav",
			extractionMode: "transient_beat",
		};

		const math1Config = {
			type: "signal_math",
			nodeId: "math-node-1",
			operation: "remap",
			signalA: upstreamAudioConfig,
		};

		const math2Props = {
			nodeId: "math-node-2",
			signalConfig: {
				type: "signal_math",
				operation: "multiply",
				bValue: 2,
				signalA: math1Config,
			},
			frame: 0,
			fps: 30,
			width: 256,
			height: 256,
		};

		await drawSignalNode(
			mockCtx,
			mockEncoder,
			mockPass,
			math2Props as unknown as Parameters<typeof drawSignalNode>[3],
		);

		// Audio should ONLY be extracted for audio-extractor-root, NEVER for math-node-1 or math-node-2
		expect(signalRegistry.extractFromAudioSource).toHaveBeenCalledTimes(1);
		expect(signalRegistry.extractFromAudioSource).toHaveBeenCalledWith(
			mockDevice,
			"http://example.com/beat.wav",
			upstreamAudioConfig,
			"audio-extractor-root",
			30,
			undefined,
		);

		// math-node-2 must render via getOrCreate2DTextureView
		expect(signalRegistry.getOrCreate2DTextureView).toHaveBeenCalledWith(
			mockDevice,
			mockEncoder,
			"math-node-2",
			0,
			0,
			math2Props.signalConfig,
			256,
			256,
			undefined,
			0,
			30,
		);
	});
});
