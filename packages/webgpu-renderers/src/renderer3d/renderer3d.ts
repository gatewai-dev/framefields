import {
	Camera3D,
	type Camera3DPose,
	Light3D,
	type Light3DOptions,
	LIGHT_UNIFORM_SIZE_BYTES,
	type Mat4,
	Matrix4Math,
	type Vec3,
	Vector3Math,
} from "../math3d/index.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";
import { SamplerCache } from "../renderer2d/sampler-cache.js";
import { dofBokehWgsl } from "../shaders/dof-bokeh.js";
import {
	FbxLoader,
	GltfLoader,
	load3DS,
	loadFBX,
	loadGLTF,
	loadOBJ,
	loadOFF,
	loadPLY,
	loadSTL,
	loadVOX,
	ObjLoader,
	OffLoader,
	PlyLoader,
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
import { type Color, parseColor } from "../color.js";
import {
	type GPUMeshBuffers,
	Mesh3DPipeline,
	type MeshUniformData,
} from "./mesh3d-pipeline.js";
import { Quad3DPipeline } from "./quad3d-pipeline.js";
import { Slug3DPipeline } from "./slug3d-pipeline.js";
import type { SlugGlyphBatch } from "../slug/slug-pipeline.js";
import { AudioMeshDeformPipeline } from "./audio-mesh-deform-pipeline.js";
import { UniformBindGroupCache } from "../renderer2d/uniform-bind-group-cache.js";
import type { MeshAudioDeformConfig } from "@gitframes/core";

const ADDRESS_MODES: Record<"repeat" | "clamp" | "mirror", GPUAddressMode> = {
	repeat: "repeat",
	clamp: "clamp-to-edge",
	mirror: "mirror-repeat",
};

export interface DrawQuad3DOpts {
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
}

/**
 * How far, as a fraction of the distance to the eye, each pass stacked on a
 * text plane slides toward it. Large enough for depth24 to separate passes
 * out to a few thousand px from the camera, small enough to never be seen.
 */
const TEXT_STACK_PULL = 5e-4;

export interface DrawMesh3DOpts {
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
	/** Wireframe mode */
	wireframe?: boolean;
	/** Whether vertex skinning is enabled */
	isSkinned?: boolean;
	/** Skinning matrices (128 * 16 floats) */
	skinningMatrices?: Float32Array;
	/** Pre-computed model matrix overriding position/rotation/scale if supplied */
	modelMatrix?: Mat4;
	/** Pre-computed normal matrix */
	normalMatrix?: Mat4;
	/** Material shading mode */
	material?: "lit" | "unlit" | "toon";
	/** Toon shading: the shadowed side's color multiplier */
	shadeColor?: [number, number, number];
	/** Discard texels whose alpha is below this (glTF MASK) */
	alphaCutoff?: number;
	/** Texture addressing outside [0, 1] */
	textureWrap?: "repeat" | "clamp" | "mirror";
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
}

export class Renderer3D {
	private device: GPUDevice;
	public format: GPUTextureFormat;
	public quad3dPipeline: Quad3DPipeline;
	public slug3dPipeline: Slug3DPipeline;
	public mesh3dPipeline: Mesh3DPipeline;
	public audioMeshDeformPipeline: AudioMeshDeformPipeline;
	private dofPipeline: GPURenderPipeline;
	private dofBindGroupLayout: GPUBindGroupLayout;
	private cameraPool: BufferPool;
	private lightsPool: BufferPool;
	private cameraUniformBindGroupCache = new UniformBindGroupCache();
	private lightsUniformBindGroupCache = new UniformBindGroupCache();
	private samplerCache = new SamplerCache();
	private depthTexture: GPUTexture | null = null;
	private linearDepthTexture: GPUTexture | null = null;
	private cameraUniformData = new Float32Array(80); // 320 bytes = 80 floats
	private meshBuffersCache = new WeakMap<Mesh3DData, GPUMeshBuffers>();
	private materialTextures = new WeakMap<
		Material3D,
		Promise<GPUTexture | undefined>
	>();
	/** Parsed models by source and load options: a model file is read once, not every frame. */
	private modelCache = new Map<string, Model3DData>();
	private lastCameraPose: Camera3DPose | null = null;
	private lastCameraBuffer: GPUBuffer | null = null;

	constructor(device: GPUDevice, format: GPUTextureFormat) {
		this.device = device;
		this.format = format;
		this.quad3dPipeline = new Quad3DPipeline(device, format);
		this.slug3dPipeline = new Slug3DPipeline(
			device,
			format,
			"depth24plus",
			this.quad3dPipeline.cameraLayout,
			this.quad3dPipeline.lightsLayout,
		);
		this.mesh3dPipeline = new Mesh3DPipeline(
			device,
			format,
			"depth24plus",
			this.quad3dPipeline.cameraLayout,
			this.quad3dPipeline.lightsLayout,
		);
		this.audioMeshDeformPipeline = new AudioMeshDeformPipeline(device);

		this.cameraPool = new BufferPool(
			320,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		this.lightsPool = new BufferPool(
			LIGHT_UNIFORM_SIZE_BYTES,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
		this.cameraPool.reset();
		this.lightsPool.reset();
		this.quad3dPipeline.resetPools();
		this.slug3dPipeline.resetPools();
		this.mesh3dPipeline.resetPools();
		this.audioMeshDeformPipeline.resetPools();
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
				usage: GPUTextureUsage.RENDER_ATTACHMENT,
			});
		}
		return this.depthTexture;
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

	public getOrCreateLightsBuffer(lights?: Light3DOptions[]): GPUBuffer {
		const lightsData = Light3D.packLightsUniforms(lights ?? []);
		return this.lightsPool.getBuffer(this.device, lightsData);
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

		const lightsBuffer = this.getOrCreateLightsBuffer(lights);
		const lightsBindGroup = this.lightsUniformBindGroupCache.getBindGroup(
			this.device,
			this.quad3dPipeline.lightsLayout,
			lightsBuffer,
		);

		const colorAttachments: GPURenderPassColorAttachment[] = [
			{
				view: colorTargetView,
				loadOp,
				storeOp: "store",
				clearValue: clearColor,
			},
		];

		if (linearDepthTargetView) {
			colorAttachments.push({
				view: linearDepthTargetView,
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: camera.far, g: 0, b: 0, a: 1 },
			});
		}

		const pass = encoder.beginRenderPass({
			colorAttachments,
			depthStencilAttachment: {
				view: depthTex.createView(),
				depthClearValue: 1.0,
				depthLoadOp: "clear",
				depthStoreOp: "store",
			},
		});

		return { pass, cameraBindGroup, cameraBuffer, lightsBindGroup };
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
				},
				useMrt,
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
			},
			useMrt,
		);
	}

	getOrCreateMeshBuffers(mesh: Mesh3DData): GPUMeshBuffers {
		let cached = this.meshBuffersCache.get(mesh);
		if (cached) return cached;

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

		cached = {
			vertexBuffer,
			indexBuffer,
			indexCount: mesh.indices.length,
			indexFormat: is32Bit ? "uint32" : "uint16",
		};
		this.meshBuffersCache.set(mesh, cached);
		return cached;
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
	): GPUMeshBuffers {
		const meshBuffers = this.getOrCreateMeshBuffers(mesh);
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
				: this.getOrCreateMeshBuffers(meshOrBuffers);

		const {
			position = [0, 0, 0],
			rotation = [0, 0, 0],
			scale = [1, 1, 1],
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
			shininess = 32.0,
			roughness,
			specularIntensity = 0.5,
			ambientIntensity = 1.0,
			metallic,
		} = opts;

		let m: Mat4;
		if (opts.modelMatrix) {
			m = opts.modelMatrix;
		} else {
			m = Matrix4Math.identity();
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

			m = Matrix4Math.multiply(
				m,
				Matrix4Math.scale(scale[0], scale[1], scale[2]),
			);
		}

		const normalMatrix = opts.normalMatrix ?? Light3D.computeNormalMatrix(m);
		const address = ADDRESS_MODES[textureWrap];
		const sampler = this.samplerCache.getSampler(this.device, {
			addressModeU: address,
			addressModeV: address,
		});

		this.mesh3dPipeline.draw(
			pass,
			cameraBindGroup,
			lightsBindGroup,
			meshBuffers,
			texture,
			sampler,
			{
				modelMatrix: m,
				normalMatrix,
				colorTint,
				opacity,
				twoSided,
				wireframe,
				isSkinned,
				skinningMatrices,
				material,
				shadeColor,
				alphaCutoff,
				shininess,
				roughness,
				specularIntensity,
				ambientIntensity,
				metallic,
			},
			useMrt,
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

	private async uploadMaterialTexture(
		material: Material3D,
	): Promise<GPUTexture | undefined> {
		const encoded = material.diffuseTextureBuffer;
		if (!encoded) return undefined;
		const sharp = (await import(/* webpackIgnore: true */ "sharp")).default;
		const source = Buffer.from(
			encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded),
		);
		const { width, height } = await sharp(source).metadata();
		if (!width || !height) return undefined;
		const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;
		const texture = this.device.createTexture({
			label: `Material:${material.name}`,
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

	destroy(): void {
		this.depthTexture?.destroy();
		this.linearDepthTexture?.destroy();
		this.quad3dPipeline.destroy();
		this.slug3dPipeline.destroy();
		this.mesh3dPipeline.destroy();
		this.cameraPool.destroy();
		this.lightsPool.destroy();
		this.cameraUniformBindGroupCache.destroy();
		this.lightsUniformBindGroupCache.destroy();
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
