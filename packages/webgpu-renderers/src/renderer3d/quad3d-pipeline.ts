import { BufferPool } from "../renderer2d/buffer-pool.js";
import { quad3dWgsl } from "../shaders/quad3d.js";

export interface ModelUniformData {
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
	public cameraLayout: GPUBindGroupLayout;
	public modelLayout: GPUBindGroupLayout;
	public textureLayout: GPUBindGroupLayout;
	public lightsLayout: GPUBindGroupLayout;
	private modelPool: BufferPool;
	private vertexBuffer: GPUBuffer;
	private indexBuffer: GPUBuffer;
	// 16 (model) + 16 (normal) + 4 (tint) + 4 (borderColor) + 4 (params) + 4 (dimensions) + 4 (materialParams) = 52 floats (208 bytes)
	private modelData = new Float32Array(52);

	constructor(
		device: GPUDevice,
		format: GPUTextureFormat,
		depthFormat: GPUTextureFormat = "depth24plus",
		/** Samples per pixel of the pass this draws into (MSAA). */
		sampleCount = 1,
	) {
		this.device = device;
		this.modelPool = new BufferPool(
			208,
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

		this.lightsLayout = device.createBindGroupLayout({
			label: "Quad3DLightsLayout",
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
					arrayStride: 32, // 3 floats (pos) + 2 floats (uv) + 3 floats (normal) = 32 bytes
					attributes: [
						{ shaderLocation: 0, offset: 0, format: "float32x3" },
						{ shaderLocation: 1, offset: 12, format: "float32x2" },
						{ shaderLocation: 2, offset: 20, format: "float32x3" },
					],
				},
			],
		};

		// 1. Single color target pipeline
		this.pipelineSingle = device.createRenderPipeline({
			label: "Quad3DPipelineSingle",
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

		// 2. MRT pipeline (Color + Linear Depth)
		this.pipelineMrt = device.createRenderPipeline({
			label: "Quad3DPipelineMrt",
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

		// Unit quad centered at origin: [-0.5, -0.5] to [0.5, 0.5] with normal [0, 0, -1]
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

	draw(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		texture: GPUTexture,
		sampler: GPUSampler,
		data: ModelUniformData,
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

		const modelBuffer = this.modelPool.getBuffer(this.device, this.modelData);

		const modelBindGroup = this.device.createBindGroup({
			layout: this.modelLayout,
			entries: [{ binding: 0, resource: { buffer: modelBuffer } }],
		});

		const textureBindGroup = this.device.createBindGroup({
			layout: this.textureLayout,
			entries: [
				{ binding: 0, resource: sampler },
				{ binding: 1, resource: texture.createView() },
			],
		});

		pass.setPipeline(useMrt ? this.pipelineMrt : this.pipelineSingle);
		pass.setBindGroup(0, cameraBindGroup);
		pass.setBindGroup(1, modelBindGroup);
		pass.setBindGroup(2, textureBindGroup);
		pass.setBindGroup(3, lightsBindGroup);
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
