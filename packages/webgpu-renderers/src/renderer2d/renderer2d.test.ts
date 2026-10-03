import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Renderer2D } from "./index.js";
import {
	createMockCommandEncoder,
	createMockDevice,
	createMockRenderPassEncoder,
	createMockTexture,
	ensureDOMGlobals,
} from "./test-helpers.js";

describe("Renderer2D", () => {
	beforeAll(() => {
		ensureDOMGlobals();
	});

	let mockDevice: any;
	let renderer: Renderer2D;

	beforeEach(() => {
		mockDevice = createMockDevice();
		globalThis.GPUBufferUsage = {
			UNIFORM: 1,
			VERTEX: 2,
			COPY_DST: 4,
		} as any;
		globalThis.GPUShaderStage = {
			VERTEX: 1,
			FRAGMENT: 2,
		} as any;
		globalThis.GPUTextureUsage = {
			TEXTURE_BINDING: 1,
			COPY_DST: 2,
			RENDER_ATTACHMENT: 4,
			COPY_SRC: 8,
		} as any;

		renderer = new Renderer2D(mockDevice, "rgba8unorm");
	});

	it("should initialize pipelines and stack managers in constructor", () => {
		expect(renderer.format).toBe("rgba8unorm");
		expect(renderer.quadPipeline).toBeDefined();
		expect(renderer.solidPipeline).toBeDefined();
		expect(renderer.pathPipeline).toBeDefined();
		expect(renderer.effectPipeline).toBeDefined();
		expect(renderer.slugPipeline).toBeDefined();
		expect(renderer.bindGroupCache).toBeDefined();
		expect(renderer.samplerCache).toBeDefined();
	});

	describe("frame boundaries", () => {
		it("should begin frame with a render pass, updating surface dimensions", () => {
			const encoder = createMockCommandEncoder();
			const targetView = {} as GPUTextureView;

			const pass = renderer.beginFrame(
				encoder as any,
				targetView,
				{ r: 0.1, g: 0.2, b: 0.3, a: 1.0 },
				800,
				600,
			);

			expect(pass).toBeDefined();
			expect(renderer.getSurfaceWidth()).toBe(800);
			expect(renderer.getSurfaceHeight()).toBe(600);
			expect(encoder.beginRenderPass).toHaveBeenCalledWith({
				colorAttachments: [
					{
						view: targetView,
						clearValue: { r: 0.1, g: 0.2, b: 0.3, a: 1.0 },
						loadOp: "clear",
						storeOp: "store",
					},
				],
			});
		});

		it("should premultiply clearColor when alpha is less than 1", () => {
			const encoder = createMockCommandEncoder();
			const targetView = {} as GPUTextureView;

			renderer.beginFrame(
				encoder as any,
				targetView,
				{ r: 0.5, g: 0.5, b: 0.5, a: 0.0 },
				800,
				600,
			);

			expect(encoder.beginRenderPass).toHaveBeenCalledWith({
				colorAttachments: [
					{
						view: targetView,
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
						loadOp: "clear",
						storeOp: "store",
					},
				],
			});
		});

		it("should reset pools if command encoder changes", () => {
			const encoder1 = createMockCommandEncoder();
			const encoder2 = createMockCommandEncoder();
			const targetView = {} as GPUTextureView;

			// Spy on resetPools
			const resetSpy = vi.spyOn(renderer, "resetPools");

			// First call to establish encoder1 (will call resetPools since lastEncoder starts as null)
			renderer.beginFrame(
				encoder1 as any,
				targetView,
				{ r: 0, g: 0, b: 0, a: 0 },
				100,
				100,
			);
			expect(resetSpy).toHaveBeenCalledTimes(1);
			resetSpy.mockClear();

			// Calling beginFrame with same encoder should not trigger reset
			renderer.beginFrame(
				encoder1 as any,
				targetView,
				{ r: 0, g: 0, b: 0, a: 0 },
				100,
				100,
			);
			expect(resetSpy).not.toHaveBeenCalled();

			// Calling beginFrame with different encoder should trigger reset
			renderer.beginFrame(
				encoder2 as any,
				targetView,
				{ r: 0, g: 0, b: 0, a: 0 },
				100,
				100,
			);
			expect(resetSpy).toHaveBeenCalledTimes(1);
		});

		it("should support endFrame (currently a no-op)", () => {
			const encoder = createMockCommandEncoder();
			expect(() => renderer.endFrame(encoder as any)).not.toThrow();
		});
	});

	describe("drawing primitives", () => {
		let mockPass: any;
		let mockTex: any;

		beforeEach(() => {
			mockPass = createMockRenderPassEncoder();
			mockTex = createMockTexture(200, 100);
		});

		it("should draw texture with quad pipeline", () => {
			const drawSpy = vi.spyOn(renderer.quadPipeline, "draw");
			const dst = { x: 10, y: 20, width: 30, height: 40 };

			renderer.drawTexture(mockPass, mockTex, dst);

			expect(drawSpy).toHaveBeenCalledWith(
				mockPass,
				renderer.bindGroupCache,
				renderer.getTransformStack(),
				mockTex,
				expect.anything(),
				{ x: 0, y: 0, width: 200, height: 100 }, // Source rect defaults to texture dimensions
				dst,
				renderer.getSurfaceWidth(),
				renderer.getSurfaceHeight(),
				undefined,
			);
		});

		it("should draw texture region with quad pipeline", () => {
			const drawSpy = vi.spyOn(renderer.quadPipeline, "draw");
			const src = { x: 5, y: 5, width: 10, height: 10 };
			const dst = { x: 10, y: 20, width: 30, height: 40 };

			renderer.drawTextureRegion(mockPass, mockTex, src, dst);

			expect(drawSpy).toHaveBeenCalledWith(
				mockPass,
				renderer.bindGroupCache,
				renderer.getTransformStack(),
				mockTex,
				expect.anything(),
				src,
				dst,
				renderer.getSurfaceWidth(),
				renderer.getSurfaceHeight(),
				undefined,
			);
		});

		it("should draw rectangle with solid pipeline", () => {
			const drawSpy = vi.spyOn(renderer.solidPipeline, "draw");
			const rect = { x: 10, y: 10, width: 100, height: 100 };

			renderer.drawRect(mockPass, rect, "#FF0000", 5);

			expect(drawSpy).toHaveBeenCalledWith(
				mockPass,
				renderer.getTransformStack(),
				rect,
				"#FF0000",
				renderer.getSurfaceWidth(),
				renderer.getSurfaceHeight(),
				5,
				undefined,
			);
		});

		it("should draw rounded rectangle using drawRect proxy", () => {
			const drawRectSpy = vi.spyOn(renderer, "drawRect");
			const rrect = {
				rect: { x: 10, y: 10, width: 100, height: 100 },
				rx: 8,
				ry: 8,
			};

			renderer.drawRRect(mockPass, rrect, "rgb(0, 255, 0)");

			expect(drawRectSpy).toHaveBeenCalledWith(
				mockPass,
				rrect.rect,
				"rgb(0, 255, 0)",
				8,
				undefined,
			);
		});

		it("should draw path using path pipeline", () => {
			const drawPathSpy = vi.spyOn(renderer.pathPipeline, "drawPath");
			const pathStr = "M 10 10 L 20 20 Z";

			renderer.drawPath(mockPass, pathStr, "blue", 2);

			expect(drawPathSpy).toHaveBeenCalledWith(
				mockPass,
				renderer.getTransformStack(),
				pathStr,
				"blue",
				2,
				renderer.getSurfaceWidth(),
				renderer.getSurfaceHeight(),
				undefined,
			);
		});
	});

	describe("temporary resources and composition", () => {
		it("should get temporary texture from effect pipeline", () => {
			const getTextureSpy = vi.spyOn(renderer.effectPipeline, "getTexture");
			renderer.getTemporaryTexture(100, 200);

			expect(getTextureSpy).toHaveBeenCalledWith(
				mockDevice,
				100,
				200,
				"rgba8unorm",
				undefined,
			);
		});

		it("should get temporary buffer from effect pipeline", () => {
			const getBufferSpy = vi.spyOn(renderer.effectPipeline, "getBuffer");
			const data = new Uint8Array([1, 2, 3]);
			renderer.getTemporaryBuffer(data);

			expect(getBufferSpy).toHaveBeenCalledWith(mockDevice, data);
		});

		it("should composite textures using effect pipeline", () => {
			const compositeSpy = vi.spyOn(renderer.effectPipeline, "composite");
			const base = createMockTexture() as any;
			const overlay = createMockTexture() as any;
			const encoder = createMockCommandEncoder() as any;

			renderer.composite(encoder, base, overlay, "multiply");

			expect(compositeSpy).toHaveBeenCalledWith(
				encoder,
				renderer.bindGroupCache,
				renderer.samplerCache,
				base,
				overlay,
				"multiply",
				"rgba8unorm",
				undefined,
			);
		});
	});

	describe("transform transformations", () => {
		it("should push identity space by scaling/translating with inverse matrix", () => {
			const transformSpy = vi.spyOn(renderer, "pushTransform");
			// Translate matrix
			const mat = new DOMMatrix().translate(10, 20);
			renderer.pushTransform(mat);

			renderer.pushIdentity();

			// The inverse of translate(10,20) is translate(-10,-20).
			// Let's verify that pushTransform was called with the inverse.
			expect(transformSpy).toHaveBeenCalledTimes(2);
			const inverseCall = transformSpy.mock.calls[1][0];
			expect(inverseCall.e).toBe(-10);
			expect(inverseCall.f).toBe(-20);
		});

		it("should push and pop transform matrix from stack", () => {
			const stack = renderer.getTransformStack();
			const mat = new DOMMatrix().scale(2, 2);

			renderer.pushTransform(mat);
			expect(stack.getCurrent().a).toBe(2);

			renderer.popTransform();
			expect(stack.getCurrent().a).toBe(1);
		});
	});

	describe("scissors and stencil clipping", () => {
		it("should push and pop scissors", () => {
			const rect = { x: 10, y: 10, width: 50, height: 50 };
			renderer.pushScissor(rect);
			// We can verify scissor is set in next pass.
			const encoder = createMockCommandEncoder();
			const pass = renderer.beginFrame(
				encoder as any,
				{} as any,
				{ r: 0, g: 0, b: 0, a: 0 },
				800,
				600,
			);
			expect(pass.setScissorRect).toHaveBeenCalledWith(10, 10, 50, 50);
			renderer.popScissor();
		});

		it("should push and pop stencil clips", () => {
			renderer.pushStencilClip({ path: "M 0 0 Z" });
			renderer.popStencilClip();
		});

		it("should transform local coordinates and intersect with current scissor in pushScissorLocal", () => {
			const initialScissor = { x: 20, y: 20, width: 100, height: 100 };
			renderer.pushScissor(initialScissor);

			// Setup translation of (10, 10)
			renderer.pushTransform(new DOMMatrix().translate(10, 10));

			// Push local scissor { x: 5, y: 5, width: 40, height: 40 }
			// With translation (10, 10), the transformed coordinates are:
			// (5+10, 5+10) -> (15, 15) to (15+40, 15+40) -> (55, 55).
			//
			// Now we intersect transformed (x: 15, y: 15, w: 40, h: 40)
			// with initialScissor (x: 20, y: 20, w: 100, h: 100).
			// Intersection:
			// x = max(15, 20) = 20
			// y = max(15, 20) = 20
			// right = min(15 + 40, 20 + 100) = min(55, 120) = 55
			// bottom = min(15 + 40, 20 + 100) = min(55, 120) = 55
			// width = 55 - 20 = 35
			// height = 55 - 20 = 35
			renderer.pushScissorLocal({ x: 5, y: 5, width: 40, height: 40 });

			// Verify scissor applied to pass
			const encoder = createMockCommandEncoder();
			const pass = renderer.beginFrame(
				encoder as any,
				{} as any,
				{ r: 0, g: 0, b: 0, a: 0 },
				800,
				600,
			);

			expect(pass.setScissorRect).toHaveBeenCalledWith(20, 20, 35, 35);
		});
	});

	it("should destroy all sub-resources on destroy", () => {
		const transformSpy = vi.spyOn(renderer.getTransformStack(), "destroy");
		const bindGroupSpy = vi.spyOn(renderer.bindGroupCache, "destroy");
		const samplerSpy = vi.spyOn(renderer.samplerCache, "destroy");
		const quadSpy = vi.spyOn(renderer.quadPipeline, "destroy");
		const solidSpy = vi.spyOn(renderer.solidPipeline, "destroy");
		const shapeFillSpy = vi.spyOn(renderer.shapeFillPipeline, "destroy");
		const pathSpy = vi.spyOn(renderer.pathPipeline, "destroy");
		const effectSpy = vi.spyOn(renderer.effectPipeline, "destroy");
		const slugSpy = vi.spyOn(renderer.slugPipeline, "destroy");

		renderer.destroy();

		expect(renderer.isDestroyed).toBe(true);
		expect(transformSpy).toHaveBeenCalled();
		expect(bindGroupSpy).toHaveBeenCalled();
		expect(samplerSpy).toHaveBeenCalled();
		expect(quadSpy).toHaveBeenCalled();
		expect(solidSpy).toHaveBeenCalled();
		expect(shapeFillSpy).toHaveBeenCalled();
		expect(pathSpy).toHaveBeenCalled();
		expect(effectSpy).toHaveBeenCalled();
		expect(slugSpy).toHaveBeenCalled();
	});
});
