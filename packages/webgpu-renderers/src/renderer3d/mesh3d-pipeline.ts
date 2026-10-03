import { BufferPool } from "../renderer2d/buffer-pool.js";
import { mesh3dWgsl } from "../shaders/mesh3d.js";

export interface MeshUniformData {
	modelMatrix: Float32Array | number[];
	normalMatrix?: Float32Array | number[];
	colorTint?: [number, number, number, number];
	opacity?: number;
	twoSided?: boolean;
	wireframe?: boolean;
	isSkinned?: boolean;
	skinningMatrices?: Float32Array; // 128 * 16 floats
	material?: "lit" | "unlit" | "toon";
	/** Toon shading: the shadowed side's color multiplier. */
	shadeColor?: [number, number, number];
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
}

export class Mesh3DPipeline {
	private device: GPUDevice;
	public pipelineSingle: GPURenderPipeline;
	public pipelineMrt: GPURenderPipeline;
	public cameraLayout: GPUBindGroupLayout;
	public modelLayout: GPUBindGroupLayout;
	public textureLayout: GPUBindGroupLayout;
	public lightsLayout: GPUBindGroupLayout;
	private modelPool: BufferPool;
	private skinningPool: BufferPool;
	public defaultWhiteTexture: GPUTexture;
	private defaultSkinningBuffer: GPUBuffer;

	// 16 (model) + 16 (normal) + 4 (tint) + 4 (params) + 4 (materialParams) + 4 (shade) = 48 floats (192 bytes)
	private modelData = new Float32Array(48);

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
			192,
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
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
			],
		});

		this.lightsLayout =
			lightsLayout ??
			device.createBindGroupLayout({
				label: "Mesh3DLightsLayout",
				entries: [
					{
						binding: 0,
						visibility: GPUShaderStage.FRAGMENT,
						buffer: { type: "uniform" },
					},
				],
			});

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
			],
		};

		// Single color target pipeline
		this.pipelineSingle = device.createRenderPipeline({
			label: "Mesh3DPipelineSingle",
			layout: pipelineLayout,
			vertex: vertexState,
			fragment: {
				module,
				entryPoint: "fs_single",
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
			multisample: { count: sampleCount },
		});

		// MRT pipeline (Color + Linear Depth)
		this.pipelineMrt = device.createRenderPipeline({
			label: "Mesh3DPipelineMrt",
			layout: pipelineLayout,
			vertex: vertexState,
			fragment: {
				module,
				entryPoint: "fs_mrt",
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
					{
						format: "rgba16float", // Linear depth attachment
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
			multisample: { count: sampleCount },
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

	draw(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		meshBuffers: GPUMeshBuffers,
		texture: GPUTexture | undefined,
		sampler: GPUSampler,
		data: MeshUniformData,
		useMrt = false,
	): void {
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
		this.modelData[37] = data.twoSided ? 1.0 : 0.0;
		this.modelData[38] = data.isSkinned ? 1.0 : 0.0;
		this.modelData[39] = data.wireframe ? 1.0 : 0.0;

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

		const modelBuffer = this.modelPool.getBuffer(
			this.device,
			this.modelData,
		);

		const skinningBuffer =
			data.isSkinned && data.skinningMatrices
				? this.skinningPool.getBuffer(this.device, data.skinningMatrices)
				: this.defaultSkinningBuffer;

		const modelBindGroup = this.device.createBindGroup({
			layout: this.modelLayout,
			entries: [
				{ binding: 0, resource: { buffer: modelBuffer } },
				{ binding: 1, resource: { buffer: skinningBuffer } },
			],
		});

		const actualTexture = texture ?? this.defaultWhiteTexture;
		const textureBindGroup = this.device.createBindGroup({
			layout: this.textureLayout,
			entries: [
				{ binding: 0, resource: sampler },
				{ binding: 1, resource: actualTexture.createView() },
			],
		});

		pass.setPipeline(useMrt ? this.pipelineMrt : this.pipelineSingle);
		pass.setBindGroup(0, cameraBindGroup);
		pass.setBindGroup(1, modelBindGroup);
		pass.setBindGroup(2, textureBindGroup);
		pass.setBindGroup(3, lightsBindGroup);
		pass.setVertexBuffer(0, meshBuffers.vertexBuffer);
		pass.setIndexBuffer(meshBuffers.indexBuffer, meshBuffers.indexFormat);
		pass.drawIndexed(meshBuffers.indexCount);
	}

	destroy(): void {
		this.modelPool.destroy();
		this.skinningPool.destroy();
		this.defaultWhiteTexture.destroy();
		this.defaultSkinningBuffer.destroy();
	}
}
