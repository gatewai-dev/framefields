import type { ChartGPUOptions } from "chartgpu";
import { describe, expect, it, vi } from "vitest";
import type { RenderContextValue } from "../render-context.js";
import {
	ChartGPUEngineBridge,
	chartBridgeCache,
	drawChartNode,
	HeadlessChartCanvasElementMock,
	HeadlessChartContainerMock,
	HeadlessGPUCanvasContextMock,
} from "./chart.js";
import type { ChartNodeProps } from "./types.js";

if (typeof globalThis.GPUTextureUsage === "undefined") {
	(globalThis as unknown as { GPUTextureUsage: unknown }).GPUTextureUsage = {
		COPY_SRC: 0x01,
		COPY_DST: 0x02,
		TEXTURE_BINDING: 0x04,
		STORAGE_BINDING: 0x08,
		RENDER_ATTACHMENT: 0x10,
	};
}

describe("Chart Node & Headless WebGPU Adapter", () => {
	const createMockDevice = () => {
		const mockTexture = {
			destroy: vi.fn(),
			createView: vi.fn().mockReturnValue({}),
		};
		return {
			lost: new Promise(() => {}),
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue({
				destroy: vi.fn(),
				getMappedRange: vi.fn().mockReturnValue(new ArrayBuffer(1024)),
				unmap: vi.fn(),
			}),
			createBindGroupLayout: vi.fn().mockReturnValue({}),
			createBindGroup: vi.fn().mockReturnValue({}),
			createPipelineLayout: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue({}),
			createComputePipeline: vi.fn().mockReturnValue({}),
			createShaderModule: vi.fn().mockReturnValue({}),
			createSampler: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue({
				beginRenderPass: vi.fn().mockReturnValue({
					setPipeline: vi.fn(),
					setBindGroup: vi.fn(),
					setVertexBuffer: vi.fn(),
					draw: vi.fn(),
					end: vi.fn(),
				}),
				finish: vi.fn().mockReturnValue({}),
			}),
			limits: {
				maxTextureDimension2D: 8192,
				maxBufferSize: 268435456,
				maxStorageBufferBindingSize: 134217728,
				maxUniformBufferBindingSize: 65536,
				minUniformBufferOffsetAlignment: 256,
				minStorageBufferOffsetAlignment: 256,
				maxVertexBuffers: 8,
				maxVertexAttributes: 16,
				maxVertexBufferArrayStride: 2048,
				maxInterStageShaderComponents: 60,
				maxComputeWorkgroupStorageSize: 32768,
			},
			features: new Set(["float32-filterable"]),
			queue: {
				submit: vi.fn(),
				writeTexture: vi.fn(),
				writeBuffer: vi.fn(),
			},
		} as unknown as GPUDevice;
	};

	it("HeadlessGPUCanvasContextMock handles configure and getCurrentTexture", () => {
		const mockDevice = createMockDevice();
		const mockTexture = mockDevice.createTexture({
			size: [100, 100],
			format: "rgba8unorm",
			usage: 0,
		});
		const target = {
			device: mockDevice,
			format: "rgba8unorm" as GPUTextureFormat,
			width: 100,
			height: 100,
			currentTexture: mockTexture,
		};

		const ctx = new HeadlessGPUCanvasContextMock(target);
		ctx.configure({
			device: mockDevice,
			format: "rgba8unorm",
		});
		expect(ctx.configuredFormat).toBe("rgba8unorm");
		expect(ctx.getCurrentTexture()).toBe(mockTexture);

		ctx.unconfigure();
		expect(ctx.configuredFormat).toBeNull();
	});

	it("HeadlessChartCanvasElementMock & ContainerMock provide DOM geometry shims", () => {
		const mockDevice = createMockDevice();
		const target = {
			device: mockDevice,
			format: "rgba8unorm" as GPUTextureFormat,
			width: 320,
			height: 240,
			currentTexture: mockDevice.createTexture({
				size: [320, 240],
				format: "rgba8unorm",
				usage: 0,
			}),
		};

		const canvas = new HeadlessChartCanvasElementMock(target);
		expect(canvas.width).toBe(320);
		expect(canvas.height).toBe(240);
		const rect = canvas.getBoundingClientRect();
		expect(rect.width).toBe(320);
		expect(rect.height).toBe(240);

		const gpuCtx = canvas.getContext("webgpu");
		expect(gpuCtx).toBeInstanceOf(HeadlessGPUCanvasContextMock);

		const container = new HeadlessChartContainerMock(320, 240);
		const child = {};
		container.appendChild(child);
		expect(container.children).toContain(child);
		container.removeChild(child);
		expect(container.children).not.toContain(child);
	});

	it("ChartGPUEngineBridge initializes and renders frames", async () => {
		const mockDevice = createMockDevice();
		const bridge = new ChartGPUEngineBridge({
			device: mockDevice,
			width: 400,
			height: 200,
		});

		expect(bridge.width).toBe(400);
		expect(bridge.height).toBe(200);
		expect(bridge.currentTexture).toBeDefined();

		const options = {
			theme: "dark" as const,
			xAxis: { type: "category" as const },
			yAxis: { type: "value" as const },
			series: [
				{
					type: "line" as const,
					data: [
						[0, 10],
						[1, 20],
						[2, 30],
					],
				},
			],
		};

		await bridge.initialize(options as unknown as ChartGPUOptions);
		const tex = await bridge.renderFrame(0.5);
		expect(tex).toBeDefined();

		bridge.destroy();
	});

	it("drawChartNode manages bridge cache and calls ctx.renderer.drawTexture", async () => {
		const mockDevice = createMockDevice();
		const mockPass = {} as GPURenderPassEncoder;
		const mockRenderer = {
			drawTexture: vi.fn(),
		};
		const mockCtx = {
			device: mockDevice,
			renderer: mockRenderer,
		} as unknown as RenderContextValue;

		const props: ChartNodeProps = {
			nodeId: "test_chart_node",
			dstRect: { x: 10, y: 10, width: 200, height: 100 },
			chartOptions: {
				series: [
					{
						type: "line" as const,
						data: [
							[0, 5],
							[1, 15],
						],
					},
				],
			} as unknown as ChartGPUOptions,
			progress: 0.8,
			opacity: 0.9,
		};

		await drawChartNode(mockCtx, mockPass, props);

		expect(chartBridgeCache.has("test_chart_node")).toBe(true);
		expect(mockRenderer.drawTexture).toHaveBeenCalledWith(
			mockPass,
			expect.anything(),
			props.dstRect,
			expect.objectContaining({ opacity: 0.9 }),
		);

		// Clean up
		const bridge = chartBridgeCache.get("test_chart_node");
		bridge?.destroy();
		chartBridgeCache.delete("test_chart_node");
	});
});
