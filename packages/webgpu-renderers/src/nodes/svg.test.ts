import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMockDevice,
	createMockRenderPassEncoder,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { textureCache } from "../texture-cache.js";
import { drawSvgNode, svgLoader } from "./svg.js";

// Mock @resvg/resvg-js
vi.mock("@resvg/resvg-js", () => {
	return {
		renderAsync: vi.fn().mockResolvedValue({
			width: 10,
			height: 10,
			pixels: new Uint8Array([0, 1, 2, 3]),
		}),
	};
});

describe("SVG Node", () => {
	beforeAll(() => {
		ensureDOMGlobals();
		globalThis.GPUTextureUsage = {
			TEXTURE_BINDING: 1,
			COPY_DST: 2,
			RENDER_ATTACHMENT: 4,
		} as any;
	});

	let mockDevice: any;
	let mockPass: any;
	let mockCtx: any;

	beforeEach(() => {
		vi.clearAllMocks();
		textureCache.destroy();
		(svgLoader as any).cache.clear();
		mockDevice = createMockDevice();
		mockPass = createMockRenderPassEncoder();

		mockCtx = {
			device: mockDevice,
			renderer: {
				drawTexture: vi.fn(),
			},
		};

		// Mock fetch returning SVG string
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				text: vi.fn().mockResolvedValue("<svg></svg>"),
			}),
		);

		// Mock createImageBitmap
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn().mockResolvedValue({
				width: 10,
				height: 10,
				close: vi.fn(),
			}),
		);

		// Mock URL
		vi.stubGlobal("URL", {
			createObjectURL: vi.fn().mockReturnValue("blob:test"),
			revokeObjectURL: vi.fn(),
		});

		// Mock OffscreenCanvas
		vi.stubGlobal(
			"OffscreenCanvas",
			class {
				constructor(
					public width: number,
					public height: number,
				) {}
				getContext() {
					return {
						drawImage: vi.fn(),
					};
				}
			},
		);

		// Mock Image
		vi.stubGlobal(
			"Image",
			class {
				onload: (() => void) | null = null;
				onerror: (() => void) | null = null;
				private _src = "";
				set src(val: string) {
					this._src = val;
					setTimeout(() => {
						if (this.onload) this.onload();
					}, 0);
				}
				get src() {
					return this._src;
				}
			},
		);
	});

	describe("SvgLoader", () => {
		it("should load and render in headless mode using resvg", async () => {
			const data = await svgLoader.load("test.svg", 100, 100, true);
			expect(globalThis.fetch).toHaveBeenCalledWith("test.svg");
			expect(data.width).toBe(10);
			expect(data.height).toBe(10);
			expect(data.buffer).toBeDefined();
			expect(data.bitmap).toBeUndefined();
		});

		it("should load and render in browser mode using OffscreenCanvas", async () => {
			const data = await svgLoader.load("test.svg", 100, 100, false);
			expect(globalThis.fetch).toHaveBeenCalledWith("test.svg");
			expect(data.width).toBe(100);
			expect(data.height).toBe(100);
			expect(data.bitmap).toBeDefined();
			expect(data.buffer).toBeUndefined();
		});

		it("should cache identical requests by key", async () => {
			const p1 = svgLoader.load("test.svg", 100, 100, true);
			const p2 = svgLoader.load("test.svg", 100, 100, true);
			await Promise.all([p1, p2]);
			expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		});
	});

	describe("drawSvgNode", () => {
		it("should create texture and draw in headless mode", async () => {
			const props = {
				src: "test.svg",
				dstRect: { x: 0, y: 0, width: 100, height: 100 },
				isHeadless: true,
			};

			await drawSvgNode(mockCtx, mockPass, props);

			expect(mockDevice.createTexture).toHaveBeenCalled();
			expect(mockDevice.queue.writeTexture).toHaveBeenCalled();
			expect(mockCtx.renderer.drawTexture).toHaveBeenCalled();
		});

		it("should create texture and draw in browser mode", async () => {
			const props = {
				src: "test.svg",
				dstRect: { x: 0, y: 0, width: 100, height: 100 },
				isHeadless: false,
			};

			await drawSvgNode(mockCtx, mockPass, props);

			expect(mockDevice.createTexture).toHaveBeenCalled();
			expect(mockDevice.queue.copyExternalImageToTexture).toHaveBeenCalled();
			expect(mockCtx.renderer.drawTexture).toHaveBeenCalled();
		});
	});
});
