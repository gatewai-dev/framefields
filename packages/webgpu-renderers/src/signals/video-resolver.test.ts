import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveVideoSignalValue } from "./video-resolver.js";

const GLOBAL_WEBGPU_REGISTRY_KEY = Symbol.for("gatewai.webgpuRegistry");
const GLOBAL_ANALYSIS_STORE_KEY = Symbol.for("gatewai.videoAnalysisStore");

interface MockRendererProps {
	ctx: unknown;
	encoder: GPUCommandEncoder;
	pass: GPURenderPassEncoder;
	targetView: GPUTextureView;
	targetTexture: GPUTexture;
	targetWidth: number;
	targetHeight: number;
	props: {
		renderId: string;
		virtualMedia: {
			type: "layer";
			operation: {
				id: string;
				op: string;
				smoothing?: number;
				gain?: number;
				offset?: number;
				inputs: Record<string, unknown>;
			};
			children: unknown[];
		};
		frame: number;
		fps: number;
		containerWidth: number;
		containerHeight: number;
	};
	drawChild: unknown;
}

type RendererFn = (args: MockRendererProps) => Promise<void> | void;

describe("resolveVideoSignalValue", () => {
	let originalRegistry: unknown;
	let originalAnalysisStore: unknown;

	beforeEach(() => {
		const g = globalThis as Record<symbol, unknown>;
		originalRegistry = g[GLOBAL_WEBGPU_REGISTRY_KEY];
		originalAnalysisStore = g[GLOBAL_ANALYSIS_STORE_KEY];
	});

	afterEach(() => {
		const g = globalThis as Record<symbol, unknown>;
		if (originalRegistry === undefined) {
			delete g[GLOBAL_WEBGPU_REGISTRY_KEY];
		} else {
			g[GLOBAL_WEBGPU_REGISTRY_KEY] = originalRegistry;
		}

		if (originalAnalysisStore === undefined) {
			delete g[GLOBAL_ANALYSIS_STORE_KEY];
		} else {
			g[GLOBAL_ANALYSIS_STORE_KEY] = originalAnalysisStore;
		}
	});

	it("should return 0.0 if signal data (sd) is invalid or null", async () => {
		const device = {} as GPUDevice;
		const encoder = {} as GPUCommandEncoder;
		const ctx = {};
		const drawChild = () => {};

		const resNull = await resolveVideoSignalValue(
			device,
			ctx,
			encoder,
			null,
			0,
			24,
			drawChild,
		);
		expect(resNull).toBe(0.0);

		const resNotGen = await resolveVideoSignalValue(
			device,
			ctx,
			encoder,
			{ type: "not-generator", nodeType: "video-analyzer" },
			0,
			24,
			drawChild,
		);
		expect(resNotGen).toBe(0.0);

		const resNoType = await resolveVideoSignalValue(
			device,
			ctx,
			encoder,
			{ type: "generator" },
			0,
			24,
			drawChild,
		);
		expect(resNoType).toBe(0.0);
	});

	it("should return 0.0 if webgpu registry is not found in globalThis", async () => {
		const g = globalThis as Record<symbol, unknown>;
		delete g[GLOBAL_WEBGPU_REGISTRY_KEY];

		const device = {} as GPUDevice;
		const encoder = {} as GPUCommandEncoder;
		const sd = {
			type: "generator",
			nodeType: "video-analyzer",
			nodeId: "node-1",
		};

		const res = await resolveVideoSignalValue(
			device,
			{},
			encoder,
			sd,
			0,
			24,
			() => {},
		);
		expect(res).toBe(0.0);
	});

	it("should return 0.0 if renderer is not registered for the nodeType", async () => {
		const registry = new Map<string, RendererFn>();
		const g = globalThis as Record<symbol, unknown>;
		g[GLOBAL_WEBGPU_REGISTRY_KEY] = registry;

		const device = {} as GPUDevice;
		const encoder = {} as GPUCommandEncoder;
		const sd = {
			type: "generator",
			nodeType: "missing-renderer",
			nodeId: "node-1",
		};

		const res = await resolveVideoSignalValue(
			device,
			{},
			encoder,
			sd,
			0,
			24,
			() => {},
		);
		expect(res).toBe(0.0);
	});

	it("should call the renderer if the value is not in analysis store, and retrieve output using gain and offset", async () => {
		const registry = new Map<string, RendererFn>();
		const analysisStore = new Map<string, Record<string, number>>();

		const g = globalThis as Record<symbol, unknown>;
		g[GLOBAL_WEBGPU_REGISTRY_KEY] = registry;
		g[GLOBAL_ANALYSIS_STORE_KEY] = analysisStore;

		const nodeId = "node-123";
		const frame = 42;
		const key = `${nodeId}-${frame}`;

		const mockRenderer = vi
			.fn()
			.mockImplementation(async (args: MockRendererProps) => {
				expect(args.props.renderId).toBe(nodeId);
				expect(args.props.frame).toBe(frame);
				expect(args.props.fps).toBe(30);
				expect(args.props.virtualMedia.operation.id).toBe(nodeId);
				expect(args.props.virtualMedia.operation.smoothing).toBe(2);

				// Simulate writing the analyzed value to the analysisStore
				analysisStore.set(key, { brightness: 0.8 });
			});

		registry.set("video-analyzer", mockRenderer);

		const device = {} as GPUDevice;
		const encoder = {} as GPUCommandEncoder;
		const sd = {
			type: "generator",
			nodeType: "video-analyzer",
			nodeId,
			smoothing: 2,
			gain: 10,
			offset: -1,
			channel: "brightness",
			input: { some: "child" },
		};

		const res = await resolveVideoSignalValue(
			device,
			{},
			encoder,
			sd,
			frame,
			30,
			() => {},
		);
		expect(mockRenderer).toHaveBeenCalledTimes(1);
		// 0.8 * 10 + (-1) = 7.0
		expect(res).toBe(7.0);
	});

	it("should use cached value directly and not call the renderer if already stored", async () => {
		const registry = new Map<string, RendererFn>();
		const analysisStore = new Map<string, Record<string, number>>();

		const g = globalThis as Record<symbol, unknown>;
		g[GLOBAL_WEBGPU_REGISTRY_KEY] = registry;
		g[GLOBAL_ANALYSIS_STORE_KEY] = analysisStore;

		const nodeId = "node-123";
		const frame = 42;
		const key = `${nodeId}-${frame}`;

		// Pre-populate analysis store
		analysisStore.set(key, { brightness: 0.6 });

		const mockRenderer = vi.fn();
		registry.set("video-analyzer", mockRenderer);

		const device = {} as GPUDevice;
		const encoder = {} as GPUCommandEncoder;
		const sd = {
			type: "generator",
			nodeType: "video-analyzer",
			nodeId,
			smoothing: 0,
			gain: 1.0,
			offset: 0.0,
			channel: "brightness",
		};

		const res = await resolveVideoSignalValue(
			device,
			{},
			encoder,
			sd,
			frame,
			30,
			() => {},
		);
		expect(mockRenderer).not.toHaveBeenCalled();
		expect(res).toBe(0.6);
	});

	it("should return fallback value computed from 0.0 if the requested channel is missing in the cached store", async () => {
		const registry = new Map<string, RendererFn>();
		const analysisStore = new Map<string, Record<string, number>>();

		const g = globalThis as Record<symbol, unknown>;
		g[GLOBAL_WEBGPU_REGISTRY_KEY] = registry;
		g[GLOBAL_ANALYSIS_STORE_KEY] = analysisStore;

		const nodeId = "node-123";
		const frame = 42;
		const key = `${nodeId}-${frame}`;

		// Store is pre-populated but misses the "brightness" channel
		analysisStore.set(key, { volume: 0.9 });

		const mockRenderer = vi.fn();
		registry.set("video-analyzer", mockRenderer);

		const device = {} as GPUDevice;
		const encoder = {} as GPUCommandEncoder;
		const sd = {
			type: "generator",
			nodeType: "video-analyzer",
			nodeId,
			gain: 5.0,
			offset: 2.0,
			channel: "brightness",
		};

		const res = await resolveVideoSignalValue(
			device,
			{},
			encoder,
			sd,
			frame,
			30,
			() => {},
		);
		expect(mockRenderer).not.toHaveBeenCalled();
		// 0.0 * 5.0 + 2.0 = 2.0
		expect(res).toBe(2.0);
	});
});
