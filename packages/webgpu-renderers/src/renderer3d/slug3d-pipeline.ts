import type { Mat4 } from "../math3d/index.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";
import { slug3dWgsl } from "../shaders/slug3d.js";
import type { SlugFont } from "../slug/slug-loader.js";
import { fullCoverageView, matteLayoutEntry } from "./matte3d.js";
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
					attributes: [
						{ shaderLocation: 0, offset: 0, format: "float32x4" }, // aScaleBias
						{ shaderLocation: 1, offset: 16, format: "float32x4" }, // aGlyphBandScale
						{ shaderLocation: 2, offset: 32, format: "float32x4" }, // aBandMaxTexCoords
						{ shaderLocation: 3, offset: 48, format: "float32x4" }, // aAnim
						{ shaderLocation: 4, offset: 64, format: "float32x4" }, // aColor
						{ shaderLocation: 5, offset: 80, format: "float32x4" }, // aExtraParams
					],
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
	}
}
