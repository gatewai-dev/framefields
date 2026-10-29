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
	/** Extra per-map UV vertex attributes are present. */
	hasMapUvs?: boolean;
	isSkinned?: boolean;
	skinningMatrices?: Float32Array; // 16 floats per joint
	/** Hardware-instanced draw path. */
	isInstanced?: boolean;
	/** Instance storage contains model and normal matrices in pairs. */
	matrixInstances?: boolean;
	/** Storage buffer containing `array<InstanceData>` (64 bytes per instance). */
	instanceBuffer?: GPUBuffer;
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
	topology?: "triangle-list" | "line-list" | "point-list";
	/** Per-vertex RGBA (display / sRGB), 4 floats each; absent = white. */
	colorBuffer?: GPUBuffer;
	mapUvBuffer?: GPUBuffer;
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
	private pointPipelines: {
		single: GPURenderPipeline;
		mrt: GPURenderPipeline;
		bloom: BloomPipelineVariants;
	};
	private transparentPointPipelines: {
		single: GPURenderPipeline;
		mrt: GPURenderPipeline;
		bloom: BloomPipelineVariants;
	};
	private pointShadow: GPURenderPipeline;
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
	private defaultInstanceBuffer: GPUBuffer;
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
		this.skinningPool = new BufferPool(
			64,
			GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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
					buffer: { type: "read-only-storage" },
				},
				matteLayoutEntry(2),
				matteLayoutEntry(3),
				{
					binding: 4,
					visibility: GPUShaderStage.VERTEX,
					buffer: { type: "read-only-storage" },
				},
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
				{
					arrayStride: 32,
					attributes: [
						{ shaderLocation: 6, offset: 0, format: "float32x2" },
						{ shaderLocation: 7, offset: 8, format: "float32x2" },
						{ shaderLocation: 8, offset: 16, format: "float32x2" },
						{ shaderLocation: 9, offset: 24, format: "float32x2" },
					],
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
		const pointBase: PipelineVariantBase = {
			...base,
			label: "Mesh3DPoints",
			primitive: { topology: "point-list" },
		};
		const transparentPointBase: PipelineVariantBase = {
			...pointBase,
			label: "Mesh3DTransparentPoints",
			depthStencil: { ...base.depthStencil, depthWriteEnabled: false },
		};
		this.pointPipelines = {
			...createBasePipelines(device, pointBase),
			bloom: new BloomPipelineVariants(device, pointBase),
		};
		this.transparentPointPipelines = {
			...createBasePipelines(device, transparentPointBase),
			bloom: new BloomPipelineVariants(device, transparentPointBase),
		};
		this.pointShadow = device.createRenderPipeline({
			label: "Mesh3DPointShadow",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [this.cameraLayout, this.modelLayout],
			}),
			vertex: vertexState,
			depthStencil: {
				format: SHADOW_DEPTH_STENCIL.format,
				depthWriteEnabled: true,
				depthCompare: "less-equal",
			},
			primitive: { topology: "point-list" },
		});
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

		// A non-skinned draw still binds one identity matrix.
		const idMatrices = new Float32Array(16);
		idMatrices[0] = idMatrices[5] = idMatrices[10] = idMatrices[15] = 1;
		this.defaultSkinningBuffer = device.createBuffer({
			size: 64,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});
		new Float32Array(this.defaultSkinningBuffer.getMappedRange()).set(
			idMatrices,
		);
		this.defaultSkinningBuffer.unmap();

		// Default 1-element dummy instance buffer (posScale=[0,0,0,1], quat=[0,0,0,1], color=[1,1,1,1], emissive=[0,0,0,0])
		this.defaultInstanceBuffer = device.createBuffer({
			label: "Mesh3DDefaultInstanceBuffer",
			size: 64,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});
		const defInst = new Float32Array(
			this.defaultInstanceBuffer.getMappedRange(),
		);
		defInst[0] = 0;
		defInst[1] = 0;
		defInst[2] = 0;
		defInst[3] = 1;
		defInst[4] = 0;
		defInst[5] = 0;
		defInst[6] = 0;
		defInst[7] = 1;
		defInst[8] = 1;
		defInst[9] = 1;
		defInst[10] = 1;
		defInst[11] = 1;
		defInst[12] = 0;
		defInst[13] = 0;
		defInst[14] = 0;
		defInst[15] = 0;
		this.defaultInstanceBuffer.unmap();
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
		// Bit 0 selects instance data; bit 1 selects the extra map UVs.
		this.modelData[39] =
			(data.isInstanced || data.instanceBuffer ? 1 : 0) +
			(data.hasMapUvs ? 2 : 0) +
			(data.matrixInstances ? 4 : 0);

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

		if (
			data.skinningMatrices &&
			data.skinningMatrices.byteLength >
				this.device.limits.maxStorageBufferBindingSize
		) {
			throw new Error(
				`Skinning data requires ${data.skinningMatrices.byteLength} bytes, exceeding the device storage binding limit of ${this.device.limits.maxStorageBufferBindingSize} bytes`,
			);
		}
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
				{
					binding: 4,
					resource: {
						buffer: data.instanceBuffer ?? this.defaultInstanceBuffer,
					},
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
		instanceCount = 1,
		firstInstance = 0,
	): void {
		const modelBindGroup = this.packModel({
			...data,
			hasMapUvs: Boolean(meshBuffers.mapUvBuffer),
		});
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

		const wireframe =
			data.wireframe === true &&
			(!meshBuffers.topology || meshBuffers.topology === "triangle-list");
		if (wireframe && !meshBuffers.wireIndexBuffer) {
			throw new Error("Wireframe requires mesh buffers with edge indices");
		}
		const line = wireframe || meshBuffers.topology === "line-list";
		const variants =
			meshBuffers.topology === "point-list"
				? data.transparent
					? this.transparentPointPipelines
					: this.pointPipelines
				: data.transparent
					? line
						? this.transparentWirePipelines
						: this.transparentPipelines
					: line
						? {
								single: this.wireSingle,
								mrt: this.wireMrt,
								bloom: this.wireBloom,
							}
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
		pass.setVertexBuffer(
			2,
			meshBuffers.mapUvBuffer ?? meshBuffers.vertexBuffer,
		);
		pass.setIndexBuffer(
			wireframe ? meshBuffers.wireIndexBuffer! : meshBuffers.indexBuffer,
			meshBuffers.indexFormat,
		);
		if (instanceCount > 1 || data.isInstanced) {
			pass.drawIndexed(
				wireframe ? meshBuffers.wireIndexCount! : meshBuffers.indexCount,
				instanceCount,
				0,
				0,
				firstInstance,
			);
		} else {
			pass.drawIndexed(
				wireframe ? meshBuffers.wireIndexCount! : meshBuffers.indexCount,
			);
		}
	}

	/** Draws the mesh into a shadow map (`lightCameraBindGroup` holds the light's view-projection). */
	drawShadow(
		pass: GPURenderPassEncoder,
		lightCameraBindGroup: GPUBindGroup,
		meshBuffers: GPUMeshBuffers,
		data: MeshUniformData,
		instanceCount = 1,
		firstInstance = 0,
	): void {
		const wireframe =
			data.wireframe === true &&
			(!meshBuffers.topology || meshBuffers.topology === "triangle-list");
		if (wireframe && !meshBuffers.wireIndexBuffer) {
			throw new Error("Wireframe requires mesh buffers with edge indices");
		}
		pass.setPipeline(
			meshBuffers.topology === "point-list"
				? this.pointShadow
				: wireframe || meshBuffers.topology === "line-list"
					? this.wireShadow
					: this.pipelineShadow,
		);
		pass.setBindGroup(0, lightCameraBindGroup);
		pass.setBindGroup(1, this.packModel(data));
		pass.setVertexBuffer(0, meshBuffers.vertexBuffer);
		pass.setVertexBuffer(1, this.colorsFor(meshBuffers));
		pass.setVertexBuffer(
			2,
			meshBuffers.mapUvBuffer ?? meshBuffers.vertexBuffer,
		);
		pass.setIndexBuffer(
			wireframe ? meshBuffers.wireIndexBuffer! : meshBuffers.indexBuffer,
			meshBuffers.indexFormat,
		);
		if (instanceCount > 1 || data.isInstanced) {
			pass.drawIndexed(
				wireframe ? meshBuffers.wireIndexCount! : meshBuffers.indexCount,
				instanceCount,
				0,
				0,
				firstInstance,
			);
		} else {
			pass.drawIndexed(
				wireframe ? meshBuffers.wireIndexCount! : meshBuffers.indexCount,
			);
		}
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
		this.defaultInstanceBuffer.destroy();
	}
}
