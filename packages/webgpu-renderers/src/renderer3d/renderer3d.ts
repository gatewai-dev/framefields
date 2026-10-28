import type { MeshAudioDeformConfig } from "@framefields/core";
import { type Color, parseColor } from "../color.js";
import {
	FbxLoader,
	GltfLoader,
	load3DS,
	loadFBX,
	loadGLB,
	loadGLTF,
	loadGLTFAsync,
	loadOBJ,
	loadOFF,
	loadPLY,
	loadSTL,
	loadVOX,
	StlLoader,
	ThreeDSLoader,
	VoxLoader,
} from "../loaders/index.js";
import type {
	LoadModelOptions,
	Material3D,
	Mesh3DData,
	Model3DData,
} from "../loaders/types.js";
import type {
	Environment3DFloor,
	Environment3DOptions,
	ShadowUniformInfo,
} from "../math3d/environment3d.js";
import {
	Camera3D,
	type Camera3DPose,
	LIGHT_UNIFORM_SIZE_BYTES,
	Light3D,
	type Light3DOptions,
	type Mat4,
	Matrix4Math,
	type Vec3,
	Vector3Math,
} from "../math3d/index.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";
import { SamplerCache } from "../renderer2d/sampler-cache.js";
import { UniformBindGroupCache } from "../renderer2d/uniform-bind-group-cache.js";
import { dofBokehWgsl } from "../shaders/dof-bokeh.js";
import type { SlugGlyphBatch } from "../slug/slug-pipeline.js";
import { AudioMeshDeformPipeline } from "./audio-mesh-deform-pipeline.js";
import { type BloomOptions, BloomPipeline } from "./bloom-pipeline.js";
import { FloorReflectionPipeline } from "./floor-reflection-pipeline.js";
import { decodeKtx2, isKtx2 } from "./ktx2.js";
import {
	type GPUMeshBuffers,
	Mesh3DPipeline,
	type MeshMaterialMaps,
} from "./mesh3d-pipeline.js";
import { MorphPipeline } from "./morph-pipeline.js";
import { Quad3DPipeline } from "./quad3d-pipeline.js";
import { SHADOW_DEPTH_FORMAT } from "./shadow-depth.js";
import {
	type Aabb,
	fitShadowFrustum,
	transformAabb,
} from "./shadow-frustum.js";
import { Slug3DPipeline } from "./slug3d-pipeline.js";
import type { SurfaceParams } from "./surface-params.js";
import { Swarm3DPipeline } from "./swarm3d-pipeline.js";

const ADDRESS_MODES: Record<"repeat" | "clamp" | "mirror", GPUAddressMode> = {
	repeat: "repeat",
	clamp: "clamp-to-edge",
	mirror: "mirror-repeat",
};

export interface DrawQuad3DOpts extends SurfaceParams {
	/** 3D world position [x, y, z] */
	position: [number, number, number];
	/** Layer surface width */
	width: number;
	/** Layer surface height */
	height: number;
	/** Fraction of the texture the layer covers, [u, v] (default the whole texture) */
	textureExtent?: [number, number];
	/** Euler rotations in degrees [rx, ry, rz] */
	rotation?: Vec3;
	/** 3D scale [sx, sy, sz] */
	scale?: Vec3;
	/** Anchor pivot ratio [ax, ay] (default [0.5, 0.5]) */
	anchor?: [number, number];
	/** Layer opacity [0, 1] */
	opacity?: number;
	/** RGBA color tint */
	colorTint?: [number, number, number, number];
	/** Border color (string, Color, or [r, g, b, a]) */
	borderColor?: [number, number, number, number] | string | Color;
	/** Border stroke width */
	borderWidth?: number;
	/** Rounded corner radius */
	borderRadius?: number;
	/** Whether backface is rendered */
	twoSided?: boolean;
	/** Pre-computed model matrix overriding position/rotation/scale if supplied */
	modelMatrix?: Mat4;
	/** Pre-computed normal matrix */
	normalMatrix?: Mat4;
	/** Material shading mode ("lit" vs "unlit") */
	material?: "lit" | "unlit";
	/** Blinn-Phong specular shininess exponent */
	shininess?: number;
	/** Roughness factor [0, 1] */
	roughness?: number;
	/** Specular highlight intensity [0, 10] */
	specularIntensity?: number;
	/** Ambient light reflection multiplier */
	ambientIntensity?: number;
	/** Metallic factor [0, 1] */
	metallic?: number;
	/**
	 * Screen-space track matte, the size of the pass: the layer shows where
	 * this texture's alpha does and keeps its place in the depth buffer.
	 */
	matte?: GPUTexture;
}

/**
 * How far, as a fraction of the distance to the eye, each pass stacked on a
 * text plane slides toward it. Large enough for depth24 to separate passes
 * out to a few thousand px from the camera, small enough to never be seen.
 */
const TEXT_STACK_PULL = 5e-4;

export interface DrawMesh3DOpts extends SurfaceParams {
	/** Refractive index for glass materials (default 1.5). */
	ior?: number;
	/** Rainbow split for glass materials, 0–0.2 (default 0.04). */
	dispersion?: number;
	/** Edge bend for glass materials, px (default 80). */
	thickness?: number;
	/** Screen-sized picture behind this 3D batch; glass materials refract it. */
	backdrop?: GPUTexture;
	/**
	 * Screen-space track matte, the size of the pass: the layer shows where
	 * this texture's alpha does and keeps its place in the depth buffer.
	 */
	matte?: GPUTexture;
	/** 3D world position [x, y, z] */
	position?: Vec3;
	/** Euler rotations in degrees [rx, ry, rz] */
	rotation?: Vec3;
	/** 3D scale [sx, sy, sz] */
	scale?: Vec3;
	/** Layer opacity [0, 1] */
	opacity?: number;
	/** RGBA color tint */
	colorTint?: [number, number, number, number];
	/** Whether backface is rendered */
	twoSided?: boolean;
	/** Per-instance morph target weights, evaluated before skinning. */
	morphWeights?: number[];
	/** Wireframe mode */
	wireframe?: boolean;
	/** Blend without writing depth; draw transparent meshes back to front. */
	transparent?: boolean;
	/** Whether vertex skinning is enabled */
	isSkinned?: boolean;
	/** Skinning matrices (128 * 16 floats) */
	skinningMatrices?: Float32Array;
	/** Pre-computed model matrix overriding position/rotation/scale if supplied */
	modelMatrix?: Mat4;
	/** Pre-computed normal matrix */
	normalMatrix?: Mat4;
	/** Material shading mode */
	material?:
		| "lit"
		| "unlit"
		| "toon"
		| "glass"
		| "acrylic"
		| "frosted"
		| "metallic";
	/** Toon shading: the shadowed side's color multiplier */
	shadeColor?: [number, number, number];
	/** Normal / metallic-roughness / occlusion / emissive maps (see `materialMaps`). */
	maps?: MeshMaterialMaps;
	/** Discard texels whose alpha is below this (glTF MASK) */
	alphaCutoff?: number;
	/** Texture addressing outside [0, 1] */
	textureWrap?: "repeat" | "clamp" | "mirror";
	/** Magnification filter: "nearest" keeps texels sharp (pixel art). */
	textureFilter?: "linear" | "nearest";
	/** Blinn-Phong specular shininess exponent */
	shininess?: number;
	/** Roughness factor [0, 1] */
	roughness?: number;
	/** Specular highlight intensity [0, 10] */
	specularIntensity?: number;
	/** Ambient light reflection multiplier */
	ambientIntensity?: number;
	/** Metallic factor [0, 1] */
	metallic?: number;
	/** Optional audio latent mesh deformation options */
	audioDeform?: {
		config: MeshAudioDeformConfig;
		latentBuffer: GPUBuffer;
		timeMs?: number;
		sampleRate?: number;
	};
	/** Hardware instancing: number of instances to draw in a single draw call. */
	instanceCount?: number;
	/** Starting instance index in `instanceBuffer` (default 0). */
	firstInstance?: number;
	/** Storage buffer holding `InstanceData` structs (64 bytes per instance). */
	instanceBuffer?: GPUBuffer;
	/** Optional overall bounding box (e.g. for instanced clusters or swarms) for shadow frustum fitting. */
	bounds?: Aabb;
}

/** Scene-wide world settings for a 3D pass. */
export interface Scene3DWorld {
	/** Present = physically based shading (see `Environment3DOptions`). */
	environment?: Environment3DOptions | null;
	/** From `renderShadowMap`, when a light casts shadows. */
	shadow?: ShadowUniformInfo | null;
}

/** Something that can fall into a shadow map. */
export type ShadowCaster3D =
	| {
			kind: "mesh";
			mesh: Mesh3DData;
			buffers?: GPUMeshBuffers;
			opts: DrawMesh3DOpts;
	  }
	| { kind: "quad"; texture: GPUTexture; opts: DrawQuad3DOpts };

export interface ShadowMapOptions3D {
	/** Texels per side. Default 2048. */
	mapSize?: number;
	/** Edge blur in texels. Default 2.5. */
	softness?: number;
	/** 0..1. Default 1. */
	darkness?: number;
}

export class Renderer3D {
	private device: GPUDevice;
	public format: GPUTextureFormat;
	public quad3dPipeline: Quad3DPipeline;
	public slug3dPipeline: Slug3DPipeline;
	public mesh3dPipeline: Mesh3DPipeline;
	public audioMeshDeformPipeline: AudioMeshDeformPipeline;
	private morphPipeline: MorphPipeline;
	public swarm3dPipeline: Swarm3DPipeline;
	public floorReflectionPipeline: FloorReflectionPipeline;
	private dofPipeline: GPURenderPipeline;
	private dofBindGroupLayout: GPUBindGroupLayout;
	private cameraPool: BufferPool;
	private lightsPool: BufferPool;
	private instancePool: BufferPool;
	private cameraUniformBindGroupCache = new UniformBindGroupCache();
	private samplerCache = new SamplerCache();
	private depthTexture: GPUTexture | null = null;
	private linearDepthTexture: GPUTexture | null = null;
	private reflectionColorTexture: GPUTexture | null = null;
	private reflectionMsaaColorTexture: GPUTexture | null = null;
	private reflectionDepthTexture: GPUTexture | null = null;
	private reflectionTempTexture: GPUTexture | null = null;
	private reflectionBlurredTexture: GPUTexture | null = null;
	// Multisampled targets the pass draws into; they resolve into the caller's views.
	private msaaColorTexture: GPUTexture | null = null;
	private msaaLinearDepthTexture: GPUTexture | null = null;
	private msaaHdrTexture: GPUTexture | null = null;
	private hdrTexture: GPUTexture | null = null;
	/** Whether the current pass also writes HDR radiance (bloom). */
	private passWritesHdr = false;
	private cameraUniformData = new Float32Array(80); // 320 bytes = 80 floats
	private meshBuffersCache = new WeakMap<Mesh3DData, GPUMeshBuffers>();
	private materialTextures = new WeakMap<
		Material3D,
		Promise<GPUTexture | undefined>
	>();
	private materialMapCache = new WeakMap<
		Material3D,
		Promise<MeshMaterialMaps>
	>();
	/** Parsed models by source and load options: a model file is read once, not every frame. */
	private modelCache = new Map<string, Model3DData>();
	private lastCameraPose: Camera3DPose | null = null;
	private shadowTexture: GPUTexture | null = null;
	private placeholderShadowTexture: GPUTexture | null = null;
	private shadowSampler: GPUSampler | null = null;
	private meshBounds = new WeakMap<Mesh3DData, Aabb>();
	private bloomPipeline: BloomPipeline | null = null;
	private lastCameraBuffer: GPUBuffer | null = null;

	/**
	 * Samples per pixel in the 3D pass. Mesh silhouettes (extruded text,
	 * models) are rasterized triangles: without MSAA every edge is a hard
	 * stair-step. 4 is the count every WebGPU device supports; 1 turns it off.
	 */
	public readonly sampleCount: number;

	constructor(device: GPUDevice, format: GPUTextureFormat, sampleCount = 4) {
		this.device = device;
		this.format = format;
		this.sampleCount = sampleCount;
		this.quad3dPipeline = new Quad3DPipeline(
			device,
			format,
			"depth24plus",
			sampleCount,
		);
		this.slug3dPipeline = new Slug3DPipeline(
			device,
			format,
			"depth24plus",
			this.quad3dPipeline.cameraLayout,
			this.quad3dPipeline.lightsLayout,
			sampleCount,
		);
		this.mesh3dPipeline = new Mesh3DPipeline(
			device,
			format,
			"depth24plus",
			this.quad3dPipeline.cameraLayout,
			this.quad3dPipeline.lightsLayout,
			sampleCount,
		);
		this.audioMeshDeformPipeline = new AudioMeshDeformPipeline(device);
		this.morphPipeline = new MorphPipeline(device);
		this.swarm3dPipeline = new Swarm3DPipeline(device);
		this.floorReflectionPipeline = new FloorReflectionPipeline(
			device,
			format,
			sampleCount,
			this.quad3dPipeline.cameraLayout,
			this.quad3dPipeline.lightsLayout,
			"depth24plus",
		);

		this.cameraPool = new BufferPool(
			320,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		this.lightsPool = new BufferPool(
			LIGHT_UNIFORM_SIZE_BYTES,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		this.instancePool = new BufferPool(
			65536,
			GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		);

		// Initialize DoF Bokeh Pipeline
		const dofModule = device.createShaderModule({
			label: "dof-bokeh.wgsl",
			code: dofBokehWgsl,
		});

		this.dofBindGroupLayout = device.createBindGroupLayout({
			label: "DoFBindGroupLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
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
					texture: { sampleType: "float" },
				},
			],
		});

		this.dofPipeline = device.createRenderPipeline({
			label: "DoFBokehPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [this.dofBindGroupLayout],
			}),
			vertex: {
				module: dofModule,
				entryPoint: "vs_fullscreen",
			},
			fragment: {
				module: dofModule,
				entryPoint: "fs_dof",
				targets: [{ format }],
			},
			primitive: {
				topology: "triangle-list",
			},
		});
	}

	resetPools(): void {
		this.bloomPipeline?.resetPools();
		this.cameraPool.reset();
		// The cached camera buffer goes back to the pool and may be handed
		// out again (e.g. to a shadow pass's light camera): never reuse it
		// across a reset.
		this.lastCameraPose = null;
		this.lastCameraBuffer = null;
		this.lightsPool.reset();
		this.instancePool.reset();
		this.quad3dPipeline.resetPools();
		this.slug3dPipeline.resetPools();
		this.mesh3dPipeline.resetPools();
		this.audioMeshDeformPipeline.resetPools();
		this.morphPipeline.resetPools();
	}

	getOrCreateDepthTexture(width: number, height: number): GPUTexture {
		if (
			!this.depthTexture ||
			this.depthTexture.width !== width ||
			this.depthTexture.height !== height
		) {
			this.depthTexture?.destroy();
			this.depthTexture = this.device.createTexture({
				label: "Renderer3DDepthTexture",
				size: { width, height },
				format: "depth24plus",
				sampleCount: this.sampleCount,
				usage: GPUTextureUsage.RENDER_ATTACHMENT,
			});
		}
		return this.depthTexture;
	}

	private getOrCreateMsaaTexture(
		current: GPUTexture | null,
		label: string,
		format: GPUTextureFormat,
		width: number,
		height: number,
	): GPUTexture {
		if (current && current.width === width && current.height === height) {
			return current;
		}
		current?.destroy();
		return this.device.createTexture({
			label,
			size: { width, height },
			format,
			sampleCount: this.sampleCount,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
	}

	/** The HDR radiance target the last `beginPass(…, writeHdr)` drew into. */
	hdrSource(): GPUTexture | null {
		return this.hdrTexture;
	}

	private getOrCreateHdrTexture(width: number, height: number): GPUTexture {
		if (
			!this.hdrTexture ||
			this.hdrTexture.width !== width ||
			this.hdrTexture.height !== height
		) {
			this.hdrTexture?.destroy();
			this.hdrTexture = this.device.createTexture({
				label: "Renderer3DHdrRadiance",
				size: { width, height },
				format: "rgba16float",
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			});
		}
		return this.hdrTexture;
	}

	getOrCreateLinearDepthTexture(width: number, height: number): GPUTexture {
		if (
			!this.linearDepthTexture ||
			this.linearDepthTexture.width !== width ||
			this.linearDepthTexture.height !== height
		) {
			this.linearDepthTexture?.destroy();
			this.linearDepthTexture = this.device.createTexture({
				label: "Renderer3DLinearDepthTexture",
				size: { width, height },
				format: "rgba16float",
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			});
		}
		return this.linearDepthTexture;
	}

	getOrCreateReflectionTexture(width: number, height: number): GPUTexture {
		if (
			!this.reflectionColorTexture ||
			this.reflectionColorTexture.width !== width ||
			this.reflectionColorTexture.height !== height
		) {
			this.reflectionColorTexture?.destroy();
			this.reflectionColorTexture = this.device.createTexture({
				label: "Renderer3DReflectionColor",
				size: { width, height },
				format: this.format,
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			});
		}
		return this.reflectionColorTexture;
	}

	getOrCreateReflectionMsaaTexture(width: number, height: number): GPUTexture {
		if (
			!this.reflectionMsaaColorTexture ||
			this.reflectionMsaaColorTexture.width !== width ||
			this.reflectionMsaaColorTexture.height !== height
		) {
			this.reflectionMsaaColorTexture?.destroy();
			this.reflectionMsaaColorTexture = this.device.createTexture({
				label: "Renderer3DReflectionMsaaColor",
				size: { width, height },
				format: this.format,
				sampleCount: this.sampleCount,
				usage: GPUTextureUsage.RENDER_ATTACHMENT,
			});
		}
		return this.reflectionMsaaColorTexture;
	}

	getOrCreateReflectionDepthTexture(width: number, height: number): GPUTexture {
		if (
			!this.reflectionDepthTexture ||
			this.reflectionDepthTexture.width !== width ||
			this.reflectionDepthTexture.height !== height
		) {
			this.reflectionDepthTexture?.destroy();
			this.reflectionDepthTexture = this.device.createTexture({
				label: "Renderer3DReflectionDepth",
				size: { width, height },
				format: "depth24plus",
				sampleCount: this.sampleCount,
				usage: GPUTextureUsage.RENDER_ATTACHMENT,
			});
		}
		return this.reflectionDepthTexture;
	}

	getOrCreateReflectionTempTexture(width: number, height: number): GPUTexture {
		if (
			!this.reflectionTempTexture ||
			this.reflectionTempTexture.width !== width ||
			this.reflectionTempTexture.height !== height
		) {
			this.reflectionTempTexture?.destroy();
			this.reflectionTempTexture = this.device.createTexture({
				label: "Renderer3DReflectionTemp",
				size: { width, height },
				format: this.format,
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			});
		}
		return this.reflectionTempTexture;
	}

	getOrCreateReflectionBlurredTexture(
		width: number,
		height: number,
	): GPUTexture {
		if (
			!this.reflectionBlurredTexture ||
			this.reflectionBlurredTexture.width !== width ||
			this.reflectionBlurredTexture.height !== height
		) {
			this.reflectionBlurredTexture?.destroy();
			this.reflectionBlurredTexture = this.device.createTexture({
				label: "Renderer3DReflectionBlurred",
				size: { width, height },
				format: this.format,
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			});
		}
		return this.reflectionBlurredTexture;
	}

	packCameraUniforms(
		camera: Camera3DPose,
		surfaceWidth: number,
		surfaceHeight: number,
		time = 0,
	): GPUBuffer {
		// Skip recomputation if camera pose hasn't changed
		if (
			this.lastCameraPose &&
			this.lastCameraBuffer &&
			this.lastCameraPose.eye[0] === camera.eye[0] &&
			this.lastCameraPose.eye[1] === camera.eye[1] &&
			this.lastCameraPose.eye[2] === camera.eye[2] &&
			this.lastCameraPose.target[0] === camera.target[0] &&
			this.lastCameraPose.target[1] === camera.target[1] &&
			this.lastCameraPose.target[2] === camera.target[2] &&
			this.lastCameraPose.up[0] === camera.up[0] &&
			this.lastCameraPose.up[1] === camera.up[1] &&
			this.lastCameraPose.up[2] === camera.up[2] &&
			this.lastCameraPose.fov === camera.fov &&
			this.lastCameraPose.near === camera.near &&
			this.lastCameraPose.far === camera.far
		) {
			return this.lastCameraBuffer;
		}

		const view = Camera3D.computeViewMatrix(camera);
		const proj = Camera3D.computeProjectionMatrix(camera);
		const viewProj = Camera3D.computeViewProjectionMatrix(camera);
		const invViewProj = Matrix4Math.invert(viewProj) ?? Matrix4Math.identity();

		// viewMatrix (0..15)
		this.cameraUniformData.set(view, 0);
		// projMatrix (16..31)
		this.cameraUniformData.set(proj, 16);
		// viewProj (32..47)
		this.cameraUniformData.set(viewProj, 32);
		// invViewProj (48..63)
		this.cameraUniformData.set(invViewProj, 48);

		// cameraPos (64..67)
		this.cameraUniformData[64] = camera.eye[0];
		this.cameraUniformData[65] = camera.eye[1];
		this.cameraUniformData[66] = camera.eye[2];
		this.cameraUniformData[67] = camera.near;

		// cameraDir (68..71)
		const fwd = Vector3Math.normalize(
			Vector3Math.subtract(camera.target, camera.eye),
		);
		this.cameraUniformData[68] = fwd[0];
		this.cameraUniformData[69] = fwd[1];
		this.cameraUniformData[70] = fwd[2];
		this.cameraUniformData[71] = camera.far;

		// dofParams (72..75)
		this.cameraUniformData[72] = camera.focusDistance ?? 1000;
		this.cameraUniformData[73] = camera.fStop ?? 2.8;
		this.cameraUniformData[74] = camera.maxBlurRadius ?? 32;
		this.cameraUniformData[75] = camera.focusDistance !== undefined ? 1.0 : 0.0;

		// screenParams (76..79)
		this.cameraUniformData[76] = surfaceWidth;
		this.cameraUniformData[77] = surfaceHeight;
		this.cameraUniformData[78] = time;
		this.cameraUniformData[79] = 0;

		const buffer = this.cameraPool.getBuffer(
			this.device,
			this.cameraUniformData,
		);
		this.lastCameraPose = camera;
		this.lastCameraBuffer = buffer;
		return buffer;
	}

	createCameraBindGroup(cameraBuffer: GPUBuffer): GPUBindGroup {
		return this.cameraUniformBindGroupCache.getBindGroup(
			this.device,
			this.quad3dPipeline.cameraLayout,
			cameraBuffer,
		);
	}

	public getOrCreateLightsBuffer(
		lights?: Light3DOptions[],
		world?: Scene3DWorld,
	): GPUBuffer {
		const lightsData = Light3D.packLightsUniforms(
			lights ?? [],
			world?.environment,
			world?.shadow,
		);
		return this.lightsPool.getBuffer(this.device, lightsData);
	}

	/** Lights uniform + shadow map + comparison sampler (group 3 of every lit shader). */
	private createLightsBindGroup(
		lightsBuffer: GPUBuffer,
		withShadow: boolean,
	): GPUBindGroup {
		this.shadowSampler ??= this.device.createSampler({
			label: "ShadowComparisonSampler",
			compare: "less-equal",
			magFilter: "linear",
			minFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
		});
		this.placeholderShadowTexture ??= this.device.createTexture({
			label: "ShadowMapPlaceholder",
			size: { width: 1, height: 1 },
			format: SHADOW_DEPTH_FORMAT,
			usage:
				GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		const map =
			withShadow && this.shadowTexture
				? this.shadowTexture
				: this.placeholderShadowTexture;
		return this.device.createBindGroup({
			label: "Lights3DBindGroup",
			layout: this.quad3dPipeline.lightsLayout,
			entries: [
				{ binding: 0, resource: { buffer: lightsBuffer } },
				{ binding: 1, resource: map.createView() },
				{ binding: 2, resource: this.shadowSampler },
			],
		});
	}

	/** Local bounds of a mesh, computed once. */
	private meshAabb(mesh: Mesh3DData): Aabb {
		let box = this.meshBounds.get(mesh);
		if (!box) {
			const min: Vec3 = [Infinity, Infinity, Infinity];
			const max: Vec3 = [-Infinity, -Infinity, -Infinity];
			const p = mesh.positions;
			for (let i = 0; i + 2 < p.length; i += 3) {
				for (let k = 0; k < 3; k++) {
					const v = p[i + k];
					if (v < min[k]) min[k] = v;
					if (v > max[k]) max[k] = v;
				}
			}
			box = Number.isFinite(min[0])
				? { min, max }
				: { min: [0, 0, 0], max: [0, 0, 0] };
			this.meshBounds.set(mesh, box);
		}
		return box;
	}

	/** World bounds of a mesh or quad draw, for fitting shadow frusta. */
	worldBounds(item: ShadowCaster3D): Aabb {
		if (item.kind === "mesh") {
			if (item.opts.bounds) return item.opts.bounds;
			return transformAabb(
				this.meshAabb(item.mesh),
				this.meshModelMatrix(item.opts),
			);
		}
		return transformAabb(
			{ min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
			this.quadModelMatrix(item.opts),
		);
	}

	/**
	 * Renders the shadow map for `light` (a directional or spot light with
	 * `castShadow`) from `casters`, fitting its frustum around them and deep
	 * enough for `receivers`. Pass the result to `beginPass` as `world.shadow`.
	 */
	renderShadowMap(
		encoder: GPUCommandEncoder,
		light: Light3DOptions,
		lightIndex: number,
		casters: ShadowCaster3D[],
		receivers: Aabb[],
		options: ShadowMapOptions3D = {},
	): ShadowUniformInfo | null {
		const kind = light.lightType ?? light.type;
		if (kind !== "directional" && kind !== "spot") return null;
		const processed = Light3D.processLight(light);
		const position: Vec3 = [
			processed.posType[0],
			processed.posType[1],
			processed.posType[2],
		];
		const direction: Vec3 = [
			processed.dirRadius[0],
			processed.dirRadius[1],
			processed.dirRadius[2],
		];
		const mapSize = options.mapSize ?? 2048;
		const casterBounds = casters.map((c) => this.worldBounds(c));
		const frustum = fitShadowFrustum(
			{ type: kind, position, direction, angle: light.angle },
			casterBounds,
			receivers,
			mapSize,
		);
		if (!frustum) return null;

		if (!this.shadowTexture || this.shadowTexture.width !== mapSize) {
			this.shadowTexture?.destroy();
			this.shadowTexture = this.device.createTexture({
				label: "ShadowMap",
				size: { width: mapSize, height: mapSize },
				format: SHADOW_DEPTH_FORMAT,
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			});
		}

		// The light's "camera": only viewProj matters to the vertex shaders.
		const lightCam = new Float32Array(80);
		lightCam.set(frustum.viewProj, 32);
		lightCam.set(frustum.viewProj, 0);
		lightCam[5] = 1;
		lightCam.set(frustum.viewProj, 16);
		lightCam[64] = position[0];
		lightCam[65] = position[1];
		lightCam[66] = position[2];
		lightCam[68] = direction[0];
		lightCam[69] = direction[1];
		lightCam[70] = direction[2];
		lightCam[76] = mapSize;
		lightCam[77] = mapSize;
		const lightCamBindGroup = this.createCameraBindGroup(
			this.cameraPool.getBuffer(this.device, lightCam),
		);

		const pass = encoder.beginRenderPass({
			label: "ShadowMapPass",
			colorAttachments: [],
			depthStencilAttachment: {
				view: this.shadowTexture.createView(),
				depthClearValue: 1.0,
				depthLoadOp: "clear",
				depthStoreOp: "store",
			},
		});
		const sampler = this.samplerCache.getSampler(this.device);
		for (const c of casters) {
			if (c.kind === "mesh") {
				const m = this.meshModelMatrix(c.opts);
				this.mesh3dPipeline.drawShadow(
					pass,
					lightCamBindGroup,
					c.buffers ?? this.getOrCreateMeshBuffers(c.mesh, c.opts.wireframe),
					{
						modelMatrix: m,
						normalMatrix: c.opts.normalMatrix ?? Light3D.computeNormalMatrix(m),
						wireframe: c.opts.wireframe,
						isSkinned: c.opts.isSkinned,
						skinningMatrices: c.opts.skinningMatrices,
						isInstanced: Boolean(
							c.opts.instanceBuffer ||
								(c.opts.instanceCount && c.opts.instanceCount > 1),
						),
						instanceBuffer: c.opts.instanceBuffer,
					},
					c.opts.instanceCount ?? 1,
					c.opts.firstInstance ?? 0,
				);
			} else {
				const m = this.quadModelMatrix(c.opts);
				this.quad3dPipeline.drawShadow(
					pass,
					lightCamBindGroup,
					c.texture,
					sampler,
					{
						modelMatrix: m,
						normalMatrix: m,
						width: c.opts.width,
						height: c.opts.height,
						textureExtent: c.opts.textureExtent,
						opacity: c.opts.opacity,
						colorTint: c.opts.colorTint,
					},
				);
			}
		}
		pass.end();

		return {
			matrix: frustum.viewProj,
			lightIndex,
			mapSize,
			softness: options.softness ?? light.shadowSoftness ?? 2.5,
			bias: kind === "directional" ? 0.0006 : 0.00008,
			normalOffset: frustum.texelWorldSize * 1.5,
			darkness: options.darkness ?? light.shadowDarkness ?? 1,
		};
	}

	beginPass(
		encoder: GPUCommandEncoder,
		colorTargetView: GPUTextureView,
		surfaceWidth: number,
		surfaceHeight: number,
		camera: Camera3DPose,
		loadOp: GPULoadOp = "clear",
		clearColor: GPUColor = { r: 0, g: 0, b: 0, a: 0 },
		linearDepthTargetView?: GPUTextureView,
		lights?: Light3DOptions[],
		world?: Scene3DWorld,
		/** Also write unclamped scene radiance (`hdrTexture()`), the bloom source. */
		writeHdr = false,
	): {
		pass: GPURenderPassEncoder;
		cameraBindGroup: GPUBindGroup;
		cameraBuffer: GPUBuffer;
		lightsBindGroup: GPUBindGroup;
	} {
		const depthTex = this.getOrCreateDepthTexture(surfaceWidth, surfaceHeight);
		const cameraBuffer = this.packCameraUniforms(
			camera,
			surfaceWidth,
			surfaceHeight,
		);
		const cameraBindGroup = this.createCameraBindGroup(cameraBuffer);

		const lightsBuffer = this.getOrCreateLightsBuffer(lights, world);
		const lightsBindGroup = this.createLightsBindGroup(
			lightsBuffer,
			Boolean(world?.shadow),
		);

		const msaa = this.sampleCount > 1;
		if (msaa && loadOp === "load") {
			// The multisampled target starts empty: it cannot carry the view's contents in.
			throw new Error(
				"Renderer3D.beginPass: loadOp 'load' needs a Renderer3D built with sampleCount 1",
			);
		}

		// With MSAA each attachment draws into its multisampled twin and
		// resolves into the caller's view when the pass ends.
		const attach = (
			view: GPUTextureView,
			msaaTex: GPUTexture | null,
			clearValue: GPUColor,
			attachmentLoadOp: GPULoadOp,
		): GPURenderPassColorAttachment =>
			msaaTex
				? {
						view: msaaTex.createView(),
						resolveTarget: view,
						loadOp: "clear",
						storeOp: "discard",
						clearValue,
					}
				: { view, loadOp: attachmentLoadOp, storeOp: "store", clearValue };

		if (msaa) {
			this.msaaColorTexture = this.getOrCreateMsaaTexture(
				this.msaaColorTexture,
				"Renderer3DMsaaColor",
				this.format,
				surfaceWidth,
				surfaceHeight,
			);
		}
		const colorAttachments: GPURenderPassColorAttachment[] = [
			attach(
				colorTargetView,
				msaa ? this.msaaColorTexture : null,
				clearColor,
				loadOp,
			),
		];

		if (linearDepthTargetView) {
			if (msaa) {
				this.msaaLinearDepthTexture = this.getOrCreateMsaaTexture(
					this.msaaLinearDepthTexture,
					"Renderer3DMsaaLinearDepth",
					"rgba16float",
					surfaceWidth,
					surfaceHeight,
				);
			}
			colorAttachments.push(
				attach(
					linearDepthTargetView,
					msaa ? this.msaaLinearDepthTexture : null,
					{ r: camera.far, g: 0, b: 0, a: 1 },
					"clear",
				),
			);
		}

		this.passWritesHdr = writeHdr;
		if (writeHdr) {
			this.hdrTexture = this.getOrCreateHdrTexture(surfaceWidth, surfaceHeight);
			if (msaa) {
				this.msaaHdrTexture = this.getOrCreateMsaaTexture(
					this.msaaHdrTexture,
					"Renderer3DMsaaHdr",
					"rgba16float",
					surfaceWidth,
					surfaceHeight,
				);
			}
			colorAttachments.push(
				attach(
					this.hdrTexture.createView(),
					msaa ? this.msaaHdrTexture : null,
					{ r: 0, g: 0, b: 0, a: 0 },
					"clear",
				),
			);
		}

		const pass = encoder.beginRenderPass({
			colorAttachments,
			depthStencilAttachment: {
				view: depthTex.createView(),
				depthClearValue: 1.0,
				depthLoadOp: "clear",
				// Nothing reads depth after the pass; the MSAA copy is never resolved.
				depthStoreOp: msaa ? "discard" : "store",
			},
		});

		return { pass, cameraBindGroup, cameraBuffer, lightsBindGroup };
	}

	beginReflectionPass(
		encoder: GPUCommandEncoder,
		surfaceWidth: number,
		surfaceHeight: number,
		camera: Camera3DPose,
		lights?: Light3DOptions[],
		world?: Scene3DWorld,
	): {
		pass: GPURenderPassEncoder;
		cameraBindGroup: GPUBindGroup;
		lightsBindGroup: GPUBindGroup;
		reflectionTexture: GPUTexture;
	} {
		this.passWritesHdr = false;
		const reflWidth = Math.max(1, Math.floor(surfaceWidth / 2));
		const reflHeight = Math.max(1, Math.floor(surfaceHeight / 2));
		const colorTex = this.getOrCreateReflectionTexture(reflWidth, reflHeight);
		const depthTex = this.getOrCreateReflectionDepthTexture(
			reflWidth,
			reflHeight,
		);

		const cameraBuffer = this.packCameraUniforms(camera, reflWidth, reflHeight);
		const cameraBindGroup = this.createCameraBindGroup(cameraBuffer);

		const lightsData = Light3D.packLightsUniforms(
			lights ?? [],
			world?.environment,
			world?.shadow,
			true,
		);
		const lightsBuffer = this.lightsPool.getBuffer(this.device, lightsData);
		const lightsBindGroup = this.createLightsBindGroup(
			lightsBuffer,
			Boolean(world?.shadow),
		);

		const msaa = this.sampleCount > 1;
		const msaaTex = msaa
			? this.getOrCreateReflectionMsaaTexture(reflWidth, reflHeight)
			: null;

		const colorAttachments: GPURenderPassColorAttachment[] = [
			msaaTex
				? {
						view: msaaTex.createView(),
						resolveTarget: colorTex.createView(),
						loadOp: "clear",
						storeOp: "discard",
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
					}
				: {
						view: colorTex.createView(),
						loadOp: "clear",
						storeOp: "store",
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
					},
		];

		const pass = encoder.beginRenderPass({
			colorAttachments,
			depthStencilAttachment: {
				view: depthTex.createView(),
				depthClearValue: 1.0,
				depthLoadOp: "clear",
				depthStoreOp: msaa ? "discard" : "store",
			},
		});

		return {
			pass,
			cameraBindGroup,
			lightsBindGroup,
			reflectionTexture: colorTex,
		};
	}

	blurReflection(
		encoder: GPUCommandEncoder,
		reflectionTexture: GPUTexture,
		roughness: number,
	): GPUTexture {
		if (roughness <= 0.001) {
			return reflectionTexture;
		}
		const width = reflectionTexture.width;
		const height = reflectionTexture.height;
		const tempTex = this.getOrCreateReflectionTempTexture(width, height);
		const blurredTex = this.getOrCreateReflectionBlurredTexture(width, height);

		this.floorReflectionPipeline.applyBlur(
			encoder,
			reflectionTexture,
			tempTex,
			blurredTex,
			width,
			height,
			roughness,
		);
		return blurredTex;
	}

	drawFloor(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		reflectionTexture: GPUTexture,
		floor: Environment3DFloor,
		useMrt = false,
		useBloom = false,
	): void {
		this.floorReflectionPipeline.draw(
			pass,
			cameraBindGroup,
			lightsBindGroup,
			reflectionTexture,
			floor,
			useMrt,
			useBloom,
		);
	}

	/**
	 * A layer's unit quad ([-0.5, 0.5] square) in world space:
	 * T(pos) * Rz * Ry * Rx * S(w * sx, h * sy, sz) * T(0.5 - ax, 0.5 - ay, 0).
	 */
	private quadModelMatrix(opts: DrawQuad3DOpts): Mat4 {
		if (opts.modelMatrix) return opts.modelMatrix;
		const {
			position,
			width,
			height,
			rotation = [0, 0, 0],
			scale = [1, 1, 1],
			anchor = [0.5, 0.5],
		} = opts;
		let m = Matrix4Math.identity();
		m = Matrix4Math.multiply(
			m,
			Matrix4Math.translate(position[0], position[1], position[2]),
		);

		const rxRad = (rotation[0] * Math.PI) / 180;
		const ryRad = (rotation[1] * Math.PI) / 180;
		const rzRad = (rotation[2] * Math.PI) / 180;

		if (rzRad !== 0) m = Matrix4Math.multiply(m, Matrix4Math.rotateZ(rzRad));
		if (ryRad !== 0) m = Matrix4Math.multiply(m, Matrix4Math.rotateY(ryRad));
		if (rxRad !== 0) m = Matrix4Math.multiply(m, Matrix4Math.rotateX(rxRad));

		const sx = width * scale[0];
		const sy = height * scale[1];
		const sz = scale[2];
		m = Matrix4Math.multiply(m, Matrix4Math.scale(sx, sy, sz));

		// Pivot adjustment relative to centered unit quad [-0.5, 0.5]
		const pivotX = 0.5 - anchor[0];
		const pivotY = 0.5 - anchor[1];
		if (pivotX !== 0 || pivotY !== 0) {
			m = Matrix4Math.multiply(m, Matrix4Math.translate(pivotX, pivotY, 0));
		}
		return m;
	}

	/**
	 * Draw a text layer's captured Slug glyphs on the plane its texture quad
	 * would cover. Glyph coverage is solved per screen pixel, so the text is
	 * as sharp at a glancing angle or up close as it is flat on screen.
	 * `stackBase` is how many passes already sit on this plane (a backdrop
	 * quad): each batch draws just in front of the one before.
	 */
	drawSlugText(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		batches: SlugGlyphBatch[],
		opts: DrawQuad3DOpts,
		stackBase = 0,
		useMrt = false,
	): void {
		const { width, height } = opts;
		if (!(width > 0 && height > 0)) return;
		const quad = this.quadModelMatrix(opts);
		const normalMatrix = opts.normalMatrix ?? Light3D.computeNormalMatrix(quad);
		// Layer px [0, w] x [0, h] onto the unit quad.
		const layerToWorld = Matrix4Math.multiply(
			quad,
			Matrix4Math.multiply(
				Matrix4Math.translate(-0.5, -0.5, 0),
				Matrix4Math.scale(1 / width, 1 / height, 1),
			),
		);

		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			const [a, b, c, d, e, f] = batch.transform;
			const paragraphToLayer: Mat4 = [
				a,
				b,
				0,
				0,
				c,
				d,
				0,
				0,
				0,
				0,
				1,
				0,
				e,
				f,
				0,
				1,
			];
			this.slug3dPipeline.draw(
				pass,
				cameraBindGroup,
				lightsBindGroup,
				batch.font,
				batch.instances,
				batch.instanceCount,
				{
					modelMatrix: Matrix4Math.multiply(layerToWorld, paragraphToLayer),
					normalMatrix,
					opacity: batch.opacity * (opts.opacity ?? 1),
					slant: batch.slant,
					twoSided: opts.twoSided ?? true,
					depthPull: TEXT_STACK_PULL * (stackBase + i + 1),
					material: opts.material,
					shininess: opts.shininess ?? 32.0,
					roughness: opts.roughness,
					specularIntensity: opts.specularIntensity ?? 0.5,
					ambientIntensity: opts.ambientIntensity ?? 1.0,
					metallic: opts.metallic,
					emissive: opts.emissive,
					emissiveIntensity: opts.emissiveIntensity,
					matte: opts.matte,
				},
				useMrt,
				this.passWritesHdr,
			);
		}
	}

	drawTextureQuad(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		texture: GPUTexture,
		opts: DrawQuad3DOpts,
		useMrt = false,
	): void {
		const {
			width,
			height,
			opacity = 1.0,
			colorTint = [1, 1, 1, 1],
			borderColor,
			borderWidth = 0,
			borderRadius = 0,
			twoSided = true,
			material = "lit",
			shininess = 32.0,
			roughness,
			specularIntensity = 0.5,
			ambientIntensity = 1.0,
			metallic,
		} = opts;

		const m = this.quadModelMatrix(opts);
		const normalMatrix = opts.normalMatrix ?? Light3D.computeNormalMatrix(m);
		const sampler = this.samplerCache.getSampler(this.device);

		let parsedBorderColor: [number, number, number, number] | undefined;
		if (borderColor) {
			if (Array.isArray(borderColor)) {
				parsedBorderColor = borderColor;
			} else {
				const c = parseColor(borderColor);
				parsedBorderColor = [c.r, c.g, c.b, c.a];
			}
		}

		this.quad3dPipeline.draw(
			pass,
			cameraBindGroup,
			lightsBindGroup,
			texture,
			sampler,
			{
				modelMatrix: m,
				normalMatrix,
				colorTint,
				borderColor: parsedBorderColor,
				borderWidth,
				opacity,
				borderRadius,
				twoSided,
				width,
				height,
				textureExtent: opts.textureExtent,
				material,
				shininess,
				roughness,
				specularIntensity,
				ambientIntensity,
				metallic,
				emissive: opts.emissive,
				emissiveIntensity: opts.emissiveIntensity,
				matte: opts.matte,
			},
			useMrt,
			this.passWritesHdr,
		);
	}

	/** T(pos) * Rz * Ry * Rx * S, or the draw's precomputed model matrix. */
	private meshModelMatrix(opts: DrawMesh3DOpts): Mat4 {
		if (opts.modelMatrix) return opts.modelMatrix;
		const {
			position = [0, 0, 0],
			rotation = [0, 0, 0],
			scale = [1, 1, 1],
		} = opts;
		let m = Matrix4Math.translate(position[0], position[1], position[2]);
		const rxRad = (rotation[0] * Math.PI) / 180;
		const ryRad = (rotation[1] * Math.PI) / 180;
		const rzRad = (rotation[2] * Math.PI) / 180;
		if (rzRad !== 0) m = Matrix4Math.multiply(m, Matrix4Math.rotateZ(rzRad));
		if (ryRad !== 0) m = Matrix4Math.multiply(m, Matrix4Math.rotateY(ryRad));
		if (rxRad !== 0) m = Matrix4Math.multiply(m, Matrix4Math.rotateX(rxRad));
		return Matrix4Math.multiply(
			m,
			Matrix4Math.scale(scale[0], scale[1], scale[2]),
		);
	}

	getOrCreateMeshBuffers(mesh: Mesh3DData, wireframe = false): GPUMeshBuffers {
		let cached = this.meshBuffersCache.get(mesh);
		if (cached) {
			if (wireframe && (!mesh.topology || mesh.topology === "triangle-list"))
				this.ensureWireIndices(mesh, cached);
			return cached;
		}

		const numVerts = mesh.positions.length / 3;
		// 16 floats per vertex: 3 (pos) + 2 (uv) + 3 (norm) + 4 (joints) + 4 (weights)
		const vertexData = new Float32Array(numVerts * 16);

		for (let i = 0; i < numVerts; i++) {
			const offset = i * 16;
			// pos
			vertexData[offset] = mesh.positions[i * 3] ?? 0;
			vertexData[offset + 1] = mesh.positions[i * 3 + 1] ?? 0;
			vertexData[offset + 2] = mesh.positions[i * 3 + 2] ?? 0;

			// uv
			vertexData[offset + 3] = mesh.uvs[i * 2] ?? 0;
			vertexData[offset + 4] = mesh.uvs[i * 2 + 1] ?? 0;

			// normal
			vertexData[offset + 5] = mesh.normals[i * 3] ?? 0;
			vertexData[offset + 6] = mesh.normals[i * 3 + 1] ?? 0;
			vertexData[offset + 7] = mesh.normals[i * 3 + 2] ?? 1;

			// joints
			if (mesh.jointIndices) {
				vertexData[offset + 8] = mesh.jointIndices[i * 4] ?? 0;
				vertexData[offset + 9] = mesh.jointIndices[i * 4 + 1] ?? 0;
				vertexData[offset + 10] = mesh.jointIndices[i * 4 + 2] ?? 0;
				vertexData[offset + 11] = mesh.jointIndices[i * 4 + 3] ?? 0;
			} else {
				vertexData[offset + 8] = 0;
				vertexData[offset + 9] = 0;
				vertexData[offset + 10] = 0;
				vertexData[offset + 11] = 0;
			}

			// weights
			if (mesh.jointWeights) {
				vertexData[offset + 12] = mesh.jointWeights[i * 4] ?? 0;
				vertexData[offset + 13] = mesh.jointWeights[i * 4 + 1] ?? 0;
				vertexData[offset + 14] = mesh.jointWeights[i * 4 + 2] ?? 0;
				vertexData[offset + 15] = mesh.jointWeights[i * 4 + 3] ?? 0;
			} else {
				vertexData[offset + 12] = 0;
				vertexData[offset + 13] = 0;
				vertexData[offset + 14] = 0;
				vertexData[offset + 15] = 0;
			}
		}

		const alignedVertexByteLength = Math.ceil(vertexData.byteLength / 4) * 4;
		const vertexBuffer = this.device.createBuffer({
			size: Math.max(4, alignedVertexByteLength),
			usage:
				GPUBufferUsage.VERTEX |
				GPUBufferUsage.STORAGE |
				GPUBufferUsage.COPY_DST |
				GPUBufferUsage.COPY_SRC,
			mappedAtCreation: true,
		});
		new Float32Array(vertexBuffer.getMappedRange()).set(vertexData);
		vertexBuffer.unmap();

		const is32Bit = mesh.indices instanceof Uint32Array;
		const alignedIndexByteLength = Math.ceil(mesh.indices.byteLength / 4) * 4;
		const indexBuffer = this.device.createBuffer({
			size: Math.max(4, alignedIndexByteLength),
			usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});
		if (is32Bit) {
			new Uint32Array(indexBuffer.getMappedRange()).set(mesh.indices);
		} else {
			new Uint16Array(indexBuffer.getMappedRange()).set(mesh.indices);
		}
		indexBuffer.unmap();

		let colorBuffer: GPUBuffer | undefined;
		if (mesh.colors && mesh.colors.length >= numVerts * 4) {
			colorBuffer = this.device.createBuffer({
				label: "Mesh3DVertexColors",
				size: Math.max(16, numVerts * 16),
				usage: GPUBufferUsage.VERTEX,
				mappedAtCreation: true,
			});
			new Float32Array(colorBuffer.getMappedRange()).set(
				mesh.colors.subarray(0, numVerts * 4),
			);
			colorBuffer.unmap();
		}

		let mapUvBuffer: GPUBuffer | undefined;
		if (mesh.mapUvs && Object.values(mesh.mapUvs).some(Boolean)) {
			const data = new Float32Array(numVerts * 8);
			const maps = [
				mesh.mapUvs.normal,
				mesh.mapUvs.metallicRoughness,
				mesh.mapUvs.occlusion,
				mesh.mapUvs.emissive,
			];
			for (let i = 0; i < numVerts; i++) {
				for (let j = 0; j < maps.length; j++) {
					const uv = maps[j] ?? mesh.uvs;
					data[i * 8 + j * 2] = uv[i * 2] ?? 0;
					data[i * 8 + j * 2 + 1] = uv[i * 2 + 1] ?? 0;
				}
			}
			mapUvBuffer = this.device.createBuffer({
				label: "Mesh3DMapUvs",
				size: Math.max(32, data.byteLength),
				usage: GPUBufferUsage.VERTEX,
				mappedAtCreation: true,
			});
			new Float32Array(mapUvBuffer.getMappedRange()).set(data);
			mapUvBuffer.unmap();
		}

		cached = {
			vertexBuffer,
			indexBuffer,
			indexCount: mesh.indices.length,
			indexFormat: is32Bit ? "uint32" : "uint16",
			topology: mesh.topology,
			colorBuffer,
			mapUvBuffer,
		};
		this.meshBuffersCache.set(mesh, cached);
		if (wireframe && (!mesh.topology || mesh.topology === "triangle-list"))
			this.ensureWireIndices(mesh, cached);
		return cached;
	}

	private ensureWireIndices(mesh: Mesh3DData, buffers: GPUMeshBuffers): void {
		if (buffers.wireIndexBuffer) return;
		const edges = new Set<string>();
		const indices: number[] = [];
		for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
			const triangle = [
				mesh.indices[i]!,
				mesh.indices[i + 1]!,
				mesh.indices[i + 2]!,
			];
			for (let j = 0; j < 3; j++) {
				const a = triangle[j]!;
				const b = triangle[(j + 1) % 3]!;
				if (a === b) continue;
				const key = a < b ? `${a},${b}` : `${b},${a}`;
				if (edges.has(key)) continue;
				edges.add(key);
				indices.push(a, b);
			}
		}
		const data =
			buffers.indexFormat === "uint32"
				? new Uint32Array(indices)
				: new Uint16Array(indices);
		const buffer = this.device.createBuffer({
			label: "Mesh3DWireIndices",
			size: Math.max(4, Math.ceil(data.byteLength / 4) * 4),
			usage: GPUBufferUsage.INDEX,
			mappedAtCreation: true,
		});
		if (data instanceof Uint32Array)
			new Uint32Array(buffer.getMappedRange()).set(data);
		else new Uint16Array(buffer.getMappedRange()).set(data);
		buffer.unmap();
		buffers.wireIndexBuffer = buffer;
		buffers.wireIndexCount = data.length;
	}

	morphMesh(
		encoder: GPUCommandEncoder,
		mesh: Mesh3DData,
		weights: number[],
		wireframe = false,
	): GPUMeshBuffers {
		const buffers = this.getOrCreateMeshBuffers(mesh, wireframe);
		if (!mesh.morphTargets?.length || !weights.some((weight) => weight !== 0))
			return buffers;
		return {
			...buffers,
			vertexBuffer: this.morphPipeline.execute(
				encoder,
				mesh,
				buffers.vertexBuffer,
				weights,
			),
		};
	}

	deformMesh(
		encoder: GPUCommandEncoder,
		mesh: Mesh3DData,
		audioDeform: {
			config: MeshAudioDeformConfig;
			latentBuffer: GPUBuffer;
			timeMs?: number;
			sampleRate?: number;
		},
		wireframe = false,
		input?: GPUMeshBuffers,
	): GPUMeshBuffers {
		const meshBuffers = input ?? this.getOrCreateMeshBuffers(mesh, wireframe);
		const numVerts = mesh.positions.length / 3;
		const deformedVertexBuffer = this.audioMeshDeformPipeline.execute(
			encoder,
			meshBuffers.vertexBuffer,
			{
				config: audioDeform.config,
				audioLatentBuffer: audioDeform.latentBuffer,
				vertexCount: numVerts,
				timeMs: audioDeform.timeMs,
				sampleRate: audioDeform.sampleRate,
			},
		);
		return {
			vertexBuffer: deformedVertexBuffer,
			indexBuffer: meshBuffers.indexBuffer,
			indexCount: meshBuffers.indexCount,
			indexFormat: meshBuffers.indexFormat,
			topology: meshBuffers.topology,
			colorBuffer: meshBuffers.colorBuffer,
			mapUvBuffer: meshBuffers.mapUvBuffer,
			wireIndexBuffer: meshBuffers.wireIndexBuffer,
			wireIndexCount: meshBuffers.wireIndexCount,
		};
	}

	drawMesh3D(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		meshOrBuffers: Mesh3DData | GPUMeshBuffers,
		texture: GPUTexture | undefined,
		opts: DrawMesh3DOpts = {},
		useMrt = false,
	): void {
		const meshBuffers =
			"vertexBuffer" in meshOrBuffers
				? meshOrBuffers
				: this.getOrCreateMeshBuffers(meshOrBuffers, opts.wireframe);

		const {
			opacity = 1.0,
			colorTint = [1, 1, 1, 1],
			twoSided = true,
			wireframe = false,
			isSkinned = false,
			skinningMatrices,
			material = "lit",
			shadeColor,
			alphaCutoff,
			textureWrap = "clamp",
			textureFilter = "linear",
			shininess = 32.0,
			roughness,
			specularIntensity = 0.5,
			ambientIntensity = 1.0,
			metallic,
		} = opts;

		const m = this.meshModelMatrix(opts);

		const normalMatrix = opts.normalMatrix ?? Light3D.computeNormalMatrix(m);
		const address = ADDRESS_MODES[textureWrap];
		const sampler = this.samplerCache.getSampler(this.device, {
			addressModeU: address,
			addressModeV: address,
			magFilter: textureFilter,
			// Anisotropy requires linear filtering.
			...(textureFilter === "nearest" && { maxAnisotropy: 1 }),
		});

		const glassy =
			material === "glass" || material === "acrylic" || material === "frosted";
		const glass = glassy
			? {
					ior: opts.ior ?? (material === "acrylic" ? 1.49 : 1.5),
					dispersion: opts.dispersion ?? (material === "glass" ? 0.04 : 0.015),
					thickness: opts.thickness ?? 80,
					frost: material === "frosted" ? (roughness ?? 0.5) : 0,
				}
			: undefined;

		this.mesh3dPipeline.draw(
			pass,
			cameraBindGroup,
			lightsBindGroup,
			meshBuffers,
			texture,
			sampler,
			{
				glass,
				backdrop: opts.backdrop,
				modelMatrix: m,
				normalMatrix,
				colorTint,
				opacity,
				twoSided,
				wireframe,
				transparent: opts.transparent ?? (opacity < 1 || colorTint[3] < 1),
				isSkinned,
				skinningMatrices,
				material:
					material === "unlit" || material === "toon" ? material : "lit",
				shadeColor,
				alphaCutoff,
				shininess,
				roughness: glassy ? Math.min(roughness ?? 0.05, 0.3) : roughness,
				specularIntensity,
				ambientIntensity,
				metallic,
				emissive: opts.emissive,
				emissiveIntensity: opts.emissiveIntensity,
				matte: opts.matte,
				maps: opts.maps,
				isInstanced: Boolean(
					opts.instanceBuffer || (opts.instanceCount && opts.instanceCount > 1),
				),
				instanceBuffer: opts.instanceBuffer,
			},
			useMrt,
			this.passWritesHdr,
			opts.instanceCount ?? 1,
			opts.firstInstance ?? 0,
		);
	}

	loadModel(
		srcOrData: string | ArrayBuffer | Uint8Array,
		format:
			| "obj"
			| "fbx"
			| "gltf"
			| "glb"
			| "stl"
			| "ply"
			| "vox"
			| "3ds"
			| "off"
			| "auto" = "auto",
		options: LoadModelOptions = {},
	): Model3DData {
		if (typeof srcOrData !== "string")
			return loadModel3D(srcOrData, format, options);
		const key = `${format}|${JSON.stringify(options)}|${srcOrData}`;
		let model = this.modelCache.get(key);
		if (!model) {
			model = loadModel3D(srcOrData, format, options);
			this.modelCache.set(key, model);
		}
		return model;
	}

	/** Loads glTF asynchronously so its compressed buffer decoders can initialize. */
	async loadModelAsync(
		srcOrData: string | ArrayBuffer | Uint8Array,
		format: Parameters<Renderer3D["loadModel"]>[1] = "auto",
		options: LoadModelOptions = {},
	): Promise<Model3DData> {
		const isGltf =
			format === "gltf" ||
			format === "glb" ||
			(format === "auto" &&
				(typeof srcOrData === "string"
					? /\.(gltf|glb)$/i.test(srcOrData) ||
						srcOrData.trimStart().startsWith("{")
					: GltfLoader.isGlb(srcOrData)));
		if (!isGltf) return this.loadModel(srcOrData, format, options);
		if (typeof srcOrData !== "string") return loadGLTFAsync(srcOrData, options);
		const key = `${format}|${JSON.stringify(options)}|${srcOrData}`;
		const cached = this.modelCache.get(key);
		if (cached) return cached;
		const model = await loadGLTFAsync(srcOrData, options);
		this.modelCache.set(key, model);
		return model;
	}

	/**
	 * The material's diffuse texture on the GPU, decoded once with a full mip
	 * chain (a character's 2K maps are drawn a few hundred pixels tall).
	 */
	materialTexture(material: Material3D): Promise<GPUTexture | undefined> {
		let pending = this.materialTextures.get(material);
		if (!pending) {
			pending = this.uploadMaterialTexture(material);
			this.materialTextures.set(material, pending);
		}
		return pending;
	}

	/**
	 * The material's normal, metallic-roughness, occlusion and emissive maps
	 * on the GPU (each decoded once); absent maps are left out.
	 */
	materialMaps(material: Material3D): Promise<MeshMaterialMaps> {
		let pending = this.materialMapCache.get(material);
		if (!pending) {
			pending = (async () => {
				const label = material.name;
				const [normal, metallicRoughness, occlusion, emissive] =
					await Promise.all([
						this.uploadImage(material.normalTextureBuffer, `${label}:normal`),
						this.uploadImage(
							material.metallicRoughnessTextureBuffer,
							`${label}:metallicRoughness`,
						),
						this.uploadImage(
							material.occlusionTextureBuffer,
							`${label}:occlusion`,
						),
						this.uploadImage(
							material.emissiveTextureBuffer,
							`${label}:emissive`,
						),
					]);
				return {
					...(normal && { normal, normalScale: material.normalScale ?? 1 }),
					...(metallicRoughness && { metallicRoughness }),
					...(occlusion && {
						occlusion,
						occlusionStrength: material.occlusionStrength ?? 1,
					}),
					...(emissive && { emissive }),
				};
			})();
			this.materialMapCache.set(material, pending);
		}
		return pending;
	}

	private uploadMaterialTexture(
		material: Material3D,
	): Promise<GPUTexture | undefined> {
		return this.uploadImage(
			material.diffuseTextureBuffer,
			`Material:${material.name}`,
		);
	}

	/** Decodes an encoded image into a texture with a full mip chain. */
	private async uploadImage(
		encoded: Uint8Array | ArrayBuffer | undefined,
		label: string,
	): Promise<GPUTexture | undefined> {
		if (!encoded) return undefined;
		const bytes =
			encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
		if (isKtx2(bytes)) {
			const decoded = await decodeKtx2(bytes);
			const texture = this.device.createTexture({
				label,
				size: { width: decoded.width, height: decoded.height },
				mipLevelCount: decoded.levels.length,
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			for (const [level, data] of decoded.levels.entries()) {
				const width = Math.max(1, decoded.width >> level);
				const height = Math.max(1, decoded.height >> level);
				this.device.queue.writeTexture(
					{ texture, mipLevel: level },
					data,
					{ bytesPerRow: width * 4, rowsPerImage: height },
					{ width, height },
				);
			}
			return texture;
		}
		const sharp = (await import(/* webpackIgnore: true */ "sharp")).default;
		const source = Buffer.from(
			encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded),
		);
		let width: number | undefined;
		let height: number | undefined;
		try {
			({ width, height } = await sharp(source).metadata());
		} catch (err) {
			// TGA, PSD and other formats sharp cannot decode: draw untextured.
			console.warn(
				`[Renderer3D] Could not decode texture "${label}"; drawing without it:`,
				err instanceof Error ? err.message : err,
			);
			return undefined;
		}
		if (!width || !height) return undefined;
		const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;
		const texture = this.device.createTexture({
			label,
			size: { width, height },
			mipLevelCount,
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		for (let level = 0; level < mipLevelCount; level++) {
			const w = Math.max(1, width >> level);
			const h = Math.max(1, height >> level);
			const data = await sharp(source)
				.ensureAlpha()
				.resize(w, h, { fit: "fill" })
				.raw()
				.toBuffer();
			this.device.queue.writeTexture(
				{ texture, mipLevel: level },
				data,
				{ bytesPerRow: w * 4, rowsPerImage: h },
				{ width: w, height: h },
			);
		}
		return texture;
	}

	/** Writes `source` with bloom into `dest` (see `BloomOptions`). */
	applyBloom(
		encoder: GPUCommandEncoder,
		source: GPUTexture,
		dest: GPUTexture,
		options: BloomOptions = {},
		/** Scene radiance to threshold (from a `writeHdr` pass); default `source`. */
		hdrSource?: GPUTexture | null,
	): void {
		this.bloomPipeline ??= new BloomPipeline(this.device);
		this.bloomPipeline.apply(
			encoder,
			source,
			dest,
			options,
			hdrSource ?? undefined,
		);
	}

	applyDepthOfField(
		encoder: GPUCommandEncoder,
		sourceColorTex: GPUTexture,
		depthTex: GPUTexture,
		destView: GPUTextureView,
		cameraBuffer: GPUBuffer,
	): void {
		const sampler = this.samplerCache.getSampler(this.device);
		const bindGroup = this.device.createBindGroup({
			layout: this.dofBindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: cameraBuffer } },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: sourceColorTex.createView() },
				{ binding: 3, resource: depthTex.createView() },
			],
		});

		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: destView,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});

		pass.setPipeline(this.dofPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3); // Fullscreen triangle
		pass.end();
	}

	/** Uploads raw `InstanceData` float buffer to a GPU storage buffer from the instance pool. */
	uploadInstanceData(data: Float32Array): GPUBuffer {
		return this.instancePool.getBuffer(this.device, data);
	}

	/** Draws instanced 3D meshes in a single hardware-instanced draw call. */
	drawMesh3DInstanced(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		meshOrBuffers: Mesh3DData | GPUMeshBuffers,
		instanceBuffer: GPUBuffer,
		instanceCount: number,
		texture: GPUTexture | undefined = undefined,
		opts: DrawMesh3DOpts = {},
		useMrt = false,
	): void {
		this.drawMesh3D(
			pass,
			cameraBindGroup,
			lightsBindGroup,
			meshOrBuffers,
			texture,
			{
				...opts,
				instanceBuffer,
				instanceCount,
			},
			useMrt,
		);
	}

	destroy(): void {
		this.bloomPipeline?.destroy();
		this.depthTexture?.destroy();
		this.shadowTexture?.destroy();
		this.placeholderShadowTexture?.destroy();
		this.linearDepthTexture?.destroy();
		this.msaaColorTexture?.destroy();
		this.msaaLinearDepthTexture?.destroy();
		this.msaaHdrTexture?.destroy();
		this.hdrTexture?.destroy();
		this.quad3dPipeline.destroy();
		this.slug3dPipeline.destroy();
		this.mesh3dPipeline.destroy();
		this.morphPipeline.destroy();
		this.floorReflectionPipeline.destroy();
		this.reflectionColorTexture?.destroy();
		this.reflectionMsaaColorTexture?.destroy();
		this.reflectionDepthTexture?.destroy();
		this.reflectionTempTexture?.destroy();
		this.reflectionBlurredTexture?.destroy();
		this.cameraPool.destroy();
		this.lightsPool.destroy();
		this.instancePool.destroy();
		this.cameraUniformBindGroupCache.destroy();
	}
}

export function loadModel3D(
	srcOrData: string | ArrayBuffer | Uint8Array,
	format:
		| "obj"
		| "fbx"
		| "gltf"
		| "glb"
		| "stl"
		| "ply"
		| "vox"
		| "3ds"
		| "off"
		| "auto" = "auto",
	options: LoadModelOptions = {},
): Model3DData {
	if (format === "gltf" || format === "glb") {
		return loadGLTF(srcOrData, options);
	}
	if (format === "stl") {
		return loadSTL(srcOrData, options);
	}
	if (format === "ply") {
		return loadPLY(srcOrData, options);
	}
	if (format === "vox") {
		return loadVOX(srcOrData, options);
	}
	if (format === "3ds") {
		return load3DS(srcOrData, options);
	}
	if (format === "off") {
		return loadOFF(srcOrData, options);
	}
	if (format === "fbx") {
		return loadFBX(srcOrData, options);
	}
	if (format === "obj") {
		return loadOBJ(srcOrData, undefined, options);
	}

	// Auto-detection
	const isBinary = typeof srcOrData !== "string";
	const srcStr = typeof srcOrData === "string" ? srcOrData.trim() : "";
	const lowerSrc = srcStr.toLowerCase();

	if (lowerSrc.endsWith(".glb") || lowerSrc.endsWith(".gltf")) {
		return loadGLTF(srcOrData, options);
	}
	if (lowerSrc.endsWith(".stl")) {
		return loadSTL(srcOrData, options);
	}
	if (lowerSrc.endsWith(".ply")) {
		return loadPLY(srcOrData, options);
	}
	if (lowerSrc.endsWith(".vox")) {
		return loadVOX(srcOrData, options);
	}
	if (lowerSrc.endsWith(".3ds")) {
		return load3DS(srcOrData, options);
	}
	if (lowerSrc.endsWith(".off")) {
		return loadOFF(srcOrData, options);
	}
	if (lowerSrc.endsWith(".fbx")) {
		return loadFBX(srcOrData, options);
	}
	if (lowerSrc.endsWith(".obj")) {
		return loadOBJ(srcOrData, undefined, options);
	}

	if (isBinary) {
		const bytes =
			srcOrData instanceof Uint8Array ? srcOrData : new Uint8Array(srcOrData);
		if (GltfLoader.isGlb(bytes)) return loadGLB(bytes, options);
		if (FbxLoader.isBinary(bytes)) return loadFBX(bytes, options);
		if (VoxLoader.isVox(bytes)) return loadVOX(bytes, options);
		if (ThreeDSLoader.is3DS(bytes)) return load3DS(bytes, options);
		if (
			bytes.length >= 3 &&
			bytes[0] === 0x70 &&
			bytes[1] === 0x6c &&
			bytes[2] === 0x79
		) {
			return loadPLY(bytes, options); // "ply"
		}
		if (StlLoader.isBinary(bytes)) return loadSTL(bytes, options);
		return loadOBJ(bytes, undefined, options);
	}

	if (
		srcStr.startsWith("{") &&
		(srcStr.includes('"asset"') || srcStr.includes('"meshes"'))
	) {
		return loadGLTF(srcStr, options);
	}
	if (srcStr.startsWith("ply") || srcStr.startsWith("PLY")) {
		return loadPLY(srcStr, options);
	}
	if (
		srcStr.startsWith("OFF") ||
		srcStr.startsWith("NOFF") ||
		srcStr.startsWith("COFF")
	) {
		return loadOFF(srcStr, options);
	}
	if (srcStr.includes("FBXHeaderExtension") || srcStr.includes("Kaydara FBX")) {
		return loadFBX(srcStr, options);
	}
	if (srcStr.startsWith("solid") && srcStr.includes("facet")) {
		return loadSTL(srcStr, options);
	}

	return loadOBJ(srcOrData, undefined, options);
}
