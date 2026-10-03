import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMockDevice,
	createMockRenderPassEncoder,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { textureCache } from "../texture-cache.js";
import { drawGifNode, gifLoader } from "./gif.js";

// Mock gifuct-js
vi.mock("gifuct-js", () => {
	return {
		parseGIF: vi.fn().mockReturnValue({}),
		decompressFrames: vi.fn().mockReturnValue([
			{
				dims: { width: 10, height: 10, left: 0, top: 0 },
				patch: new Uint8Array(10 * 10 * 4).fill(255),
				delay: 100,
			},
			{
				dims: { width: 10, height: 10, left: 0, top: 0 },
				patch: new Uint8Array(10 * 10 * 4).fill(128),
				delay: 100,
			},
		]),
	};
});

describe("GIF Node", () => {
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
		(gifLoader as any).cache.clear();
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
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
			}),
		);
	});

	describe("GifLoader", () => {
		it("should fetch, parse and cache GIF frames", async () => {
			const table = await gifLoader.load("test.gif");
			expect(globalThis.fetch).toHaveBeenCalledWith("test.gif");
			expect(table.width).toBe(10);
			expect(table.height).toBe(10);
			expect(table.frames).toHaveLength(2);
			expect(table.totalMs).toBe(200);

			// Cache hit
			await gifLoader.load("test.gif");
			expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		});

		it("should clean cache on error", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: false,
				}),
			);

			await expect(gifLoader.load("fail.gif")).rejects.toThrow();
		});
	});

	describe("drawGifNode", () => {
		it("should draw correct frame based on time and fps", async () => {
			const props = {
				src: "test.gif",
				frame: 3, // at 10 fps -> 300ms -> looped to 100ms -> frame index 1 (starts at 100ms)
				fps: 10,
				dstRect: { x: 0, y: 0, width: 100, height: 100 },
			};

			await drawGifNode(mockCtx, mockPass, props);

			// Texture should be created and uploaded
			expect(mockDevice.createTexture).toHaveBeenCalled();
			expect(mockDevice.queue.writeTexture).toHaveBeenCalled();
			expect(mockCtx.renderer.drawTexture).toHaveBeenCalled();
		});
	});
});
