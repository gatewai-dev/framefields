/**
 * @file packages/webgpu-renderers/src/renderer3d/ssao-pipeline.ts
 * WebGPU render pipeline for Screen-Space Ambient Occlusion (SSAO) and Bilateral Cross-Blur.
 */

import { type Mat4, Matrix4Math } from "../math3d/index.js";
import { ssaoBlurWgsl, ssaoWgsl } from "../shaders/ssao.js";

export interface SSAOPassOptions {
	projMatrix: Mat4;
	invProjMatrix?: Mat4;
	viewMatrix: Mat4;
	radius?: number;
	bias?: number;
	intensity?: number;
	kernelSamples?: number;
	blurRadius?: number;
	depthThreshold?: number;
	width: number;
	height: number;
}

export class SSAOPipeline {
	private device: GPUDevice;
	private ssaoPipeline: GPURenderPipeline;
	private blurPipeline: GPURenderPipeline;
	private ssaoBindGroupLayout: GPUBindGroupLayout;
	private blurBindGroupLayout: GPUBindGroupLayout;
	private ssaoUniformBuffer: GPUBuffer;
	private blurUniformBuffer: GPUBuffer;
	private kernelBuffer: GPUBuffer;
	private noiseTexture: GPUTexture;
	private sampler: GPUSampler;

	constructor(device: GPUDevice) {
		this.device = device;

		// 1. Generate 4x4 random rotation noise texture
		this.noiseTexture = device.createTexture({
			label: "ssao-noise-tex",
			size: [4, 4, 1],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

		const noiseData = new Uint8Array(4 * 4 * 4);
		for (let i = 0; i < 16; i++) {
			noiseData[i * 4 + 0] = Math.floor(Math.random() * 255);
			noiseData[i * 4 + 1] = Math.floor(Math.random() * 255);
			noiseData[i * 4 + 2] = 128;
			noiseData[i * 4 + 3] = 255;
		}
		device.queue.writeTexture(
			{ texture: this.noiseTexture },
			noiseData,
			{ bytesPerRow: 16 },
			[4, 4, 1],
		);

		// 2. Generate 32-sample Cosine-weighted Hemispherical Kernel
		const kernelFloats = new Float32Array(32 * 4);
		for (let i = 0; i < 32; i++) {
			const u1 = Math.random();
			const u2 = Math.random();
			const theta = Math.acos(Math.sqrt(1.0 - u1));
			const phi = 2.0 * Math.PI * u2;

			let scale = (i + 1) / 32;
			scale = 0.1 + 0.9 * (scale * scale);

			kernelFloats[i * 4 + 0] = Math.sin(theta) * Math.cos(phi) * scale;
			kernelFloats[i * 4 + 1] = Math.sin(theta) * Math.sin(phi) * scale;
			kernelFloats[i * 4 + 2] = Math.cos(theta) * scale;
			kernelFloats[i * 4 + 3] = 0.0;
		}

		this.kernelBuffer = device.createBuffer({
			label: "ssao-kernel-buffer",
			size: kernelFloats.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(this.kernelBuffer, 0, kernelFloats);

		// 3. SSAO Evaluation Pipeline
		const ssaoShader = device.createShaderModule({
			label: "ssao-shader",
			code: ssaoWgsl,
		});

		this.ssaoBindGroupLayout = device.createBindGroupLayout({
			label: "ssao-bgl",
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
				{ binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
				{ binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
			],
		});

		this.ssaoPipeline = device.createRenderPipeline({
			label: "ssao-eval-pipeline",
			layout: device.createPipelineLayout({ bindGroupLayouts: [this.ssaoBindGroupLayout] }),
			vertex: { module: ssaoShader, entryPoint: "vs_main" },
			fragment: {
				module: ssaoShader,
				entryPoint: "fs_ssao",
				targets: [{ format: "r8unorm" }],
			},
			primitive: { topology: "triangle-strip" },
		});

		this.ssaoUniformBuffer = device.createBuffer({
			label: "ssao-uniforms",
			size: 256, // 3 * 64 + 64 bytes
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		// 4. Bilateral Blur Pipeline
		const blurShader = device.createShaderModule({
			label: "ssao-blur-shader",
			code: ssaoBlurWgsl,
		});

		this.blurBindGroupLayout = device.createBindGroupLayout({
			label: "ssao-blur-bgl",
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
			],
		});

		this.blurPipeline = device.createRenderPipeline({
			label: "ssao-blur-pipeline",
			layout: device.createPipelineLayout({ bindGroupLayouts: [this.blurBindGroupLayout] }),
			vertex: { module: blurShader, entryPoint: "vs_main" },
			fragment: {
				module: blurShader,
				entryPoint: "fs_blur",
				targets: [{ format: "r8unorm" }],
			},
			primitive: { topology: "triangle-strip" },
		});

		this.blurUniformBuffer = device.createBuffer({
			label: "ssao-blur-uniforms",
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		this.sampler = device.createSampler({
			label: "ssao-sampler",
			magFilter: "linear",
			minFilter: "linear",
			addressModeU: "repeat",
			addressModeV: "repeat",
		});
	}

	public render(
		commandEncoder: GPUCommandEncoder,
		depthView: GPUTextureView,
		normalView: GPUTextureView,
		rawAOView: GPUTextureView,
		finalAOView: GPUTextureView,
		options: SSAOPassOptions,
	): void {
		const invProj = options.invProjMatrix ?? Matrix4Math.invert(options.projMatrix);

		// Pack SSAO uniforms
		const uBuf = new Float32Array(64);
		uBuf.set(options.projMatrix, 0);
		uBuf.set(invProj, 16);
		uBuf.set(options.viewMatrix, 32);
		uBuf[48] = options.radius ?? 45;
		uBuf[49] = options.bias ?? 0.025;
		uBuf[50] = options.intensity ?? 1.5;
		new Uint32Array(uBuf.buffer)[51] = options.kernelSamples ?? 16;
		uBuf[52] = options.width;
		uBuf[53] = options.height;

		this.device.queue.writeBuffer(this.ssaoUniformBuffer, 0, uBuf);

		const ssaoBG = this.device.createBindGroup({
			label: "ssao-eval-bg",
			layout: this.ssaoBindGroupLayout,
			entries: [
				{ binding: 0, resource: depthView },
				{ binding: 1, resource: normalView },
				{ binding: 2, resource: this.noiseTexture.createView() },
				{ binding: 3, resource: this.sampler },
				{ binding: 4, resource: { buffer: this.kernelBuffer } },
				{ binding: 5, resource: { buffer: this.ssaoUniformBuffer } },
			],
		});

		// Pass 1: SSAO Evaluation
		const pass1 = commandEncoder.beginRenderPass({
			label: "ssao-eval-pass",
			colorAttachments: [
				{
					view: rawAOView,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 1, g: 1, b: 1, a: 1 },
				},
			],
		});
		pass1.setPipeline(this.ssaoPipeline);
		pass1.setBindGroup(0, ssaoBG);
		pass1.draw(4);
		pass1.end();

		// Pack Blur Uniforms
		const bBuf = new ArrayBuffer(32);
		const bf32 = new Float32Array(bBuf);
		const bi32 = new Int32Array(bBuf);
		bf32[0] = options.width;
		bf32[1] = options.height;
		bi32[2] = options.blurRadius ?? 4;
		bf32[3] = options.depthThreshold ?? 0.05;

		this.device.queue.writeBuffer(this.blurUniformBuffer, 0, bBuf);

		const blurBG = this.device.createBindGroup({
			label: "ssao-blur-bg",
			layout: this.blurBindGroupLayout,
			entries: [
				{ binding: 0, resource: rawAOView },
				{ binding: 1, resource: depthView },
				{ binding: 2, resource: this.sampler },
				{ binding: 3, resource: { buffer: this.blurUniformBuffer } },
			],
		});

		// Pass 2: Bilateral Blur
		const pass2 = commandEncoder.beginRenderPass({
			label: "ssao-blur-pass",
			colorAttachments: [
				{
					view: finalAOView,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 1, g: 1, b: 1, a: 1 },
				},
			],
		});
		pass2.setPipeline(this.blurPipeline);
		pass2.setBindGroup(0, blurBG);
		pass2.draw(4);
		pass2.end();
	}

	public destroy(): void {
		this.ssaoUniformBuffer.destroy();
		this.blurUniformBuffer.destroy();
		this.noiseTexture.destroy();
	}
}
