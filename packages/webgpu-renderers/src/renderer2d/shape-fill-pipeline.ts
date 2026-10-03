import { parseColor } from "../color.js";
import { shapeFillWgsl } from "../shaders/shape-fill.js";
import { BufferPool } from "./buffer-pool.js";
import type { Color, DrawOpts, Rect } from "./index.js";
import type { TransformStack } from "./transform-stack.js";

export type ShapeFillType = "solid" | "linear" | "radial" | "none";

export interface ShapeFillConfig {
	type?: ShapeFillType;
	color?: Color | string;
	color2?: Color | string;
	startX?: number;
	startY?: number;
	endX?: number;
	endY?: number;
	cx?: number;
	cy?: number;
	radius?: number;
}

export class ShapeFillPipeline {
	private device: GPUDevice;
	private pipeline: GPURenderPipeline;
	private uniformLayout: GPUBindGroupLayout;
	private uniformPool: BufferPool;
	private vertexPool: BufferPool;
	private uniformData = new Float32Array(28);

	constructor(device: GPUDevice, format: GPUTextureFormat) {
		this.device = device;
		this.uniformPool = new BufferPool(
			2048,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.vertexPool = new BufferPool(
			8192,
			GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		);

		const module = device.createShaderModule({
			label: "shape-fill.wgsl",
			code: shapeFillWgsl,
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
			label: "ShapeFillPipeline",
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
			primitive: { topology: "triangle-list" },
		});
	}

	resetPools(): void {
		this.uniformPool.reset();
		this.vertexPool.reset();
	}

	draw(
		pass: GPURenderPassEncoder,
		transformStack: TransformStack,
		vertices: Float32Array,
		fill: ShapeFillConfig,
		bounds: Rect,
		surfaceWidth: number,
		surfaceHeight: number,
		opts?: DrawOpts,
	): void {
		if (vertices.length < 6 || fill.type === "none") return;

		const opacity = opts?.opacity ?? 1.0;
		transformStack.packIntoBuffer(
			this.uniformData,
			opacity,
			surfaceWidth,
			surfaceHeight,
			opts?.transform,
		);

		let fillTypeNum = 0;
		if (fill.type === "linear") fillTypeNum = 1;
		else if (fill.type === "radial") fillTypeNum = 2;

		this.uniformData[15] = fillTypeNum;

		const c1 = parseColor(fill.color ?? "#ffffff");
		this.uniformData[16] = c1.r;
		this.uniformData[17] = c1.g;
		this.uniformData[18] = c1.b;
		this.uniformData[19] = c1.a;

		const c2 = parseColor(fill.color2 ?? fill.color ?? "#ffffff");
		this.uniformData[20] = c2.r;
		this.uniformData[21] = c2.g;
		this.uniformData[22] = c2.b;
		this.uniformData[23] = c2.a;

		if (fillTypeNum === 1) {
			this.uniformData[24] = fill.startX ?? bounds.x;
			this.uniformData[25] = fill.startY ?? bounds.y;
			this.uniformData[26] = fill.endX ?? bounds.x + bounds.width;
			this.uniformData[27] = fill.endY ?? bounds.y + bounds.height;
		} else if (fillTypeNum === 2) {
			this.uniformData[24] = fill.cx ?? bounds.x + bounds.width / 2;
			this.uniformData[25] = fill.cy ?? bounds.y + bounds.height / 2;
			this.uniformData[26] =
				fill.radius ?? Math.max(bounds.width, bounds.height) / 2;
			this.uniformData[27] = 0;
		} else {
			this.uniformData[24] = 0;
			this.uniformData[25] = 0;
			this.uniformData[26] = 0;
			this.uniformData[27] = 0;
		}

		const uniformBuffer = this.uniformPool.getBuffer(
			this.device,
			this.uniformData,
		);
		const vertexBuffer = this.vertexPool.getBuffer(this.device, vertices);

		pass.setPipeline(this.pipeline);
		pass.setBindGroup(
			0,
			this.device.createBindGroup({
				layout: this.uniformLayout,
				entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
			}),
		);
		pass.setVertexBuffer(0, vertexBuffer);
		pass.draw(vertices.length / 2);
	}

	destroy(): void {
		this.uniformPool.destroy();
		this.vertexPool.destroy();
	}
}
