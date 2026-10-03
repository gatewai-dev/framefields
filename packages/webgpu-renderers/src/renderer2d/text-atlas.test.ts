import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDevice } from "./test-helpers.js";
import { TextAtlas } from "./text-atlas.js";

describe("TextAtlas", () => {
	let mockDevice: any;
	let atlas: TextAtlas;

	beforeEach(() => {
		mockDevice = createMockDevice();
		globalThis.GPUTextureUsage = {
			TEXTURE_BINDING: 1,
			COPY_DST: 2,
			RENDER_ATTACHMENT: 4,
		} as any;
		atlas = new TextAtlas(mockDevice);
	});

	it("should initialize with custom atlas texture and size", () => {
		expect(atlas.size).toBe(8192);
		expect(atlas.getTexture()).toBeDefined();
		expect(mockDevice.createTexture).toHaveBeenCalledWith({
			size: [8192, 8192],
			format: "rgba8unorm",
			usage: 1 | 2 | 4,
		});
	});

	it("should get undefined for missing keys", () => {
		expect(atlas.get("missing")).toBeUndefined();
	});

	it("should upload a canvas and return regional coordinates", () => {
		const canvas = {
			width: 100,
			height: 50,
			getContext: vi.fn(),
		} as any;

		const region = atlas.upload("text1", canvas);

		expect(region).toBeDefined();
		expect(region.src).toEqual({ x: 0, y: 0, width: 100, height: 50 });
		expect(atlas.get("text1")).toBe(region);
		expect(mockDevice.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(
			1,
		);
	});

	it("should throw if canvas size exceeds atlas size", () => {
		const canvas = {
			width: 9000,
			height: 100,
		} as any;

		expect(() => atlas.upload("too-wide", canvas)).toThrow(
			"Text dimensions exceed atlas size",
		);
	});

	it("should wrap to a new row when row width exceeds atlas size", () => {
		const canvas1 = { width: 8000, height: 100 } as any;
		const canvas2 = { width: 500, height: 80 } as any;

		const region1 = atlas.upload("text1", canvas1);
		expect(region1.src).toEqual({ x: 0, y: 0, width: 8000, height: 100 });

		// canvas2 cannot fit in row 0 because 8000 + 500 = 8500 > 8192.
		// It should wrap to row 1 at y = 100 (which is rowHeight of previous row).
		const region2 = atlas.upload("text2", canvas2);
		expect(region2.src).toEqual({ x: 0, y: 100, width: 500, height: 80 });
	});

	it("should reset and clear cache if atlas becomes full", () => {
		const canvas1 = { width: 8000, height: 8000 } as any;
		const canvas2 = { width: 500, height: 500 } as any;

		atlas.upload("text1", canvas1);
		expect(atlas.get("text1")).toBeDefined();

		// Wraps to row 1 (y = 8000), but remaining height is 192, and canvas2 height is 500.
		// 8000 + 500 = 8500 > 8192.
		// Atlas should reset, clear cache, and place canvas2 at (0, 0).
		const region2 = atlas.upload("text2", canvas2);
		expect(region2.src).toEqual({ x: 0, y: 0, width: 500, height: 500 });
		expect(atlas.get("text1")).toBeUndefined();
		expect(atlas.get("text2")).toBe(region2);
	});

	it("should fallback to writeTexture using canvas 2d context if copyExternalImageToTexture throws", () => {
		// Make copyExternalImageToTexture throw an error
		mockDevice.queue.copyExternalImageToTexture.mockImplementation(() => {
			throw new Error("Failed to copy external image");
		});

		const mockCtx = {
			getImageData: vi.fn().mockReturnValue({
				data: new Uint8ClampedArray(4 * 10 * 10),
			}),
		};
		const canvas = {
			width: 10,
			height: 10,
			getContext: vi.fn().mockReturnValue(mockCtx),
		} as any;

		const region = atlas.upload("text1", canvas);

		expect(region).toBeDefined();
		expect(canvas.getContext).toHaveBeenCalledWith("2d");
		expect(mockCtx.getImageData).toHaveBeenCalledWith(0, 0, 10, 10);
		expect(mockDevice.queue.writeTexture).toHaveBeenCalledTimes(1);
	});

	it("should destroy the texture on destroy", () => {
		const tex = atlas.getTexture();
		atlas.destroy();
		expect(tex.destroy).toHaveBeenCalledTimes(1);
		expect(atlas.get("text1")).toBeUndefined();
	});
});
