import { describe, expect, it, vi } from "vitest";

// Polyfill WebGPU globals for test runner
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

describe("SignalRegistry - SignalMath WebGPU Dispatch", () => {
	it("dispatches remap operation and sets computed stats", () => {
		const registry = new SignalRegistry();

		const mockTexture = {
			createView: vi.fn().mockReturnValue({}),
			destroy: vi.fn(),
			width: 256,
			height: 1,
		} as unknown as GPUTexture;

		const mockBuffer = {
			destroy: vi.fn(),
		} as unknown as GPUBuffer;

		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		} as unknown as GPURenderPipeline;

		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			draw: vi.fn(),
			end: vi.fn(),
		};

		const mockEncoder = {
			beginRenderPass: vi.fn().mockReturnValue(mockPass),
			copyBufferToTexture: vi.fn(),
			finish: vi.fn().mockReturnValue({}),
		} as unknown as GPUCommandEncoder;

		const mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue(mockBuffer),
			createSampler: vi.fn().mockReturnValue({}),
			createShaderModule: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		const nodeId = "math-remap-1";
		const signalData = {
			type: "signal_math",
			nodeId,
			operation: "remap",
			inMin: 0.0,
			inMax: 0.5,
			outMin: 10,
			outMax: 50,
			signalA: { nodeId: "source-a" },
		};

		// Set upstream source stats
		registry.setStats("source-a", { min: 0.0, max: 0.45 });

		const view = registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			nodeId,
			0.5,
			5.0,
			signalData,
			256,
			1,
		);

		expect(view).toBeDefined();
		expect(mockDevice.createRenderPipeline).toHaveBeenCalled();

		// Check stats published for SignalMath
		const stats = registry.getStats(nodeId);
		expect(stats).toBeDefined();
		expect(stats?.min).toBe(10);
		expect(stats?.max).toBe(50);
	});

	it("compiles and dispatches custom WGSL mode", () => {
		const registry = new SignalRegistry();

		const mockTexture = {
			createView: vi.fn().mockReturnValue({}),
			destroy: vi.fn(),
			width: 128,
			height: 1,
		} as unknown as GPUTexture;

		const mockBuffer = {
			destroy: vi.fn(),
		} as unknown as GPUBuffer;

		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		} as unknown as GPURenderPipeline;

		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			draw: vi.fn(),
			end: vi.fn(),
		};

		const mockEncoder = {
			beginRenderPass: vi.fn().mockReturnValue(mockPass),
			copyBufferToTexture: vi.fn(),
			finish: vi.fn().mockReturnValue({}),
		} as unknown as GPUCommandEncoder;

		const mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue(mockBuffer),
			createSampler: vi.fn().mockReturnValue({}),
			createShaderModule: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		const nodeId = "math-custom-1";
		const customWGSL = "return pow(a, 2.5) * b;";
		const signalData = {
			type: "signal_math",
			nodeId,
			operation: "custom",
			customWGSL,
			bValue: 2.0,
		};

		const view = registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			nodeId,
			1.0,
			10.0,
			signalData,
			128,
			1,
		);

		expect(view).toBeDefined();
		expect(mockDevice.createShaderModule).toHaveBeenCalledWith(
			expect.objectContaining({
				code: expect.stringContaining("return pow(a, 2.5) * b;"),
			}),
		);
	});

	it("dispatches add operation with constant value and computes accurate shifted stats", () => {
		const registry = new SignalRegistry();

		const mockTexture = {
			createView: vi.fn().mockReturnValue({}),
			destroy: vi.fn(),
			width: 256,
			height: 1,
		} as unknown as GPUTexture;

		const mockBuffer = {
			destroy: vi.fn(),
		} as unknown as GPUBuffer;

		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		} as unknown as GPURenderPipeline;

		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			draw: vi.fn(),
			end: vi.fn(),
		};

		const mockEncoder = {
			beginRenderPass: vi.fn().mockReturnValue(mockPass),
			copyBufferToTexture: vi.fn(),
			finish: vi.fn().mockReturnValue({}),
		} as unknown as GPUCommandEncoder;

		const mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue(mockBuffer),
			createSampler: vi.fn().mockReturnValue({}),
			createShaderModule: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		const nodeId = "math-add-1";
		const signalData = {
			type: "signal_math",
			nodeId,
			operation: "add",
			bValue: 10.0,
			signalA: { nodeId: "audio-source-1" },
		};

		// Audio source has stats [0.374, 0.888]
		registry.setStats("audio-source-1", { min: 0.374, max: 0.888 });

		const view = registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			nodeId,
			0.0,
			10.0,
			signalData,
			256,
			1,
		);

		expect(view).toBeDefined();

		const stats = registry.getStats(nodeId);
		expect(stats).toBeDefined();
		expect(stats?.min).toBeCloseTo(10.374, 3);
		expect(stats?.max).toBeCloseTo(10.888, 3);
	});

	it("resolves signalB when passed as a raw number input instead of config bValue", () => {
		const registry = new SignalRegistry();

		const mockTexture = {
			createView: vi.fn().mockReturnValue({}),
			destroy: vi.fn(),
			width: 256,
			height: 1,
		} as unknown as GPUTexture;

		const mockBuffer = {
			destroy: vi.fn(),
		} as unknown as GPUBuffer;

		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		} as unknown as GPURenderPipeline;

		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			draw: vi.fn(),
			end: vi.fn(),
		};

		const mockEncoder = {
			beginRenderPass: vi.fn().mockReturnValue(mockPass),
			copyBufferToTexture: vi.fn(),
			finish: vi.fn().mockReturnValue({}),
		} as unknown as GPUCommandEncoder;

		const mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue(mockBuffer),
			createSampler: vi.fn().mockReturnValue({}),
			createShaderModule: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		const nodeId = "math-add-raw-num";
		const signalData = {
			type: "signal_math",
			nodeId,
			operation: "add",
			bValue: 0.0, // Should be overridden by signalB
			signalB: 7.5,
			signalA: { nodeId: "source-a" },
		};

		registry.setStats("source-a", { min: 1.0, max: 3.0 });

		const view = registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			nodeId,
			0.0,
			10.0,
			signalData,
			256,
			1,
		);

		expect(view).toBeDefined();

		const stats = registry.getStats(nodeId);
		expect(stats).toBeDefined();
		expect(stats?.min).toBeCloseTo(8.5, 3);
		expect(stats?.max).toBeCloseTo(10.5, 3);
	});

	it("invalidates downstream signal math cache and updates stats when upstream number or input changes", () => {
		const registry = new SignalRegistry();

		const mockTexture = {
			createView: vi.fn().mockReturnValue({}),
			destroy: vi.fn(),
			width: 256,
			height: 1,
		} as unknown as GPUTexture;

		const mockBuffer = {
			destroy: vi.fn(),
		} as unknown as GPUBuffer;

		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		} as unknown as GPURenderPipeline;

		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			draw: vi.fn(),
			end: vi.fn(),
		};

		const mockEncoder = {
			beginRenderPass: vi.fn().mockReturnValue(mockPass),
			copyBufferToTexture: vi.fn(),
			finish: vi.fn().mockReturnValue({}),
		} as unknown as GPUCommandEncoder;

		const mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue(mockBuffer),
			createSampler: vi.fn().mockReturnValue({}),
			createShaderModule: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPURenderPipeline as unknown as GPUDevice;

		// Set initial upstream base signal stats
		registry.setStats("source-audio", { min: 0.1, max: 0.9 });

		// Node 1: Add initial value (~27.0)
		const node1Initial = {
			type: "signal_math",
			nodeId: "math-1",
			operation: "add",
			bValue: 27.0,
			signalA: { nodeId: "source-audio" },
		};

		// Node 2: Downstream Add (0.43), takes Node 1 as signalA
		const node2Initial = {
			type: "signal_math",
			nodeId: "math-2",
			operation: "add",
			bValue: 0.43,
			signalA: node1Initial,
		};

		// First evaluation of downstream node 2 at frame 0
		registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			"math-2",
			0.0,
			10.0,
			node2Initial,
			256,
			1,
			undefined,
			0,
			24,
		);

		const initialNode2Stats = registry.getStats("math-2");
		expect(initialNode2Stats).toBeDefined();
		expect(initialNode2Stats?.min).toBeCloseTo(27.53, 2);
		expect(initialNode2Stats?.max).toBeCloseTo(28.33, 2);

		// Now user modifies upstream Number input from 27.0 to 128.814
		const node1Updated = {
			type: "signal_math",
			nodeId: "math-1",
			operation: "add",
			bValue: 128.814,
			signalA: { nodeId: "source-audio" },
		};

		const node2Updated = {
			type: "signal_math",
			nodeId: "math-2",
			operation: "add",
			bValue: 0.43,
			signalA: node1Updated,
		};

		// Second evaluation of downstream node 2 at the same frame 0
		registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			"math-2",
			0.0,
			10.0,
			node2Updated,
			256,
			1,
			undefined,
			0,
			24,
		);

		const updatedNode2Stats = registry.getStats("math-2");
		expect(updatedNode2Stats).toBeDefined();
		expect(updatedNode2Stats?.min).toBeCloseTo(129.344, 2);
		expect(updatedNode2Stats?.max).toBeCloseTo(130.144, 2);
	});

	it("produces distinct fingerprints when operation changes even if op: 'Signal' is present", () => {
		const registry = new SignalRegistry();
		const fpAdd = registry.computeSignalFingerprint({
			op: "Signal",
			type: "signal_math",
			operation: "add",
			bValue: 1.0,
			nodeId: "math-node",
		});
		const fpSub = registry.computeSignalFingerprint({
			op: "Signal",
			type: "signal_math",
			operation: "subtract",
			bValue: 1.0,
			nodeId: "math-node",
		});
		expect(fpAdd).not.toBe(fpSub);
	});

	it("recalculates stats immediately when operation changes from Add to Subtract without changing bValue", () => {
		const registry = new SignalRegistry();

		const mockTexture = {
			createView: vi.fn().mockReturnValue({}),
			destroy: vi.fn(),
			width: 256,
			height: 1,
		} as unknown as GPUTexture;

		const mockBuffer = {
			destroy: vi.fn(),
		} as unknown as GPUBuffer;

		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		} as unknown as GPURenderPipeline;

		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			draw: vi.fn(),
			end: vi.fn(),
		};

		const mockEncoder = {
			beginRenderPass: vi.fn().mockReturnValue(mockPass),
			copyBufferToTexture: vi.fn(),
			finish: vi.fn().mockReturnValue({}),
		} as unknown as GPUCommandEncoder;

		const mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue(mockBuffer),
			createSampler: vi.fn().mockReturnValue({}),
			createShaderModule: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPURenderPipeline as unknown as GPUDevice;

		registry.setStats("source-sig", { min: 2.0, max: 5.0 });

		// Initial: Add with bValue = 1.0
		const addDescriptor = {
			op: "Signal",
			type: "signal_math",
			nodeId: "math-op-test",
			operation: "add",
			bValue: 1.0,
			signalA: { nodeId: "source-sig" },
		};

		registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			"math-op-test",
			0.0,
			10.0,
			addDescriptor,
			256,
			1,
			undefined,
			0,
			24,
		);

		const addStats = registry.getStats("math-op-test");
		expect(addStats).toBeDefined();
		expect(addStats?.min).toBeCloseTo(3.0, 3);
		expect(addStats?.max).toBeCloseTo(6.0, 3);

		// Now change operation to "subtract", keeping bValue = 1.0 identical!
		const subDescriptor = {
			op: "Signal",
			type: "signal_math",
			nodeId: "math-op-test",
			operation: "subtract",
			bValue: 1.0,
			signalA: { nodeId: "source-sig" },
		};

		registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			"math-op-test",
			0.0,
			10.0,
			subDescriptor,
			256,
			1,
			undefined,
			0,
			24,
		);

		const subStats = registry.getStats("math-op-test");
		expect(subStats).toBeDefined();
		expect(subStats?.min).toBeCloseTo(1.0, 3); // 2.0 - 1.0 = 1.0
		expect(subStats?.max).toBeCloseTo(4.0, 3); // 5.0 - 1.0 = 4.0
	});

	it("does not clamp add operation to [0, 1] range", () => {
		const registry = new SignalRegistry();

		const mockTexture = {
			createView: vi.fn().mockReturnValue({}),
			destroy: vi.fn(),
			width: 256,
			height: 1,
		} as unknown as GPUTexture;

		const mockBuffer = {
			destroy: vi.fn(),
		} as unknown as GPUBuffer;

		const mockPipeline = {
			getBindGroupLayout: vi.fn().mockReturnValue({}),
		} as unknown as GPURenderPipeline;

		const mockPass = {
			setPipeline: vi.fn(),
			setBindGroup: vi.fn(),
			draw: vi.fn(),
			end: vi.fn(),
		};

		const mockEncoder = {
			beginRenderPass: vi.fn().mockReturnValue(mockPass),
			copyBufferToTexture: vi.fn(),
			finish: vi.fn().mockReturnValue({}),
		} as unknown as GPUCommandEncoder;

		const mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue(mockBuffer),
			createSampler: vi.fn().mockReturnValue({}),
			createShaderModule: vi.fn().mockReturnValue({}),
			createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
			createBindGroup: vi.fn().mockReturnValue({}),
			createCommandEncoder: vi.fn().mockReturnValue(mockEncoder),
			queue: {
				writeBuffer: vi.fn(),
				writeTexture: vi.fn(),
				submit: vi.fn(),
			},
		} as unknown as GPUDevice;

		registry.setStats("source-sig", { min: 0.636, max: 1.15 });

		const addDescriptor = {
			type: "signal_math",
			nodeId: "math-add-large",
			operation: "add",
			bValue: 4.7,
			signalA: { nodeId: "source-sig" },
		};

		registry.getOrCreate2DTextureView(
			mockDevice,
			mockEncoder,
			"math-add-large",
			0.0,
			10.0,
			addDescriptor,
			256,
			1,
		);

		// Verify createShaderModule was called with shader code that does not clamp
		const shaderCalls = (mockDevice.createShaderModule as any).mock.calls;
		const lastShaderCall = shaderCalls[shaderCalls.length - 1][0];
		expect(lastShaderCall.code).not.toContain("clamp(val, clampMin, clampMax)");

		const stats = registry.getStats("math-add-large");
		expect(stats?.min).toBeCloseTo(5.336, 3);
		expect(stats?.max).toBeCloseTo(5.85, 3);
	});
});
