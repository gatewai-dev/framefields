import type { Mat4 } from "../math3d/index.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";
import { slugVelocityWgsl } from "../shaders/mesh-velocity.js";
import { slug3dWgsl } from "../shaders/slug3d.js";
import type { SlugFont } from "../slug/slug-loader.js";
import { fullCoverageView, matteLayoutEntry } from "./matte3d.js";
import { VELOCITY_DEPTH_FORMAT, VELOCITY_FORMAT } from "./mesh3d-pipeline.js";
import {
	BloomPipelineVariants,
	createBasePipelines,
	type PipelineVariantBase,
} from "./pipeline-variants.js";
import {
	type MaterialUniformData,
	packMaterialParams,
} from "./quad3d-pipeline.js";
import { packSurfaceParams, SURFACE_PARAMS_FLOATS } from "./surface-params.js";

export interface Slug3DUniformData extends MaterialUniformData {
	/** Paragraph px to world */
	modelMatrix: Mat4;
	normalMatrix: Mat4;
	opacity: number;
	/** Synthetic italic shear */
	slant: number;
	twoSided: boolean;
	/** Fraction of the distance to the eye the glyphs slide toward it, to stack on their plane */
	depthPull: number;
	/** Screen-space track matte: the text shows where this texture's alpha does. */
	matte?: GPUTexture;
}

const INSTANCE_FLOATS = 24;

/** A text batch's motion for the velocity pass: this and the previous frame. */
export interface SlugMotionData {
	modelMatrix: Mat4;
	prevModelMatrix: Mat4;
	/** The previous frame's glyph records (same glyphs, same order); absent = unchanged. */
	prevInstances?: Float32Array;
	opacity: number;
	slant: number;
	depthPull: number;
}

/** The glyph record attributes, at shader locations 0..5. */
const INSTANCE_ATTRIBUTES: GPUVertexAttribute[] = [
	{ shaderLocation: 0, offset: 0, format: "float32x4" }, // aScaleBias
	{ shaderLocation: 1, offset: 16, format: "float32x4" }, // aGlyphBandScale
	{ shaderLocation: 2, offset: 32, format: "float32x4" }, // aBandMaxTexCoords
	{ shaderLocation: 3, offset: 48, format: "float32x4" }, // aAnim
	{ shaderLocation: 4, offset: 64, format: "float32x4" }, // aColor
	{ shaderLocation: 5, offset: 80, format: "float32x4" }, // aExtraParams
];

/** Slug glyphs in the 3D pass: depth-tested, lit and resolution independent. */
export class Slug3DPipeline {
	private device: GPUDevice;
	private pipelineSingle: GPURenderPipeline;
	private pipelineMrt: GPURenderPipeline;
	private bloomVariants: BloomPipelineVariants;
	private modelLayout: GPUBindGroupLayout;
	private fontLayout: GPUBindGroupLayout;
	private modelPool: BufferPool;
	private instancePool: BufferPool;
	private fontBindGroups = new WeakMap<GPUTexture, GPUBindGroup>();
	private motionPool: BufferPool;
	private velocity?: {
		pipeline: GPURenderPipeline;
		layout: GPUBindGroupLayout;
	};
	// Transform, draw/material params and the shared surface block.
	private modelData = new Float32Array(40 + SURFACE_PARAMS_FLOATS);

	constructor(
		device: GPUDevice,
		format: GPUTextureFormat,
		depthFormat: GPUTextureFormat,
		cameraLayout: GPUBindGroupLayout,
		lightsLayout: GPUBindGroupLayout,
		/** Samples per pixel of the pass this draws into (MSAA). */
		sampleCount = 1,
	) {
		this.device = device;
		this.modelPool = new BufferPool(
			(40 + SURFACE_PARAMS_FLOATS) * 4,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.instancePool = new BufferPool(
			65536,
			GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		);
		this.motionPool = new BufferPool(
			36 * 4,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		const module = device.createShaderModule({
			label: "slug3d.wgsl",
			code: slug3dWgsl,
		});

		this.modelLayout = device.createBindGroupLayout({
			label: "Slug3DModelLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
				matteLayoutEntry(1),
			],
		});

		this.fontLayout = device.createBindGroupLayout({
			label: "Slug3DFontLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "unfilterable-float" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "uint" },
				},
			],
		});

		const layout = device.createPipelineLayout({
			bindGroupLayouts: [
				cameraLayout,
				this.modelLayout,
				this.fontLayout,
				lightsLayout,
			],
		});

		const vertex: GPUVertexState = {
			module,
			entryPoint: "vs",
			buffers: [
				{
					arrayStride: INSTANCE_FLOATS * 4,
					stepMode: "instance",
					attributes: INSTANCE_ATTRIBUTES,
				},
			],
		};

		const depthStencil: GPUDepthStencilState = {
			format: depthFormat,
			depthWriteEnabled: true,
			depthCompare: "less-equal",
		};
		const primitive: GPUPrimitiveState = {
			topology: "triangle-list",
			cullMode: "none",
		};
		const multisample: GPUMultisampleState = { count: sampleCount };

		const base: PipelineVariantBase = {
			label: "Slug3DPipeline",
			layout,
			vertex,
			module,
			format,
			depthStencil,
			primitive,
			multisample,
		};
		const { single, mrt } = createBasePipelines(device, base);
		this.pipelineSingle = single;
		this.pipelineMrt = mrt;
		this.bloomVariants = new BloomPipelineVariants(device, base);
	}

	resetPools(): void {
		this.modelPool.reset();
		this.instancePool.reset();
		this.motionPool.reset();
	}

	/**
	 * Draws a text batch's screen motion into a velocity pass: its glyphs
	 * placed with this and the previous frame's plane and glyph animation,
	 * written where the outline covers the pixel.
	 */
	drawVelocity(
		pass: GPURenderPassEncoder,
		velocityCameraBindGroup: GPUBindGroup,
		velocityCameraLayout: GPUBindGroupLayout,
		font: SlugFont,
		instances: Float32Array,
		instanceCount: number,
		data: SlugMotionData,
	): void {
		if (instanceCount === 0 || !font.curvesTex || !font.bandsTex) return;
		const velocity = this.velocityPipeline(velocityCameraLayout);
		const motion = new Float32Array(36);
		motion.set(data.modelMatrix, 0);
		motion.set(data.prevModelMatrix, 16);
		motion[32] = data.opacity;
		motion[33] = data.slant;
		motion[35] = data.depthPull;
		const group = this.device.createBindGroup({
			layout: velocity.layout,
			entries: [
				{
					binding: 0,
					resource: { buffer: this.motionPool.getBuffer(this.device, motion) },
				},
			],
		});
		const floats = instanceCount * INSTANCE_FLOATS;
		const now = this.instancePool.getBuffer(
			this.device,
			instances.subarray(0, floats),
		);
		const before = data.prevInstances
			? this.instancePool.getBuffer(
					this.device,
					data.prevInstances.subarray(0, floats),
				)
			: now;
		pass.setPipeline(velocity.pipeline);
		pass.setBindGroup(0, velocityCameraBindGroup);
		pass.setBindGroup(1, group);
		pass.setBindGroup(2, this.fontBindGroup(font.curvesTex, font.bandsTex));
		pass.setVertexBuffer(0, now);
		pass.setVertexBuffer(1, before);
		pass.draw(6, instanceCount);
	}

	private velocityPipeline(cameraLayout: GPUBindGroupLayout): {
		pipeline: GPURenderPipeline;
		layout: GPUBindGroupLayout;
	} {
		if (this.velocity) return this.velocity;
		const module = this.device.createShaderModule({
			label: "slug-velocity.wgsl",
			code: slugVelocityWgsl,
		});
		const layout = this.device.createBindGroupLayout({
			label: "Slug3DVelocityLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});
		const pipeline = this.device.createRenderPipeline({
			label: "Slug3DVelocity",
			layout: this.device.createPipelineLayout({
				bindGroupLayouts: [cameraLayout, layout, this.fontLayout],
			}),
			vertex: {
				module,
				entryPoint: "vs_slug_velocity",
				buffers: [
					{
						arrayStride: INSTANCE_FLOATS * 4,
						stepMode: "instance",
						attributes: INSTANCE_ATTRIBUTES.filter(
							(a) => a.shaderLocation !== 5,
						),
					},
					{
						arrayStride: INSTANCE_FLOATS * 4,
						stepMode: "instance",
						attributes: [
							{ shaderLocation: 6, offset: 0, format: "float32x4" },
							{ shaderLocation: 7, offset: 48, format: "float32x4" },
						],
					},
				],
			},
			fragment: {
				module,
				entryPoint: "fs_slug_velocity",
				targets: [{ format: VELOCITY_FORMAT }],
			},
			depthStencil: {
				format: VELOCITY_DEPTH_FORMAT,
				depthWriteEnabled: true,
				depthCompare: "less-equal",
			},
			primitive: { topology: "triangle-list", cullMode: "none" },
		});
		this.velocity = { pipeline, layout };
		return this.velocity;
	}

	draw(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		font: SlugFont,
		instances: Float32Array,
		instanceCount: number,
		data: Slug3DUniformData,
		useMrt = false,
		useBloom = false,
	): void {
		if (instanceCount === 0 || !font.curvesTex || !font.bandsTex) return;

		this.modelData.set(data.modelMatrix, 0);
		this.modelData.set(data.normalMatrix, 16);
		this.modelData[32] = data.opacity;
		this.modelData[33] = data.slant;
		this.modelData[34] = data.twoSided ? 1.0 : 0.0;
		this.modelData[35] = data.depthPull;
		this.modelData.set(packMaterialParams(data), 36);
		packSurfaceParams(data, this.modelData, 40);

		const modelBuffer = this.modelPool.getBuffer(this.device, this.modelData);
		const modelBindGroup = this.device.createBindGroup({
			layout: this.modelLayout,
			entries: [
				{ binding: 0, resource: { buffer: modelBuffer } },
				{
					binding: 1,
					resource: data.matte?.createView() ?? fullCoverageView(this.device),
				},
			],
		});
		const instanceBuffer = this.instancePool.getBuffer(
			this.device,
			instances.subarray(0, instanceCount * INSTANCE_FLOATS),
		);

		pass.setPipeline(
			useBloom
				? this.bloomVariants.get(useMrt)
				: useMrt
					? this.pipelineMrt
					: this.pipelineSingle,
		);
		pass.setBindGroup(0, cameraBindGroup);
		pass.setBindGroup(1, modelBindGroup);
		pass.setBindGroup(2, this.fontBindGroup(font.curvesTex, font.bandsTex));
		pass.setBindGroup(3, lightsBindGroup);
		pass.setVertexBuffer(0, instanceBuffer);
		pass.draw(6, instanceCount);
	}

	/** A font's textures live as long as the font: bind them once, not per draw. */
	private fontBindGroup(curves: GPUTexture, bands: GPUTexture): GPUBindGroup {
		let bindGroup = this.fontBindGroups.get(curves);
		if (!bindGroup) {
			bindGroup = this.device.createBindGroup({
				layout: this.fontLayout,
				entries: [
					{ binding: 0, resource: curves.createView() },
					{ binding: 1, resource: bands.createView() },
				],
			});
			this.fontBindGroups.set(curves, bindGroup);
		}
		return bindGroup;
	}

	destroy(): void {
		this.modelPool.destroy();
		this.instancePool.destroy();
		this.motionPool.destroy();
	}
}
