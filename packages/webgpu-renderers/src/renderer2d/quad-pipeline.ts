import { quadWgsl } from "../shaders/quad.js";
import type { BindGroupCache } from "./bind-group-cache.js";
import type { DrawOpts, Rect } from "./index.js";
import { UniformBindGroupCache } from "./uniform-bind-group-cache.js";
import type { TransformStack } from "./transform-stack.js";

class BufferPool {
	private buffers: GPUBuffer[] = [];
	private index = 0;
	private size: number;
	private usage: GPUBufferUsageFlags;

	constructor(size: number, usage: GPUBufferUsageFlags) {
		this.size = size;
		this.usage = usage;
	}

	getBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
		if (this.index >= this.buffers.length) {
			const buf = device.createBuffer({
				size: this.size,
				usage: this.usage,
			});
			this.buffers.push(buf);
		}
		const buf = this.buffers[this.index++];
		device.queue.writeBuffer(buf, 0, data);
		return buf;
	}

	reset(): void {
		this.index = 0;
	}

	destroy(): void {
		for (const buf of this.buffers) {
			buf.destroy();
		}
		this.buffers = [];
	}
}

export class QuadPipeline {
	private device: GPUDevice;
	private pipeline: GPURenderPipeline;
	private uniformLayout: GPUBindGroupLayout;
	private textureLayout: GPUBindGroupLayout;
	private uniformPool: BufferPool;
	private vertexPool: BufferPool;
	private uniformBindGroupCache = new UniformBindGroupCache();
	private uniformData = new Float32Array(16);
	private vertexData = new Float32Array(16);

	constructor(device: GPUDevice, format: GPUTextureFormat) {
		this.device = device;
		this.uniformPool = new BufferPool(
			64,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.vertexPool = new BufferPool(
			64,
			GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		);

		const module = device.createShaderModule({
			label: "quad.wgsl",
			code: quadWgsl,
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

		this.textureLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				},
			],
		});

		const pipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.uniformLayout, this.textureLayout],
		});

		this.pipeline = device.createRenderPipeline({
			label: "QuadPipeline",
			layout: pipelineLayout,
			vertex: {
				module,
				entryPoint: "vs",
				buffers: [
					{
						arrayStride: 16,
						attributes: [
							{ shaderLocation: 0, offset: 0, format: "float32x2" },
							{ shaderLocation: 1, offset: 8, format: "float32x2" },
						],
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
			primitive: {
				topology: "triangle-strip",
			},
		});
	}

	resetPools(): void {
		this.uniformPool.reset();
		this.vertexPool.reset();
	}

	draw(
		pass: GPURenderPassEncoder,
		bindGroupCache: BindGroupCache,
		transformStack: TransformStack,
		texture: GPUTexture,
		sampler: GPUSampler,
		src: Rect,
		dst: Rect,
		surfaceWidth: number,
		surfaceHeight: number,
		opts?: DrawOpts,
	): void {
		const opacity = opts?.opacity ?? 1.0;

		transformStack.packIntoBuffer(
			this.uniformData,
			opacity,
			surfaceWidth,
			surfaceHeight,
			opts?.transform,
		);
		const uniformBuffer = this.uniformPool.getBuffer(
			this.device,
			this.uniformData,
		);

		const u0 = src.x / texture.width;
		const v0 = src.y / texture.height;
		const u1 = (src.x + src.width) / texture.width;
		const v1 = (src.y + src.height) / texture.height;

		this.vertexData[0] = dst.x;
		this.vertexData[1] = dst.y;
		this.vertexData[2] = u0;
		this.vertexData[3] = v0;

		this.vertexData[4] = dst.x + dst.width;
		this.vertexData[5] = dst.y;
		this.vertexData[6] = u1;
		this.vertexData[7] = v0;

		this.vertexData[8] = dst.x;
		this.vertexData[9] = dst.y + dst.height;
		this.vertexData[10] = u0;
		this.vertexData[11] = v1;

		this.vertexData[12] = dst.x + dst.width;
		this.vertexData[13] = dst.y + dst.height;
		this.vertexData[14] = u1;
		this.vertexData[15] = v1;

		const vertexBuffer = this.vertexPool.getBuffer(
			this.device,
			this.vertexData,
		);

		const uniformBindGroup = this.uniformBindGroupCache.getBindGroup(
			this.device,
			this.uniformLayout,
			uniformBuffer,
		);

		const textureBindGroup = bindGroupCache.getBindGroup(
			this.device,
			this.textureLayout,
			texture,
			sampler,
		);

		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, uniformBindGroup);
		pass.setBindGroup(1, textureBindGroup);
		pass.setVertexBuffer(0, vertexBuffer);
		pass.draw(4);
	}

	destroy(): void {
		this.uniformPool.destroy();
		this.vertexPool.destroy();
		this.uniformBindGroupCache.destroy();
	}
}
