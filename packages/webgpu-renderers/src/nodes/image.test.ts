import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMockDevice,
	createMockRenderPassEncoder,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { textureCache } from "../texture-cache.js";
import { drawImageNode, imageLoader } from "./image.js";

// Mock sharp
vi.mock("sharp", () => {
	const mockToBuffer = vi.fn().mockResolvedValue({
		data: new Uint8Array([0, 1, 2, 3]),
		info: { width: 1, height: 1 },
	});
	const mockRaw = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
	const mockEnsureAlpha = vi.fn().mockReturnValue({ raw: mockRaw });
	const sharpMock = vi.fn().mockReturnValue({ ensureAlpha: mockEnsureAlpha });
	return {
		default: sharpMock,
	};
});

describe("Image Node", () => {
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
		mockDevice = createMockDevice();
		mockPass = createMockRenderPassEncoder();

		mockCtx = {
			device: mockDevice,
			renderer: {
				drawTexture: vi.fn(),
			},
		};

		// Mock global fetch
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
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
	});

	describe("ImageLoader", () => {
		it("should fetch and parse image in headless mode using sharp", async () => {
			const data = await imageLoader.load("http://test.com/img.png", true);
			expect(globalThis.fetch).toHaveBeenCalledWith("http://test.com/img.png");
			expect(data.width).toBe(1);
			expect(data.height).toBe(1);
			expect(data.buffer).toBeDefined();
			expect(data.bitmap).toBeUndefined();
		});

		it("should fetch and parse image in browser mode using createImageBitmap", async () => {
			const data = await imageLoader.load("http://test.com/img.png", false);
			expect(globalThis.fetch).toHaveBeenCalledWith("http://test.com/img.png");
			expect(data.width).toBe(10);
			expect(data.height).toBe(10);
			expect(data.bitmap).toBeDefined();
			expect(data.buffer).toBeUndefined();
		});

		it("should cache identical URLs", async () => {
			const p1 = imageLoader.load("http://test.com/cached.png", true);
			const p2 = imageLoader.load("http://test.com/cached.png", true);
			await Promise.all([p1, p2]);
			expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		});

		it("should remove failed load from pending cache", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: false,
				}),
			);

			await expect(
				imageLoader.load("http://test.com/fail.png", true),
			).rejects.toThrow();
		});
	});

	describe("drawImageNode", () => {
		it("should create texture and draw in headless mode", async () => {
			const props = {
				src: "http://test.com/headless.png",
				dstRect: { x: 0, y: 0, width: 100, height: 100 },
				isHeadless: true,
			};

			await drawImageNode(mockCtx, mockPass, props);

			expect(mockDevice.createTexture).toHaveBeenCalled();
			expect(mockDevice.queue.writeTexture).toHaveBeenCalled();
			expect(mockCtx.renderer.drawTexture).toHaveBeenCalled();
		});

		it("should create texture and draw in browser mode", async () => {
			const props = {
				src: "http://test.com/browser.png",
				dstRect: { x: 0, y: 0, width: 100, height: 100 },
				isHeadless: false,
			};

			await drawImageNode(mockCtx, mockPass, props);

			expect(mockDevice.createTexture).toHaveBeenCalled();
			expect(mockDevice.queue.copyExternalImageToTexture).toHaveBeenCalled();
			expect(mockCtx.renderer.drawTexture).toHaveBeenCalled();
		});

		it("should acquire existing cached texture and avoid recreate", async () => {
			const dummyTex = {} as any;
			textureCache.set("http://test.com/cached-node.png", dummyTex);

			const props = {
				src: "http://test.com/cached-node.png",
				dstRect: { x: 0, y: 0, width: 100, height: 100 },
				isHeadless: true,
			};

			await drawImageNode(mockCtx, mockPass, props);

			expect(mockDevice.createTexture).not.toHaveBeenCalled();
			expect(mockCtx.renderer.drawTexture).toHaveBeenCalledWith(
				mockPass,
				dummyTex,
				props.dstRect,
				expect.anything(),
			);
		});
	});
});
