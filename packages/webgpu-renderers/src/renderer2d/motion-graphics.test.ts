import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Renderer2D } from "./index.js";
import {
	createMockCommandEncoder,
	createMockDevice,
	createMockRenderPassEncoder,
	createMockTexture,
	ensureDOMGlobals,
} from "./test-helpers.js";

describe("Motion Graphics Pipeline", () => {
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

	describe("PathPipeline with Caps & Trimming", () => {
		it("draws path with trim and round cap", () => {
			const encoder = createMockCommandEncoder();
			const pass = renderer.beginFrame(
				encoder as any,
				{} as any,
				{ r: 0, g: 0, b: 0, a: 0 },
				800,
				600,
			);

			renderer.drawPath(
				pass,
				"M 0 0 L 100 0 L 100 100",
				"#ffffff",
				4,
				{
					trimStart: 0,
					trimEnd: 0.5,
					strokeLineCap: "round",
				},
			);

			expect(pass.draw).toHaveBeenCalled();
		});

		it("draws path with butt and square caps", () => {
			const encoder = createMockCommandEncoder();
			const pass = renderer.beginFrame(
				encoder as any,
				{} as any,
				{ r: 0, g: 0, b: 0, a: 0 },
				800,
				600,
			);

			renderer.drawPath(
				pass,
				"M 10 10 L 50 50",
				"#ff0000",
				6,
				{
					strokeLineCap: "butt",
				},
			);
			expect(pass.draw).toHaveBeenCalled();

			renderer.drawPath(
				pass,
				"M 10 10 L 50 50",
				"#00ff00",
				6,
				{
					strokeLineCap: "square",
				},
			);
			expect(pass.draw).toHaveBeenCalled();
		});
	});

	describe("ShapeFillPipeline", () => {
		it("draws solid fill and gradient fills", () => {
			const encoder = createMockCommandEncoder();
			const pass = renderer.beginFrame(
				encoder as any,
				{} as any,
				{ r: 0, g: 0, b: 0, a: 0 },
				800,
				600,
			);

			// Solid
			renderer.drawShape(
				pass,
				{ shapeType: "star", width: 100, height: 100 },
				{ type: "solid", color: "#ffaa00" },
			);
			expect(pass.draw).toHaveBeenCalled();

			// Linear gradient
			renderer.drawShape(
				pass,
				{ shapeType: "circle", width: 100, height: 100 },
				{ type: "linear", color: "#ff0000", color2: "#0000ff" },
			);
			expect(pass.draw).toHaveBeenCalled();

			// Radial gradient
			renderer.drawShape(
				pass,
				{ shapeType: "rect", width: 100, height: 100, cornerRadius: 10 },
				{ type: "radial", color: "#ffffff", color2: "#000000" },
			);
			expect(pass.draw).toHaveBeenCalled();
		});
	});

	describe("Directional Motion Blur", () => {
		it("returns source texture directly when velocity is negligible", () => {
			const encoder = createMockCommandEncoder();
			const sourceTex = createMockTexture(100, 100);

			const out = renderer.applyMotionBlur(
				encoder as any,
				sourceTex as any,
				0.02,
				0.01,
				180,
			);

			expect(out).toBe(sourceTex);
			expect(encoder.beginRenderPass).not.toHaveBeenCalled();
		});

		it("executes motion blur pass when velocity and shutter angle are active", () => {
			const encoder = createMockCommandEncoder();
			const sourceTex = createMockTexture(200, 200);

			const out = renderer.applyMotionBlur(
				encoder as any,
				sourceTex as any,
				15,
				25,
				180,
			);

			expect(out).toBeDefined();
			expect(out).not.toBe(sourceTex);
			expect(encoder.beginRenderPass).toHaveBeenCalled();
		});
	});
});
