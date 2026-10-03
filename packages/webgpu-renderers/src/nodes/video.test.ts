import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMockDevice,
	createMockRenderPassEncoder,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";
import { textureCache } from "../texture-cache.js";
import { mediaDecoderCache } from "./media-decoder.js";
import { clearVideoNodeState, drawVideoNode } from "./video.js";

vi.mock("./media-decoder.js", () => {
	const mockDecoder = {
		getFrame: vi.fn().mockImplementation(async () => {
			return {
				width: 1920,
				height: 1080,
				canvas: { width: 1920, height: 1080 },
				buffer: new Uint8Array([0, 1, 2, 3]),
			};
		}),
	};
	return {
		mediaDecoderCache: {
			getVideo: vi.fn().mockReturnValue(mockDecoder),
		},
	};
});

describe("Video Node", () => {
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
	let mockDecoderInstance: any;

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

		mockDecoderInstance = mediaDecoderCache.getVideo("", false);
	});

	it("should decode and draw a new frame in browser mode", async () => {
		const props = {
			nodeId: "video-node-1",
			frameKey: "v1-f10",
			sourceUrl: "test-video.mp4",
			timestampSec: 0.5,
			dstRect: { x: 0, y: 0, width: 100, height: 100 },
			isHeadless: false,
		};

		await drawVideoNode(mockCtx, mockPass, props);

		expect(mediaDecoderCache.getVideo).toHaveBeenCalledWith(
			"test-video.mp4",
			false,
			"video-node-1",
		);
		expect(mockDecoderInstance.getFrame).toHaveBeenCalledWith(0.5);
		expect(mockDevice.createTexture).toHaveBeenCalled();
		expect(mockDevice.queue.copyExternalImageToTexture).toHaveBeenCalled();
		expect(mockCtx.renderer.drawTexture).toHaveBeenCalled();
	});

	it("should decode and draw in headless mode using buffers", async () => {
		const props = {
			nodeId: "video-node-1",
			frameKey: "v1-f10-headless",
			sourceUrl: "test-video.mp4",
			timestampSec: 0.5,
			dstRect: { x: 0, y: 0, width: 100, height: 100 },
			isHeadless: true,
		};

		await drawVideoNode(mockCtx, mockPass, props);

		expect(mockDevice.createTexture).toHaveBeenCalled();
		expect(mockDevice.queue.writeTexture).toHaveBeenCalled();
		expect(mockCtx.renderer.drawTexture).toHaveBeenCalled();
	});

	it("should fall back to last good frame if exact frame decode is slow/in-progress in browser mode", async () => {
		let resolveFrame: any;
		const delayPromise = new Promise<any>((resolve) => {
			resolveFrame = resolve;
		});
		// First, set up a last good frame by rendering successfully once
		const props1 = {
			nodeId: "video-node-2",
			frameKey: "v2-f1",
			sourceUrl: "test-video.mp4",
			timestampSec: 0.1,
			dstRect: { x: 0, y: 0, width: 100, height: 100 },
			isHeadless: false,
		};
		await drawVideoNode(mockCtx, mockPass, props1);
		expect(mockCtx.renderer.drawTexture).toHaveBeenCalledTimes(1);

		// Now make the next decode slow
		mockDecoderInstance.getFrame.mockReturnValueOnce(delayPromise);

		// Now render the second frame, which decodes slowly. In browser mode, this should fall back
		// to the last good frame immediately without blocking.
		const props2 = {
			nodeId: "video-node-2",
			frameKey: "v2-f2",
			sourceUrl: "test-video.mp4",
			timestampSec: 0.2,
			dstRect: { x: 0, y: 0, width: 100, height: 100 },
			isHeadless: false,
		};

		mockCtx.renderer.drawTexture.mockClear();
		await drawVideoNode(mockCtx, mockPass, props2);

		// Should draw the fallback frame (v2-f1) immediately
		expect(mockCtx.renderer.drawTexture).toHaveBeenCalledTimes(1);

		// Clean up the slow promise
		resolveFrame({
			width: 1920,
			height: 1080,
			canvas: { width: 1920, height: 1080 },
		});
		await delayPromise;
	});

	it("should clear fallback state with clearVideoNodeState", () => {
		expect(() => clearVideoNodeState("video-node-2")).not.toThrow();
	});
});
