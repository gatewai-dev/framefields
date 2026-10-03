/**
 * @file renderer3d/glass-pipeline.ts
 * @module @gitframes/webgpu-renderers/renderer3d/glass-pipeline
 *
 * WebGPU Pipeline for PBR Glass, Acrylic, Frosted & Metallic Refraction rendering.
 */

import { BufferPool } from "../renderer2d/buffer-pool.js";
import { pbrGlassWgsl } from "../shaders/pbr-glass.js";

export interface GlassUniformData {
	ior?: number;
	roughness?: number;
	f0?: number;
	transmission?: number;
	dispersion?: number;
	envIntensity?: number;
	fresnelPower?: number;
	viewportWidth: number;
	viewportHeight: number;
	tintColor?: [number, number, number, number];
	modelMatrix: Float32Array | number[];
	normalMatrix?: Float32Array | number[];
	colorTint?: [number, number, number, number];
	opacity?: number;
}

export class GlassPipeline {
	private device: GPUDevice;
	public pipeline: GPURenderPipeline;
	public cameraLayout: GPUBindGroupLayout;
	public modelLayout: GPUBindGroupLayout;
	public glassLayout: GPUBindGroupLayout;
	public backdropLayout: GPUBindGroupLayout;
	private modelPool: BufferPool;
	private glassPool: BufferPool;
	private vertexBuffer: GPUBuffer;
	private indexBuffer: GPUBuffer;

	// Model data: 16 (model) + 16 (norm) + 4 (tint) + 4 (params) = 40 floats (160 bytes)
	private modelData = new Float32Array(40);
	// Glass data: 16 floats (64 bytes)
	private glassData = new Float32Array(16);

	constructor(
		device: GPUDevice,
		format: GPUTextureFormat,
		depthFormat: GPUTextureFormat = "depth24plus",
		cameraLayout?: GPUBindGroupLayout,
	) {
		this.device = device;
		this.modelPool = new BufferPool(
			160,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.glassPool = new BufferPool(
			64,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		const module = device.createShaderModule({
			label: "pbr-glass.wgsl",
			code: pbrGlassWgsl,
		});

		this.cameraLayout =
			cameraLayout ??
			device.createBindGroupLayout({
				label: "GlassCameraLayout",
				entries: [
					{
						binding: 0,
						visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
						buffer: { type: "uniform" },
					},
				],
			});

		this.modelLayout = device.createBindGroupLayout({
			label: "GlassModelLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		this.glassLayout = device.createBindGroupLayout({
			label: "GlassUniformLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		this.backdropLayout = device.createBindGroupLayout({
			label: "GlassBackdropLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
			],
		});

		const pipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: [
				this.cameraLayout,
				this.modelLayout,
				this.glassLayout,
				this.backdropLayout,
			],
		});

		this.pipeline = device.createRenderPipeline({
			label: "PBRGlassPipeline",
			layout: pipelineLayout,
			vertex: {
				module,
				entryPoint: "vs_main",
				buffers: [
					{
						arrayStride: 32, // 3 floats (pos) + 2 floats (uv) + 3 floats (normal) = 32 bytes
						attributes: [
							{ shaderLocation: 0, offset: 0, format: "float32x3" },
							{ shaderLocation: 1, offset: 12, format: "float32x2" },
							{ shaderLocation: 2, offset: 20, format: "float32x3" },
						],
					},
				],
			},
			fragment: {
				module,
				entryPoint: "fs_main",
				targets: [
					{
						format,
						blend: {
							color: {
								srcFactor: "one",
								dstFactor: "one-minus-src-alpha",
								operation: "add",
							},
							alpha: {
								srcFactor: "one",
								dstFactor: "one-minus-src-alpha",
								operation: "add",
							},
						},
					},
				],
			},
			depthStencil: {
				format: depthFormat,
				depthWriteEnabled: true,
				depthCompare: "less-equal",
			},
			primitive: {
				topology: "triangle-list",
				cullMode: "none",
			},
		});

		// Unit quad centered at origin [-0.5, -0.5] to [0.5, 0.5]
		const vertices = new Float32Array([
			-0.5, -0.5, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0,
			 0.5, -0.5, 0.0, 1.0, 0.0, 0.0, 0.0, -1.0,
			 0.5,  0.5, 0.0, 1.0, 1.0, 0.0, 0.0, -1.0,
			-0.5,  0.5, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0,
		]);
		const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

		this.vertexBuffer = device.createBuffer({
			size: vertices.byteLength,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});
		new Float32Array(this.vertexBuffer.getMappedRange()).set(vertices);
		this.vertexBuffer.unmap();

		this.indexBuffer = device.createBuffer({
			size: indices.byteLength,
			usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});
		new Uint16Array(this.indexBuffer.getMappedRange()).set(indices);
		this.indexBuffer.unmap();
	}

	resetPools(): void {
		this.modelPool.reset();
		this.glassPool.reset();
	}

	draw(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		backdropTexture: GPUTexture,
		sampler: GPUSampler,
		data: GlassUniformData,
	): void {
		// Pack model uniforms
		const mat = data.modelMatrix;
		for (let i = 0; i < 16; i++) {
			this.modelData[i] = mat[i] ?? 0;
		}

		const norm = data.normalMatrix ?? mat;
		for (let i = 0; i < 16; i++) {
			this.modelData[16 + i] = norm[i] ?? 0;
		}

		const tint = data.colorTint ?? [1, 1, 1, 1];
		this.modelData[32] = tint[0];
		this.modelData[33] = tint[1];
		this.modelData[34] = tint[2];
		this.modelData[35] = tint[3];

		this.modelData[36] = data.opacity ?? 1.0;
		this.modelData[37] = 0;
		this.modelData[38] = 1.0; // twoSided
		this.modelData[39] = 0;

		const modelBuffer = this.modelPool.getBuffer(
			this.device,
			this.modelData,
		);

		// Pack glass uniforms
		this.glassData[0] = data.ior ?? 1.49;
		this.glassData[1] = data.roughness ?? 0.15;
		this.glassData[2] = data.f0 ?? 0.04;
		this.glassData[3] = data.transmission ?? 0.92;

		this.glassData[4] = data.dispersion ?? 0.015;
		this.glassData[5] = data.envIntensity ?? 0.65;
		this.glassData[6] = data.fresnelPower ?? 5.0;
		this.glassData[7] = 0;

		this.glassData[8] = data.viewportWidth;
		this.glassData[9] = data.viewportHeight;
		this.glassData[10] = 0;
		this.glassData[11] = 0;

		const glassTint = data.tintColor ?? [1, 1, 1, 1];
		this.glassData[12] = glassTint[0];
		this.glassData[13] = glassTint[1];
		this.glassData[14] = glassTint[2];
		this.glassData[15] = glassTint[3];

		const glassBuffer = this.glassPool.getBuffer(
			this.device,
			this.glassData,
		);

		const modelBindGroup = this.device.createBindGroup({
			layout: this.modelLayout,
			entries: [{ binding: 0, resource: { buffer: modelBuffer } }],
		});

		const glassBindGroup = this.device.createBindGroup({
			layout: this.glassLayout,
			entries: [{ binding: 0, resource: { buffer: glassBuffer } }],
		});

		const backdropBindGroup = this.device.createBindGroup({
			layout: this.backdropLayout,
			entries: [
				{ binding: 0, resource: sampler },
				{ binding: 1, resource: backdropTexture.createView() },
			],
		});

		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, cameraBindGroup);
		pass.setBindGroup(1, modelBindGroup);
		pass.setBindGroup(2, glassBindGroup);
		pass.setBindGroup(3, backdropBindGroup);
		pass.setVertexBuffer(0, this.vertexBuffer);
		pass.setIndexBuffer(this.indexBuffer, "uint16");
		pass.drawIndexed(6);
	}

	destroy(): void {
		this.modelPool.destroy();
		this.glassPool.destroy();
		this.vertexBuffer.destroy();
		this.indexBuffer.destroy();
	}
}
