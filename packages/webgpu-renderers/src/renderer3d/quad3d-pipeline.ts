import { BufferPool } from "../renderer2d/buffer-pool.js";
import { quad3dWgsl } from "../shaders/quad3d.js";
import { fullCoverageView, matteLayoutEntry } from "./matte3d.js";
import {
	BloomPipelineVariants,
	createBasePipelines,
	type PipelineVariantBase,
	writeModelTransform,
} from "./pipeline-variants.js";
import { SHADOW_DEPTH_STENCIL } from "./shadow-depth.js";
import {
	packSurfaceParams,
	SURFACE_PARAMS_FLOATS,
	type SurfaceParams,
} from "./surface-params.js";

/**
 * Group 3 of every lit 3D shader: the lights uniform, then the shadow map and
 * its comparison sampler (a 1×1 cleared map when no light casts shadows).
 */
export function createLightsLayout(
	device: GPUDevice,
	label = "Lights3DLayout",
): GPUBindGroupLayout {
	return device.createBindGroupLayout({
		label,
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "depth", viewDimension: "2d-array" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "comparison" },
			},
			{
				binding: 3,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "read-only-storage" },
			},
		],
	});
}

export interface ModelUniformData extends SurfaceParams {
	modelMatrix: Float32Array | number[];
	normalMatrix?: Float32Array | number[];
	colorTint?: [number, number, number, number];
	borderColor?: [number, number, number, number];
	borderWidth?: number;
	opacity?: number;
	borderRadius?: number;
	twoSided?: boolean;
	width?: number;
	height?: number;
	/** Fraction of the texture the layer covers, [u, v] (default the whole texture) */
	textureExtent?: [number, number];
	material?: "lit" | "unlit";
	/** Screen-space track matte: the layer shows where this texture's alpha does. */
	matte?: GPUTexture;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	ambientIntensity?: number;
	metallic?: number;
}

export type MaterialUniformData = Pick<
	ModelUniformData,
	| "material"
	| "shininess"
	| "roughness"
	| "specularIntensity"
	| "ambientIntensity"
	| "metallic"
	| "emissive"
	| "emissiveIntensity"
>;

/** [shininess, specularIntensity, ambientIntensity, materialMode] as the 3D shaders' lighting reads them. */
export function packMaterialParams(
	data: MaterialUniformData,
): [number, number, number, number] {
	const shininess =
		data.roughness !== undefined
			? Math.max(1, (1 - data.roughness) * 128)
			: (data.shininess ?? 32.0);
	const specInt =
		data.metallic !== undefined
			? data.metallic
			: (data.specularIntensity ?? 0.5);
	const ambientInt = data.ambientIntensity ?? 1.0;
	const materialMode = data.material === "unlit" ? 0.0 : 1.0;
	return [shininess, specInt, ambientInt, materialMode];
}

export class Quad3DPipeline {
	private device: GPUDevice;
	public pipelineSingle: GPURenderPipeline;
	public pipelineMrt: GPURenderPipeline;
	private bloomVariants: BloomPipelineVariants;
	/** Depth-only, alpha-tested: draws a caster into a shadow map. */
	public pipelineShadow: GPURenderPipeline;
	public cameraLayout: GPUBindGroupLayout;
	public modelLayout: GPUBindGroupLayout;
	public textureLayout: GPUBindGroupLayout;
	public lightsLayout: GPUBindGroupLayout;
	private modelPool: BufferPool;
	private vertexBuffer: GPUBuffer;
	private indexBuffer: GPUBuffer;
	// 16 (model) + 16 (normal) + 4 (tint) + 4 (borderColor) + 4 (params) + 4 (dimensions) + 4 (materialParams) + 8 (pbr, emissive) = 60 floats (240 bytes)
	private modelData = new Float32Array(52 + SURFACE_PARAMS_FLOATS);

	constructor(
		device: GPUDevice,
		format: GPUTextureFormat,
		depthFormat: GPUTextureFormat = "depth24plus",
		/** Samples per pixel of the pass this draws into (MSAA). */
		sampleCount = 1,
	) {
		this.device = device;
		this.modelPool = new BufferPool(
			(52 + SURFACE_PARAMS_FLOATS) * 4,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		const module = device.createShaderModule({
			label: "quad3d.wgsl",
			code: quad3dWgsl,
		});

		this.cameraLayout = device.createBindGroupLayout({
			label: "Quad3DCameraLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		this.modelLayout = device.createBindGroupLayout({
			label: "Quad3DModelLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
				matteLayoutEntry(1),
			],
		});

		this.textureLayout = device.createBindGroupLayout({
			label: "Quad3DTextureLayout",
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

		this.lightsLayout = createLightsLayout(device, "Quad3DLightsLayout");

		const pipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: [
				this.cameraLayout,
				this.modelLayout,
				this.textureLayout,
				this.lightsLayout,
			],
		});

		const vertexState: GPUVertexState = {
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
		};

		const base: PipelineVariantBase = {
			label: "Quad3DPipeline",
			layout: pipelineLayout,
			vertex: vertexState,
			module,
			format,
			depthStencil: {
				format: depthFormat,
				depthWriteEnabled: true,
				depthCompare: "less-equal",
			},
			primitive: { topology: "triangle-list", cullMode: "none" },
			multisample: { count: sampleCount },
		};
		const { single, mrt } = createBasePipelines(device, base);
		this.pipelineSingle = single;
		this.pipelineMrt = mrt;
		this.bloomVariants = new BloomPipelineVariants(device, base);

		this.pipelineShadow = device.createRenderPipeline({
			label: "Quad3DPipelineShadow",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					this.cameraLayout,
					this.modelLayout,
					this.textureLayout,
				],
			}),
			vertex: vertexState,
			fragment: { module, entryPoint: "fs_shadow", targets: [] },
			depthStencil: SHADOW_DEPTH_STENCIL,
			primitive: { topology: "triangle-list", cullMode: "none" },
		});

		const vertices = new Float32Array([
			-0.5, -0.5, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.5, -0.5, 0.0, 1.0, 0.0, 0.0,
			0.0, -1.0, 0.5, 0.5, 0.0, 1.0, 1.0, 0.0, 0.0, -1.0, -0.5, 0.5, 0.0, 0.0,
			1.0, 0.0, 0.0, -1.0,
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
	}

	private packModel(data: ModelUniformData): GPUBindGroup {
		writeModelTransform(
			this.modelData,
			data.modelMatrix,
			data.normalMatrix,
			data.colorTint,
		);

		const bColor = data.borderColor ?? [0, 0, 0, 0];
		this.modelData[36] = bColor[0];
		this.modelData[37] = bColor[1];
		this.modelData[38] = bColor[2];
		this.modelData[39] = bColor[3];

		this.modelData[40] = data.opacity ?? 1.0;
		this.modelData[41] = data.borderRadius ?? 0;
		this.modelData[42] = data.twoSided ? 1.0 : 0.0;
		this.modelData[43] = data.borderWidth ?? 0;

		this.modelData[44] = data.width ?? 0;
		this.modelData[45] = data.height ?? 0;
		this.modelData[46] = data.textureExtent?.[0] ?? 0;
		this.modelData[47] = data.textureExtent?.[1] ?? 0;

		this.modelData.set(packMaterialParams(data), 48);
		packSurfaceParams(data, this.modelData, 52);

		const modelBuffer = this.modelPool.getBuffer(this.device, this.modelData);
		return this.device.createBindGroup({
			layout: this.modelLayout,
			entries: [
				{ binding: 0, resource: { buffer: modelBuffer } },
				{
					binding: 1,
					resource: data.matte?.createView() ?? fullCoverageView(this.device),
				},
			],
		});
	}

	private textureBindGroup(
		texture: GPUTexture,
		sampler: GPUSampler,
	): GPUBindGroup {
		return this.device.createBindGroup({
			layout: this.textureLayout,
			entries: [
				{ binding: 0, resource: sampler },
				{ binding: 1, resource: texture.createView() },
			],
		});
	}

	draw(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		texture: GPUTexture,
		sampler: GPUSampler,
		data: ModelUniformData,
		useMrt = false,
		useBloom = false,
	): void {
		const modelBindGroup = this.packModel(data);
		const textureBindGroup = this.textureBindGroup(texture, sampler);

		pass.setPipeline(
			useBloom
				? this.bloomVariants.get(useMrt)
				: useMrt
					? this.pipelineMrt
					: this.pipelineSingle,
		);
		pass.setBindGroup(0, cameraBindGroup);
		pass.setBindGroup(1, modelBindGroup);
		pass.setBindGroup(2, textureBindGroup);
		pass.setBindGroup(3, lightsBindGroup);
		pass.setVertexBuffer(0, this.vertexBuffer);
		pass.setIndexBuffer(this.indexBuffer, "uint16");
		pass.drawIndexed(6);
	}

	/** Draws the quad into a shadow map (`lightCameraBindGroup` holds the light's view-projection). */
	drawShadow(
		pass: GPURenderPassEncoder,
		lightCameraBindGroup: GPUBindGroup,
		texture: GPUTexture,
		sampler: GPUSampler,
		data: ModelUniformData,
	): void {
		pass.setPipeline(this.pipelineShadow);
		pass.setBindGroup(0, lightCameraBindGroup);
		pass.setBindGroup(1, this.packModel(data));
		pass.setBindGroup(2, this.textureBindGroup(texture, sampler));
		pass.setVertexBuffer(0, this.vertexBuffer);
		pass.setIndexBuffer(this.indexBuffer, "uint16");
		pass.drawIndexed(6);
	}

	destroy(): void {
		this.modelPool.destroy();
		this.vertexBuffer.destroy();
		this.indexBuffer.destroy();
	}
}
