import { BufferPool } from "../renderer2d/buffer-pool.js";
import { mesh3dWgsl } from "../shaders/mesh3d.js";
import { fullCoverageView, matteLayoutEntry } from "./matte3d.js";
import {
	BloomPipelineVariants,
	createBasePipelines,
	type PipelineVariantBase,
	writeModelTransform,
} from "./pipeline-variants.js";
import { createLightsLayout } from "./quad3d-pipeline.js";
import { SHADOW_DEPTH_STENCIL } from "./shadow-depth.js";
import {
	packSurfaceParams,
	SURFACE_PARAMS_FLOATS,
	type SurfaceParams,
} from "./surface-params.js";

/** A mesh material's extra maps (glTF conventions); absent maps are neutral. */
export interface MeshMaterialMaps {
	/** Tangent-space normal map (+Y up). */
	normal?: GPUTexture;
	normalScale?: number;
	/** G = roughness, B = metallic; multiplies the roughness / metallic factors. */
	metallicRoughness?: GPUTexture;
	/** R = ambient occlusion. */
	occlusion?: GPUTexture;
	occlusionStrength?: number;
	/** Multiplies the emissive color. */
	emissive?: GPUTexture;
}

export interface MeshGlass {
	/** Index of refraction (1.5 glass, 1.33 water). */
	ior: number;
	/** Red/blue split of the refraction, 0–0.2 (rainbow fringes). */
	dispersion: number;
	/** How far the backdrop bends at the edges, px. */
	thickness: number;
	/** Frosted blur, 0–1. */
	frost: number;
}

export interface MeshUniformData extends SurfaceParams {
	modelMatrix: Float32Array | number[];
	normalMatrix?: Float32Array | number[];
	colorTint?: [number, number, number, number];
	opacity?: number;
	twoSided?: boolean;
	wireframe?: boolean;
	/** Blend without writing depth; the caller draws transparent meshes back to front. */
	transparent?: boolean;
	isSkinned?: boolean;
	skinningMatrices?: Float32Array; // 128 * 16 floats
	material?: "lit" | "unlit" | "toon";
	/** Screen-space track matte: the mesh shows where this texture's alpha does. */
	matte?: GPUTexture;
	/**
	 * Glass: the surface shows `backdrop` (what is behind it on screen) bent by
	 * refraction, tinted by the color, under Fresnel reflections.
	 */
	glass?: MeshGlass;
	/** Screen-sized picture behind the 3D batch, read by glass. */
	backdrop?: GPUTexture;
	/** Toon shading: the shadowed side's color multiplier. */
	shadeColor?: [number, number, number];
	/** Normal / metallic-roughness / occlusion / emissive maps. */
	maps?: MeshMaterialMaps;
	/** Texels with alpha below this are discarded (glTF MASK). */
	alphaCutoff?: number;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	ambientIntensity?: number;
	metallic?: number;
}

export interface GPUMeshBuffers {
	vertexBuffer: GPUBuffer;
	indexBuffer: GPUBuffer;
	indexCount: number;
	indexFormat: GPUIndexFormat;
	/** Per-vertex RGBA (display / sRGB), 4 floats each; absent = white. */
	colorBuffer?: GPUBuffer;
	wireIndexBuffer?: GPUBuffer;
	wireIndexCount?: number;
}

export class Mesh3DPipeline {
	private device: GPUDevice;
	public pipelineSingle: GPURenderPipeline;
	public pipelineMrt: GPURenderPipeline;
	private bloomVariants: BloomPipelineVariants;
	private wireSingle: GPURenderPipeline;
	private wireMrt: GPURenderPipeline;
	private wireBloom: BloomPipelineVariants;
	private wireShadow: GPURenderPipeline;
	private transparentPipelines: {
		single: GPURenderPipeline;
		mrt: GPURenderPipeline;
		bloom: BloomPipelineVariants;
	};
	private transparentWirePipelines: {
		single: GPURenderPipeline;
		mrt: GPURenderPipeline;
		bloom: BloomPipelineVariants;
	};
	/** Depth only (skinning included): draws a caster into a shadow map. */
	public pipelineShadow: GPURenderPipeline;
	public cameraLayout: GPUBindGroupLayout;
	public modelLayout: GPUBindGroupLayout;
	public textureLayout: GPUBindGroupLayout;
	public lightsLayout: GPUBindGroupLayout;
	private modelPool: BufferPool;
	private skinningPool: BufferPool;
	public defaultWhiteTexture: GPUTexture;
	/** (0.5, 0.5, 1): an unperturbed tangent-space normal. */
	private flatNormalTexture: GPUTexture;
	private defaultSkinningBuffer: GPUBuffer;
	/** White vertex colors for meshes without any, grown to the largest mesh. */
	private whiteColorBuffer: GPUBuffer | null = null;
	private whiteColorCapacity = 0;
	/** Outgrown white buffers: earlier draws this frame may still read them. */
	private retiredColorBuffers: GPUBuffer[] = [];

	// 16 (model) + 16 (normal) + 4 (tint) + 4 (params) + 4 (materialParams) + 4 (shade) + 8 (pbr, emissive) + 4 (maps) = 60 floats (240 bytes)
	private modelData = new Float32Array(52 + SURFACE_PARAMS_FLOATS);

	constructor(
		device: GPUDevice,
		format: GPUTextureFormat,
		depthFormat: GPUTextureFormat = "depth24plus",
		cameraLayout?: GPUBindGroupLayout,
		lightsLayout?: GPUBindGroupLayout,
		/** Samples per pixel of the pass this draws into (MSAA). */
		sampleCount = 1,
	) {
		this.device = device;
		this.modelPool = new BufferPool(
			(52 + SURFACE_PARAMS_FLOATS) * 4,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		// 128 bones * 16 floats * 4 bytes = 8192 bytes
		this.skinningPool = new BufferPool(
			8192,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		const module = device.createShaderModule({
			label: "mesh3d.wgsl",
			code: mesh3dWgsl,
		});

		this.cameraLayout =
			cameraLayout ??
			device.createBindGroupLayout({
				label: "Mesh3DCameraLayout",
				entries: [
					{
						binding: 0,
						visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
						buffer: { type: "uniform" },
					},
				],
			});

		this.modelLayout = device.createBindGroupLayout({
			label: "Mesh3DModelLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.VERTEX,
					buffer: { type: "uniform" },
				},
				matteLayoutEntry(2),
				matteLayoutEntry(3),
			],
		});

		this.textureLayout = device.createBindGroupLayout({
			label: "Mesh3DTextureLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				},
				// 1 base color, 2 normal, 3 metallic-roughness, 4 occlusion, 5 emissive
				...[1, 2, 3, 4, 5].map((binding) => ({
					binding,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" as const },
				})),
			],
		});

		this.lightsLayout =
			lightsLayout ?? createLightsLayout(device, "Mesh3DLightsLayout");

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
					arrayStride: 64, // 3 (pos) + 2 (uv) + 3 (normal) + 4 (joints) + 4 (weights) = 16 floats = 64 bytes
					attributes: [
						{ shaderLocation: 0, offset: 0, format: "float32x3" }, // pos
						{ shaderLocation: 1, offset: 12, format: "float32x2" }, // uv
						{ shaderLocation: 2, offset: 20, format: "float32x3" }, // normal
						{ shaderLocation: 3, offset: 32, format: "float32x4" }, // joints
						{ shaderLocation: 4, offset: 48, format: "float32x4" }, // weights
					],
				},
				{
					arrayStride: 16, // RGBA vertex color
					attributes: [{ shaderLocation: 5, offset: 0, format: "float32x4" }],
				},
			],
		};

		const base: PipelineVariantBase = {
			label: "Mesh3DPipeline",
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
		const wireBase: PipelineVariantBase = {
			...base,
			label: "Mesh3DWireframe",
			primitive: { topology: "line-list" },
		};
		const wire = createBasePipelines(device, wireBase);
		this.wireSingle = wire.single;
		this.wireMrt = wire.mrt;
		this.wireBloom = new BloomPipelineVariants(device, wireBase);
		const transparentBase: PipelineVariantBase = {
			...base,
			label: "Mesh3DTransparent",
			depthStencil: { ...base.depthStencil, depthWriteEnabled: false },
		};
		const transparentWireBase: PipelineVariantBase = {
			...transparentBase,
			label: "Mesh3DTransparentWireframe",
			primitive: wireBase.primitive,
		};
		this.transparentPipelines = {
			...createBasePipelines(device, transparentBase),
			bloom: new BloomPipelineVariants(device, transparentBase),
		};
		this.transparentWirePipelines = {
			...createBasePipelines(device, transparentWireBase),
			bloom: new BloomPipelineVariants(device, transparentWireBase),
		};
		this.wireShadow = device.createRenderPipeline({
			label: "Mesh3DWireframeShadow",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [this.cameraLayout, this.modelLayout],
			}),
			vertex: vertexState,
			// WebGPU prohibits depth bias on line topology.
			depthStencil: {
				format: SHADOW_DEPTH_STENCIL.format,
				depthWriteEnabled: true,
				depthCompare: "less-equal",
			},
			primitive: { topology: "line-list" },
		});

		this.pipelineShadow = device.createRenderPipeline({
			label: "Mesh3DPipelineShadow",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [this.cameraLayout, this.modelLayout],
			}),
			vertex: vertexState,
			depthStencil: SHADOW_DEPTH_STENCIL,
			primitive: { topology: "triangle-list", cullMode: "none" },
		});

		// 1x1 White dummy texture
		this.defaultWhiteTexture = device.createTexture({
			label: "Mesh3DDefaultWhiteTexture",
			size: { width: 1, height: 1 },
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		device.queue.writeTexture(
			{ texture: this.defaultWhiteTexture },
			new Uint8Array([255, 255, 255, 255]),
			{ bytesPerRow: 4, rowsPerImage: 1 },
			{ width: 1, height: 1 },
		);

		this.flatNormalTexture = device.createTexture({
			label: "Mesh3DFlatNormalTexture",
			size: { width: 1, height: 1 },
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		device.queue.writeTexture(
			{ texture: this.flatNormalTexture },
			new Uint8Array([128, 128, 255, 255]),
			{ bytesPerRow: 4, rowsPerImage: 1 },
			{ width: 1, height: 1 },
		);

		// Default identity skinning buffer (128 identity matrices)
		const idMatrices = new Float32Array(128 * 16);
		for (let b = 0; b < 128; b++) {
			idMatrices[b * 16] = 1;
			idMatrices[b * 16 + 5] = 1;
			idMatrices[b * 16 + 10] = 1;
			idMatrices[b * 16 + 15] = 1;
		}
		this.defaultSkinningBuffer = device.createBuffer({
			size: 8192,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});
		new Float32Array(this.defaultSkinningBuffer.getMappedRange()).set(
			idMatrices,
		);
		this.defaultSkinningBuffer.unmap();
	}

	resetPools(): void {
		this.modelPool.reset();
		this.skinningPool.reset();
	}

	private packModel(data: MeshUniformData): GPUBindGroup {
		writeModelTransform(
			this.modelData,
			data.modelMatrix,
			data.normalMatrix,
			data.colorTint,
		);

		this.modelData[36] = data.opacity ?? 1.0;
		this.modelData[37] = data.twoSided ? 1.0 : 0.0;
		this.modelData[38] = data.isSkinned ? 1.0 : 0.0;
		this.modelData[39] = 0;

		const shininess =
			data.roughness !== undefined
				? Math.max(1, (1 - data.roughness) * 128)
				: (data.shininess ?? 32.0);
		const specInt =
			data.metallic !== undefined
				? data.metallic
				: (data.specularIntensity ?? 0.5);
		const ambientInt = data.ambientIntensity ?? 1.0;
		const materialMode =
			data.material === "unlit" ? 0.0 : data.material === "toon" ? 2.0 : 1.0;

		this.modelData[40] = shininess;
		this.modelData[41] = specInt;
		this.modelData[42] = ambientInt;
		this.modelData[43] = materialMode;

		const shade = data.shadeColor ?? [1, 1, 1];
		this.modelData[44] = shade[0];
		this.modelData[45] = shade[1];
		this.modelData[46] = shade[2];
		this.modelData[47] = data.alphaCutoff ?? 0;
		packSurfaceParams(data, this.modelData, 48);
		const maps = data.maps;
		this.modelData[56] = maps?.normal ? (maps.normalScale ?? 1) : 0;
		this.modelData[57] = maps?.occlusion ? (maps.occlusionStrength ?? 1) : 0;
		this.modelData[58] = maps?.metallicRoughness ? 1 : 0;
		this.modelData[59] = maps?.emissive ? 1 : 0;
		const glass = data.glass;
		if (glass) {
			// shade.rgb and pbr.zw are unused outside toon: glass parameters.
			this.modelData[44] = glass.dispersion;
			this.modelData[45] = glass.thickness;
			this.modelData[46] = glass.frost;
			this.modelData[50] = 1;
			this.modelData[51] = glass.ior;
		}

		const modelBuffer = this.modelPool.getBuffer(this.device, this.modelData);

		const skinningBuffer =
			data.isSkinned && data.skinningMatrices
				? this.skinningPool.getBuffer(this.device, data.skinningMatrices)
				: this.defaultSkinningBuffer;

		return this.device.createBindGroup({
			layout: this.modelLayout,
			entries: [
				{ binding: 0, resource: { buffer: modelBuffer } },
				{ binding: 1, resource: { buffer: skinningBuffer } },
				{
					binding: 2,
					resource: data.matte?.createView() ?? fullCoverageView(this.device),
				},
				{
					binding: 3,
					resource:
						(data.glass && data.backdrop?.createView()) ||
						fullCoverageView(this.device),
				},
			],
		});
	}

	draw(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		meshBuffers: GPUMeshBuffers,
		texture: GPUTexture | undefined,
		sampler: GPUSampler,
		data: MeshUniformData,
		useMrt = false,
		useBloom = false,
	): void {
		const modelBindGroup = this.packModel(data);
		const white = this.defaultWhiteTexture;
		const maps = data.maps;
		const textureBindGroup = this.device.createBindGroup({
			layout: this.textureLayout,
			entries: [
				{ binding: 0, resource: sampler },
				{ binding: 1, resource: (texture ?? white).createView() },
				{
					binding: 2,
					resource: (maps?.normal ?? this.flatNormalTexture).createView(),
				},
				{
					binding: 3,
					resource: (maps?.metallicRoughness ?? white).createView(),
				},
				{ binding: 4, resource: (maps?.occlusion ?? white).createView() },
				{ binding: 5, resource: (maps?.emissive ?? white).createView() },
			],
		});

		const wireframe = data.wireframe === true;
		if (wireframe && !meshBuffers.wireIndexBuffer) {
			throw new Error("Wireframe requires mesh buffers with edge indices");
		}
		const variants = data.transparent
			? wireframe
				? this.transparentWirePipelines
				: this.transparentPipelines
			: wireframe
				? { single: this.wireSingle, mrt: this.wireMrt, bloom: this.wireBloom }
				: {
						single: this.pipelineSingle,
						mrt: this.pipelineMrt,
						bloom: this.bloomVariants,
					};
		pass.setPipeline(
			useBloom
				? variants.bloom.get(useMrt)
				: useMrt
					? variants.mrt
					: variants.single,
		);
		pass.setBindGroup(0, cameraBindGroup);
		pass.setBindGroup(1, modelBindGroup);
		pass.setBindGroup(2, textureBindGroup);
		pass.setBindGroup(3, lightsBindGroup);
		pass.setVertexBuffer(0, meshBuffers.vertexBuffer);
		pass.setVertexBuffer(1, this.colorsFor(meshBuffers));
		pass.setIndexBuffer(
			wireframe ? meshBuffers.wireIndexBuffer! : meshBuffers.indexBuffer,
			meshBuffers.indexFormat,
		);
		pass.drawIndexed(
			wireframe ? meshBuffers.wireIndexCount! : meshBuffers.indexCount,
		);
	}

	/** Draws the mesh into a shadow map (`lightCameraBindGroup` holds the light's view-projection). */
	drawShadow(
		pass: GPURenderPassEncoder,
		lightCameraBindGroup: GPUBindGroup,
		meshBuffers: GPUMeshBuffers,
		data: MeshUniformData,
	): void {
		const wireframe = data.wireframe === true;
		if (wireframe && !meshBuffers.wireIndexBuffer) {
			throw new Error("Wireframe requires mesh buffers with edge indices");
		}
		pass.setPipeline(wireframe ? this.wireShadow : this.pipelineShadow);
		pass.setBindGroup(0, lightCameraBindGroup);
		pass.setBindGroup(1, this.packModel(data));
		pass.setVertexBuffer(0, meshBuffers.vertexBuffer);
		pass.setVertexBuffer(1, this.colorsFor(meshBuffers));
		pass.setIndexBuffer(
			wireframe ? meshBuffers.wireIndexBuffer! : meshBuffers.indexBuffer,
			meshBuffers.indexFormat,
		);
		pass.drawIndexed(
			wireframe ? meshBuffers.wireIndexCount! : meshBuffers.indexCount,
		);
	}

	private colorsFor(meshBuffers: GPUMeshBuffers): GPUBuffer {
		if (meshBuffers.colorBuffer) return meshBuffers.colorBuffer;
		// 64 bytes per vertex in the main buffer.
		const needed = Math.max(1, Math.ceil(meshBuffers.vertexBuffer.size / 64));
		if (!this.whiteColorBuffer || this.whiteColorCapacity < needed) {
			if (this.whiteColorBuffer)
				this.retiredColorBuffers.push(this.whiteColorBuffer);
			const capacity = 2 ** Math.ceil(Math.log2(needed));
			this.whiteColorBuffer = this.device.createBuffer({
				label: "Mesh3DWhiteVertexColors",
				size: capacity * 16,
				usage: GPUBufferUsage.VERTEX,
				mappedAtCreation: true,
			});
			new Float32Array(this.whiteColorBuffer.getMappedRange()).fill(1);
			this.whiteColorBuffer.unmap();
			this.whiteColorCapacity = capacity;
		}
		return this.whiteColorBuffer;
	}

	destroy(): void {
		this.whiteColorBuffer?.destroy();
		for (const buffer of this.retiredColorBuffers) buffer.destroy();
		this.modelPool.destroy();
		this.skinningPool.destroy();
		this.defaultWhiteTexture.destroy();
		this.flatNormalTexture.destroy();
		this.defaultSkinningBuffer.destroy();
	}
}
