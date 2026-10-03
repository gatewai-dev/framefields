import { parseColor } from "../color.js";
import { pathWgsl } from "../shaders/path.js";
import { BufferPool } from "./buffer-pool.js";
import type { Color, DrawOpts } from "./index.js";
import {
	dashPathSegments,
	parseSvgPathToSegments,
	type PathSegment,
	type Point,
	trimPathSegments,
} from "./path-geometry.js";
import { UniformBindGroupCache } from "./uniform-bind-group-cache.js";
import type { TransformStack } from "./transform-stack.js";

export interface PathDrawOpts extends DrawOpts {
	trimStart?: number;
	trimEnd?: number;
	trimOffset?: number;
	strokeLineCap?: "round" | "butt" | "square";
	strokeDashArray?: number[];
	strokeDashOffset?: number;
}

export class PathPipeline {
	private device: GPUDevice;
	private pipeline: GPURenderPipeline;
	private maxPipeline: GPURenderPipeline;
	private uniformLayout: GPUBindGroupLayout;
	private uniformPool: BufferPool;
	private vertexPool: BufferPool;
	private uniformBindGroupCache = new UniformBindGroupCache();
	private scratchData = new Float32Array(28);

	constructor(device: GPUDevice, format: GPUTextureFormat) {
		this.device = device;
		this.uniformPool = new BufferPool(
			4096,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.vertexPool = new BufferPool(
			4096,
			GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		);

		const module = device.createShaderModule({
			label: "path.wgsl",
			code: pathWgsl,
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
			label: "PathPipeline",
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

		this.maxPipeline = device.createRenderPipeline({
			label: "PathPipeline.max",
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
								dstFactor: "one",
								operation: "max",
							},
							alpha: {
								srcFactor: "one",
								dstFactor: "one",
								operation: "max",
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

	drawPath(
		pass: GPURenderPassEncoder,
		transformStack: TransformStack,
		pathStr: string,
		color: Color | string,
		strokeWidth: number,
		surfaceWidth: number,
		surfaceHeight: number,
		opts?: PathDrawOpts,
	): void {
		let segments = parseSvgPathToSegments(pathStr);
		if (segments.length === 0) return;

		if (
			opts?.trimStart !== undefined ||
			opts?.trimEnd !== undefined ||
			opts?.trimOffset !== undefined
		) {
			segments = trimPathSegments(
				segments,
				opts.trimStart ?? 0,
				opts.trimEnd ?? 1,
				opts.trimOffset ?? 0,
			);
		}

		if (opts?.strokeDashArray && opts.strokeDashArray.length > 0) {
			segments = dashPathSegments(
				segments,
				opts.strokeDashArray,
				opts.strokeDashOffset ?? 0,
			);
		}

		if (segments.length === 0) return;

		const c = parseColor(color);
		const opacity = opts?.opacity ?? 1.0;
		let capType = 0;
		if (opts?.strokeLineCap === "butt") capType = 1;
		else if (opts?.strokeLineCap === "square") capType = 2;

		for (const segment of segments) {
			this.drawSegment(
				pass,
				transformStack,
				segment.p0,
				segment.p1,
				c,
				strokeWidth,
				capType,
				surfaceWidth,
				surfaceHeight,
				opacity,
				opts,
			);
		}
	}

	drawSegments(
		pass: GPURenderPassEncoder,
		transformStack: TransformStack,
		segments: PathSegment[],
		color: Color | string,
		strokeWidth: number,
		surfaceWidth: number,
		surfaceHeight: number,
		opts?: PathDrawOpts,
	): void {
		let activeSegments = segments;
		if (
			opts?.trimStart !== undefined ||
			opts?.trimEnd !== undefined ||
			opts?.trimOffset !== undefined
		) {
			activeSegments = trimPathSegments(
				activeSegments,
				opts.trimStart ?? 0,
				opts.trimEnd ?? 1,
				opts.trimOffset ?? 0,
			);
		}

		if (opts?.strokeDashArray && opts.strokeDashArray.length > 0) {
			activeSegments = dashPathSegments(
				activeSegments,
				opts.strokeDashArray,
				opts.strokeDashOffset ?? 0,
			);
		}

		if (activeSegments.length === 0) return;

		const c = parseColor(color);
		const opacity = opts?.opacity ?? 1.0;
		let capType = 0;
		if (opts?.strokeLineCap === "butt") capType = 1;
		else if (opts?.strokeLineCap === "square") capType = 2;

		for (const segment of activeSegments) {
			this.drawSegment(
				pass,
				transformStack,
				segment.p0,
				segment.p1,
				c,
				strokeWidth,
				capType,
				surfaceWidth,
				surfaceHeight,
				opacity,
				opts,
			);
		}
	}

	private drawSegment(
		pass: GPURenderPassEncoder,
		transformStack: TransformStack,
		p0: Point,
		p1: Point,
		color: Color,
		strokeWidth: number,
		capType: number,
		surfaceWidth: number,
		surfaceHeight: number,
		opacity: number,
		opts?: DrawOpts,
	): void {
		const data = this.scratchData;
		transformStack.packIntoBuffer(
			data,
			opacity,
			surfaceWidth,
			surfaceHeight,
			opts?.transform,
		);

		data[15] = strokeWidth;
		data[16] = color.r;
		data[17] = color.g;
		data[18] = color.b;
		data[19] = color.a;
		data[20] = capType;
		data[21] = 0;
		data[22] = 0;
		data[23] = 0;
		data[24] = p0.x;
		data[25] = p0.y;
		data[26] = p1.x;
		data[27] = p1.y;

		const uniformBuffer = this.uniformPool.getBuffer(this.device, data);

		// Calculate a quad that covers the line segment plus strokeWidth padding
		const dx = p1.x - p0.x;
		const dy = p1.y - p0.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len < 1e-6) return;

		const padding = strokeWidth * 0.5 + 2.0;
		const nx = (dx / len) * padding;
		const ny = (dy / len) * padding;
		const px = -ny;
		const py = nx;

		const vertexData = new Float32Array([
			p0.x - nx - px,
			p0.y - ny - py,
			p0.x - nx + px,
			p0.y - ny + py,
			p1.x + nx - px,
			p1.y + ny - py,
			p1.x + nx + px,
			p1.y + ny + py,
		]);
		const vertexBuffer = this.vertexPool.getBuffer(this.device, vertexData);

		const useMax = opts?.blendMode === ("max" as any);
		const pipeline = useMax ? this.maxPipeline : this.pipeline;

		pass.setPipeline(pipeline);
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

