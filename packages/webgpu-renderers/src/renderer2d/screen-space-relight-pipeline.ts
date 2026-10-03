/**
 * @file renderer2d/screen-space-relight-pipeline.ts
 * WebGPU Render Pipeline for Screen-Space Normal 3D Relighting
 * Evaluates dynamic scene lights (Ambient, Directional, Point, Spot) against 2D albedo
 * and surface normal maps in real-time.
 */

import type { NormalRelightingOptions } from "@gitframes/core";
import { screenSpaceRelightWgsl } from "../shaders/screen-space-relight.js";
import { BufferPool } from "./buffer-pool.js";

export interface ScreenSpaceRelightExecuteOpts {
	viewportWidth: number;
	viewportHeight: number;
	layerX?: number;
	layerY?: number;
	roughness?: number;
	specularStrength?: number;
	metallic?: number;
	ambientIntensity?: number;
	depthScale?: number;
	opacity?: number;
}

export class ScreenSpaceRelightPipeline {
	private device: GPUDevice;
	public format: GPUTextureFormat;
	public materialLayout: GPUBindGroupLayout;
	public lightsLayout: GPUBindGroupLayout;
	public texturesLayout: GPUBindGroupLayout;
	public pipeline: GPURenderPipeline;
	private materialPool: BufferPool;
	private linearSampler: GPUSampler;
	private defaultFlatNormalTex?: GPUTexture;

	constructor(device: GPUDevice, format: GPUTextureFormat = "rgba8unorm") {
		this.device = device;
		this.format = format;

		this.materialPool = new BufferPool(
			64,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		this.linearSampler = device.createSampler({
			label: "relight_linear_sampler",
			magFilter: "linear",
			minFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
		});

		this.materialLayout = device.createBindGroupLayout({
			label: "relight_material_layout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		this.lightsLayout = device.createBindGroupLayout({
			label: "relight_lights_layout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		this.texturesLayout = device.createBindGroupLayout({
			label: "relight_textures_layout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
				{
					binding: 3,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				},
			],
		});

		const shaderModule = device.createShaderModule({
			label: "screen_space_relight.wgsl",
			code: screenSpaceRelightWgsl,
		});

		const pipelineLayout = device.createPipelineLayout({
			label: "screen_space_relight_pipeline_layout",
			bindGroupLayouts: [
				this.materialLayout,
				this.lightsLayout,
				this.texturesLayout,
			],
		});

		this.pipeline = device.createRenderPipeline({
			label: "ScreenSpaceRelightPipeline",
			layout: pipelineLayout,
			vertex: {
				module: shaderModule,
				entryPoint: "vs",
			},
			fragment: {
				module: shaderModule,
				entryPoint: "fs",
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
			primitive: {
				topology: "triangle-strip",
			},
		});
	}

	public getOrCreateDefaultFlatNormalTexture(): GPUTexture {
		if (!this.defaultFlatNormalTex) {
			this.defaultFlatNormalTex = this.device.createTexture({
				label: "default_flat_normal",
				size: [2, 2],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			// Flat normal pointing along Z+: (0, 0, 1) -> encoded as (128, 128, 255, 255)
			const flatNormals = new Uint8Array([
				128, 128, 255, 255,
				128, 128, 255, 255,
				128, 128, 255, 255,
				128, 128, 255, 255,
			]);
			this.device.queue.writeTexture(
				{ texture: this.defaultFlatNormalTex },
				flatNormals,
				{ bytesPerRow: 8, rowsPerImage: 2 },
				[2, 2],
			);
		}
		return this.defaultFlatNormalTex;
	}

	public resetPools(): void {
		this.materialPool.reset();
	}

	public execute(
		encoder: GPUCommandEncoder,
		targetView: GPUTextureView,
		albedoTexture: GPUTexture,
		normalTexture: GPUTexture | undefined,
		lightsBuffer: GPUBuffer,
		options: ScreenSpaceRelightExecuteOpts,
		loadOp: GPULoadOp = "clear",
	): void {
		const matData = new Float32Array(16);
		matData[0] = options.roughness ?? 0.35;
		matData[1] = options.specularStrength ?? 0.7;
		matData[2] = options.metallic ?? 0.0;
		matData[3] = options.ambientIntensity ?? 0.5;

		matData[4] = options.depthScale ?? 1.0;
		matData[5] = 0.0; // depthInvert
		matData[6] = normalTexture ? 1.0 : 0.0;
		matData[7] = 0.0; // volumetricDensity

		matData[8] = options.viewportWidth;
		matData[9] = options.viewportHeight;
		matData[10] = 32.0; // shininess
		matData[11] = options.opacity ?? 1.0;

		matData[12] = options.layerX ?? 0.0;
		matData[13] = options.layerY ?? 0.0;
		matData[14] = 0.0;
		matData[15] = 0.0;

		const matBuffer = this.materialPool.getBuffer(
			this.device,
			matData,
			"relight_mat_buffer",
		);

		const matBindGroup = this.device.createBindGroup({
			layout: this.materialLayout,
			entries: [{ binding: 0, resource: { buffer: matBuffer } }],
		});

		const lightsBindGroup = this.device.createBindGroup({
			layout: this.lightsLayout,
			entries: [{ binding: 0, resource: { buffer: lightsBuffer } }],
		});

		const actualNormalTex =
			normalTexture ?? this.getOrCreateDefaultFlatNormalTexture();

		const texturesBindGroup = this.device.createBindGroup({
			layout: this.texturesLayout,
			entries: [
				{ binding: 0, resource: albedoTexture.createView() },
				{ binding: 1, resource: this.linearSampler },
				{ binding: 2, resource: actualNormalTex.createView() },
				{ binding: 3, resource: this.linearSampler },
			],
		});

		const pass = encoder.beginRenderPass({
			label: "screen_space_relight_render_pass",
			colorAttachments: [
				{
					view: targetView,
					loadOp,
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});

		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, matBindGroup);
		pass.setBindGroup(1, lightsBindGroup);
		pass.setBindGroup(2, texturesBindGroup);
		pass.draw(4, 1, 0, 0);
		pass.end();
	}

	public destroy(): void {
		this.materialPool.destroy();
		this.defaultFlatNormalTex?.destroy();
	}
}
