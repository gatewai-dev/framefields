import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Camera3D } from "../math3d/index.js";
import { Renderer3D } from "./renderer3d.js";
import {
	createMockCommandEncoder,
	createMockDevice,
	createMockRenderPassEncoder,
	createMockTexture,
	ensureDOMGlobals,
} from "../renderer2d/test-helpers.js";

describe("Renderer3D Subsystem", () => {
	beforeAll(() => {
		ensureDOMGlobals();
	});

	let mockDevice: any;
	let renderer3d: Renderer3D;

	beforeEach(() => {
		mockDevice = createMockDevice();
		globalThis.GPUBufferUsage = {
			UNIFORM: 1,
			VERTEX: 2,
			COPY_DST: 4,
			INDEX: 8,
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

		renderer3d = new Renderer3D(mockDevice, "rgba8unorm");
	});

	it("initializes Quad3DPipeline and DoF pipelines cleanly", () => {
		expect(renderer3d.format).toBe("rgba8unorm");
		expect(renderer3d.quad3dPipeline).toBeDefined();
		expect(mockDevice.createRenderPipeline).toHaveBeenCalled();
	});

	it("creates and caches depth textures for surface dimensions", () => {
		const depth1 = renderer3d.getOrCreateDepthTexture(1920, 1080);
		expect(depth1).toBeDefined();
		expect(mockDevice.createTexture).toHaveBeenCalledWith(
			expect.objectContaining({
				format: "depth24plus",
			}),
		);

		// Second call with same size should return cached texture
		const callCount = mockDevice.createTexture.mock.calls.length;
		const depth2 = renderer3d.getOrCreateDepthTexture(1920, 1080);
		expect(depth2).toBe(depth1);
		expect(mockDevice.createTexture.mock.calls.length).toBe(callCount);
	});

	it("begins 3D pass binding CameraUniforms and depthStencilAttachment", () => {
		const encoder = createMockCommandEncoder();
		const colorTargetView = {} as GPUTextureView;
		const camera = Camera3D.createDefaultCamera(1920, 1080, 50);

		const { pass, cameraBindGroup, lightsBindGroup } = renderer3d.beginPass(
			encoder as any,
			colorTargetView,
			1920,
			1080,
			camera,
			"clear",
		);

		expect(pass).toBeDefined();
		expect(cameraBindGroup).toBeDefined();
		expect(lightsBindGroup).toBeDefined();
		expect(encoder.beginRenderPass).toHaveBeenCalledWith(
			expect.objectContaining({
				depthStencilAttachment: expect.objectContaining({
					depthClearValue: 1.0,
					depthLoadOp: "clear",
				}),
			}),
		);
	});

	it("draws a 3D textured quad with model transformation", () => {
		const pass = createMockRenderPassEncoder();
		const cameraBindGroup = {} as GPUBindGroup;
		const lightsBindGroup = {} as GPUBindGroup;
		const texture = createMockTexture(500, 300) as any;

		renderer3d.drawTextureQuad(pass as any, cameraBindGroup, lightsBindGroup, texture, {
			position: [960, 540, 200],
			width: 600,
			height: 400,
			rotation: [15, -20, 0],
			opacity: 0.9,
			twoSided: true,
		});

		expect(pass.setPipeline).toHaveBeenCalled();
		expect(pass.setBindGroup).toHaveBeenCalledWith(0, cameraBindGroup);
		expect(pass.setBindGroup).toHaveBeenCalledWith(3, lightsBindGroup);
		expect(pass.drawIndexed).toHaveBeenCalledWith(6);
	});

	it("initializes MotionBlur, SSAO, Shadow, and Glass pipelines cleanly", async () => {
		const { MotionBlurPipeline } = await import("./motion-blur-pipeline.js");
		const { SSAOPipeline } = await import("./ssao-pipeline.js");
		const { ShadowPipeline } = await import("./shadow-pipeline.js");
		const { GlassPipeline } = await import("./glass-pipeline.js");

		const motionBlur = new MotionBlurPipeline(mockDevice, "rgba8unorm");
		const ssao = new SSAOPipeline(mockDevice, "rgba8unorm");
		const shadow = new ShadowPipeline(mockDevice, 1024);
		const glass = new GlassPipeline(mockDevice, "rgba8unorm");

		expect(motionBlur).toBeDefined();
		expect(ssao).toBeDefined();
		expect(shadow).toBeDefined();
		expect(glass).toBeDefined();

		// Test GlassPipeline draw
		const pass = createMockRenderPassEncoder();
		const cameraBindGroup = {} as GPUBindGroup;
		const backdropTexture = createMockTexture(1920, 1080) as any;
		const sampler = {} as GPUSampler;

		glass.draw(pass as any, cameraBindGroup, backdropTexture, sampler, {
			viewportWidth: 1920,
			viewportHeight: 1080,
			modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
			ior: 1.49,
			roughness: 0.15,
		});

		expect(pass.setPipeline).toHaveBeenCalledWith(glass.pipeline);
		expect(pass.drawIndexed).toHaveBeenCalledWith(6);

		motionBlur.destroy();
		ssao.destroy();
		shadow.destroy();
		glass.destroy();
	});

	it("deforms 3D mesh via deformMesh before draw dispatch", () => {
		const encoder = createMockCommandEncoder();
		const meshData = {
			positions: new Float32Array([0, 10, 0, -10, -10, 10, 10, -10, 10]),
			normals: new Float32Array([0, 1, 0, 0, 0, 1, 0, 0, 1]),
			uvs: new Float32Array([0.5, 0.5, 0.1, 0.9, 0.9, 0.9]),
			indices: new Uint16Array([0, 1, 2]),
		};

		const latentBuffer = mockDevice.createBuffer({
			size: 4112,
			usage: GPUBufferUsage.STORAGE,
		});

		const deformedBuffers = renderer3d.deformMesh(encoder as any, meshData, {
			config: {
				audioTrackId: "beat",
				mode: "normal_extrusion",
				amplitudeMultiplier: 1.5,
			},
			latentBuffer: latentBuffer as any,
			timeMs: 250,
		});

		expect(deformedBuffers).toBeDefined();
		expect(deformedBuffers.vertexBuffer).toBeDefined();
		expect(encoder.beginComputePass).toHaveBeenCalled();
	});
});

