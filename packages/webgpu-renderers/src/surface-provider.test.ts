import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSurfaceProvider } from "./surface-provider.js";

interface MockTexture {
	destroy: () => void;
	createView: () => unknown;
	width: number;
	height: number;
}

interface MockDevice {
	createTexture: (desc: {
		size: [number, number];
		format: string;
		usage: number;
	}) => MockTexture;
	createBuffer: (desc: unknown) => unknown;
	createCommandEncoder: () => unknown;
	queue: {
		submit: (commands: unknown[]) => void;
	};
}

interface MockCanvas {
	width: number;
	height: number;
	getContext: (type: string) => unknown;
}

describe("BrowserSurfaceProvider", () => {
	let originalNavigator: unknown;
	let mockDevice: MockDevice;
	let mockCanvas: MockCanvas;
	let mockContext: { configure: ReturnType<typeof vi.fn> };
	let mockTexture: MockTexture;

	beforeEach(() => {
		originalNavigator = (globalThis as { navigator?: unknown }).navigator;

		// Set up mock WebGPU globals
		(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage = {
			RENDER_ATTACHMENT: 1,
			COPY_SRC: 2,
			COPY_DST: 4,
		};
		(globalThis as { GPUMapMode?: unknown }).GPUMapMode = {
			READ: 1,
		};
		(globalThis as { GPUBufferUsage?: unknown }).GPUBufferUsage = {
			MAP_READ: 1,
			COPY_DST: 2,
		};

		mockTexture = {
			destroy: vi.fn(),
			createView: vi.fn().mockReturnValue({}),
			width: 2,
			height: 1,
		};

		mockDevice = {
			createTexture: vi.fn().mockReturnValue(mockTexture),
			createBuffer: vi.fn().mockReturnValue({
				mapAsync: vi.fn().mockResolvedValue(undefined),
				getMappedRange: vi
					.fn()
					.mockReturnValue(new Uint8Array([1, 2, 3, 255, 5, 6, 7, 255]).buffer),
				unmap: vi.fn(),
				destroy: vi.fn(),
			}),
			createCommandEncoder: vi.fn().mockReturnValue({
				copyTextureToBuffer: vi.fn(),
				finish: vi.fn().mockReturnValue({}),
			}),
			queue: {
				submit: vi.fn(),
			},
		};

		mockContext = {
			configure: vi.fn(),
		};

		mockCanvas = {
			width: 2,
			height: 1,
			getContext: vi.fn().mockReturnValue(mockContext),
		};
	});

	afterEach(() => {
		Object.defineProperty(globalThis, "navigator", {
			value: originalNavigator,
			configurable: true,
			writable: true,
		});
	});

	it("should default to rgba8unorm if navigator.gpu is not available", () => {
		Object.defineProperty(globalThis, "navigator", {
			value: {},
			configurable: true,
			writable: true,
		});

		const provider = new BrowserSurfaceProvider(
			mockDevice as unknown as GPUDevice,
			mockCanvas as unknown as HTMLCanvasElement,
		);

		expect(provider.colorFormat).toBe("rgba8unorm");
		expect(mockContext.configure).toHaveBeenCalledWith(
			expect.objectContaining({
				format: "rgba8unorm",
			}),
		);
	});

	it("should use navigator.gpu.getPreferredCanvasFormat if available", () => {
		const getPreferredCanvasFormat = vi.fn().mockReturnValue("bgra8unorm");
		Object.defineProperty(globalThis, "navigator", {
			value: {
				gpu: {
					getPreferredCanvasFormat,
				},
			},
			configurable: true,
			writable: true,
		});

		const provider = new BrowserSurfaceProvider(
			mockDevice as unknown as GPUDevice,
			mockCanvas as unknown as HTMLCanvasElement,
		);

		expect(getPreferredCanvasFormat).toHaveBeenCalled();
		expect(provider.colorFormat).toBe("bgra8unorm");
		expect(mockContext.configure).toHaveBeenCalledWith(
			expect.objectContaining({
				format: "bgra8unorm",
			}),
		);
	});

	it("should not swizzle readPixels when using rgba8unorm", async () => {
		Object.defineProperty(globalThis, "navigator", {
			value: {},
			configurable: true,
			writable: true,
		});

		const provider = new BrowserSurfaceProvider(
			mockDevice as unknown as GPUDevice,
			mockCanvas as unknown as HTMLCanvasElement,
		);

		const pixels = await provider.readPixels();
		// Mock data returns [1, 2, 3, 255, 5, 6, 7, 255]
		expect(Array.from(pixels)).toEqual([1, 2, 3, 255, 5, 6, 7, 255]);
	});

	it("should swizzle readPixels from BGRA to RGBA when using bgra8unorm", async () => {
		const getPreferredCanvasFormat = vi.fn().mockReturnValue("bgra8unorm");
		Object.defineProperty(globalThis, "navigator", {
			value: {
				gpu: {
					getPreferredCanvasFormat,
				},
			},
			configurable: true,
			writable: true,
		});

		const provider = new BrowserSurfaceProvider(
			mockDevice as unknown as GPUDevice,
			mockCanvas as unknown as HTMLCanvasElement,
		);

		const pixels = await provider.readPixels();
		// Mock data returns [1, 2, 3, 255, 5, 6, 7, 255] which is BGRA (B=1, G=2, R=3, A=255)
		// Swizzled to RGBA (R=3, G=2, B=1, A=255)
		expect(Array.from(pixels)).toEqual([3, 2, 1, 255, 7, 6, 5, 255]);
	});
});
