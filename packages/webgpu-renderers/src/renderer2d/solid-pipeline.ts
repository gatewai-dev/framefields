import { parseColor } from "../color.js";
import { solidWgsl } from "../shaders/solid.js";
import { BufferPool } from "./buffer-pool.js";
import type { Color, DrawOpts, Rect } from "./index.js";
import { UniformBindGroupCache } from "./uniform-bind-group-cache.js";
import type { TransformStack } from "./transform-stack.js";

export class SolidPipeline {
	private device: GPUDevice;
	private pipeline: GPURenderPipeline;
	private uniformLayout: GPUBindGroupLayout;
	private uniformPool: BufferPool;
	private vertexPool: BufferPool;
	private uniformBindGroupCache = new UniformBindGroupCache();
	private uniformData = new Float32Array(24);
	private vertexData = new Float32Array(8);
	// Correct layout for uniformData:
	// transformCol0: vec4 (4)
	// transformCol1: vec4 (4)
	// transformCol2: vec4 (4)
	// params: vec4 (4)
	// color: vec4 (4)
	// rect: vec4 (4)
	// Total: 24 floats

	constructor(device: GPUDevice, format: GPUTextureFormat) {
		this.device = device;
		this.uniformPool = new BufferPool(
			1024,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.vertexPool = new BufferPool(
			256,
			GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		);

		const module = device.createShaderModule({
			label: "solid.wgsl",
			code: solidWgsl,
		});

		this.uniformLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		this.pipeline = device.createRenderPipeline({
			label: "SolidPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [this.uniformLayout],
			}),
			vertex: {
				module,
				entryPoint: "vs",
				buffers: [
					{
						arrayStride: 8,
						attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
					},
				],
			},
			fragment: {
				module,
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
			primitive: { topology: "triangle-strip" },
		});
	}

	resetPools(): void {
		this.uniformPool.reset();
		this.vertexPool.reset();
	}

	draw(
		pass: GPURenderPassEncoder,
		transformStack: TransformStack,
		rect: Rect,
		color: Color | string,
		surfaceWidth: number,
		surfaceHeight: number,
		cornerRadius = 0,
		opts?: DrawOpts,
	): void {
		const c = parseColor(color);
		const opacity = opts?.opacity ?? 1.0;

		transformStack.packIntoBuffer(
			this.uniformData,
			opacity,
			surfaceWidth,
			surfaceHeight,
			opts?.transform,
		);

		this.uniformData[15] = cornerRadius; // params.w

		this.uniformData[16] = c.r;
		this.uniformData[17] = c.g;
		this.uniformData[18] = c.b;
		this.uniformData[19] = c.a;

		this.uniformData[20] = rect.x;
		this.uniformData[21] = rect.y;
		this.uniformData[22] = rect.width;
		this.uniformData[23] = rect.height;

		const uniformBuffer = this.uniformPool.getBuffer(
			this.device,
			this.uniformData,
		);

		this.vertexData[0] = rect.x;
		this.vertexData[1] = rect.y;
		this.vertexData[2] = rect.x + rect.width;
		this.vertexData[3] = rect.y;
		this.vertexData[4] = rect.x;
		this.vertexData[5] = rect.y + rect.height;
		this.vertexData[6] = rect.x + rect.width;
		this.vertexData[7] = rect.y + rect.height;

		const vertexBuffer = this.vertexPool.getBuffer(
			this.device,
			this.vertexData,
		);

		pass.setPipeline(this.pipeline);
		const uniformBindGroup = this.uniformBindGroupCache.getBindGroup(
			this.device,
			this.uniformLayout,
			uniformBuffer,
		);
		pass.setBindGroup(0, uniformBindGroup);
		pass.setVertexBuffer(0, vertexBuffer);
		pass.draw(4);
	}

	destroy(): void {
		this.uniformPool.destroy();
		this.vertexPool.destroy();
		this.uniformBindGroupCache.destroy();
	}
}
