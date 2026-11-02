import { parseColor } from "../color.js";
import { pathWgsl } from "../shaders/path.js";
import { BufferPool } from "./buffer-pool.js";
import type { Color, DrawOpts } from "./index.js";
import {
	dashPathSegments,
	type PathSegment,
	parseSvgPathToSegments,
	trimPathSegments,
} from "./path-geometry.js";
import { createUniformLayout, PREMULTIPLIED_OVER } from "./pipeline-utils.js";
import type { TransformStack } from "./transform-stack.js";
import { UniformBindGroupCache } from "./uniform-bind-group-cache.js";

export interface PathDrawOpts extends DrawOpts {
	trimStart?: number;
	trimEnd?: number;
	trimOffset?: number;
	strokeLineCap?: "round" | "butt" | "square";
	strokeDashArray?: number[];
	strokeDashOffset?: number;
}

/** A straight segment's two ends, the instance the stroke shader expands into a quad. */
const SEGMENT_FLOATS = 4;

export class PathPipeline {
	private device: GPUDevice;
	private pipeline: GPURenderPipeline;
	private maxPipeline: GPURenderPipeline;
	private uniformLayout: GPUBindGroupLayout;
	private uniformPool: BufferPool;
	private segmentPool: BufferPool;
	private uniformBindGroupCache = new UniformBindGroupCache();
	private scratchData = new Float32Array(24);

	constructor(device: GPUDevice, format: GPUTextureFormat) {
		this.device = device;
		this.uniformPool = new BufferPool(
			4096,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.segmentPool = new BufferPool(
			4096,
			GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		);

		const module = device.createShaderModule({
			label: "path.wgsl",
			code: pathWgsl,
		});

		this.uniformLayout = createUniformLayout(device);
		const create = (label: string, blend: GPUBlendState) =>
			device.createRenderPipeline({
				label,
				layout: device.createPipelineLayout({
					bindGroupLayouts: [this.uniformLayout],
				}),
				vertex: {
					module,
					entryPoint: "vs",
					buffers: [
						{
							arrayStride: SEGMENT_FLOATS * 4,
							stepMode: "instance",
							attributes: [
								{ shaderLocation: 0, offset: 0, format: "float32x4" },
							],
						},
					],
				},
				fragment: {
					module,
					entryPoint: "fs",
					targets: [{ format, blend }],
				},
				primitive: { topology: "triangle-strip" },
			});

		this.pipeline = create("PathPipeline", PREMULTIPLIED_OVER);
		this.maxPipeline = create("PathPipeline.max", {
			color: { srcFactor: "one", dstFactor: "one", operation: "max" },
			alpha: { srcFactor: "one", dstFactor: "one", operation: "max" },
		});
	}

	resetPools(): void {
		this.uniformPool.reset();
		this.segmentPool.reset();
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
		this.drawSegments(
			pass,
			transformStack,
			parseSvgPathToSegments(pathStr),
			color,
			strokeWidth,
			surfaceWidth,
			surfaceHeight,
			opts,
		);
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

		// One instance per segment; a segment of no length draws nothing.
		const ends = new Float32Array(activeSegments.length * SEGMENT_FLOATS);
		let count = 0;
		for (const { p0, p1 } of activeSegments) {
			if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-6) continue;
			const at = count++ * SEGMENT_FLOATS;
			ends[at] = p0.x;
			ends[at + 1] = p0.y;
			ends[at + 2] = p1.x;
			ends[at + 3] = p1.y;
		}
		if (count === 0) return;

		const c = parseColor(color);
		const data = this.scratchData;
		transformStack.packIntoBuffer(
			data,
			opts?.opacity ?? 1.0,
			surfaceWidth,
			surfaceHeight,
			opts?.transform,
		);
		data[15] = strokeWidth;
		data[16] = c.r;
		data[17] = c.g;
		data[18] = c.b;
		data[19] = c.a;
		data[20] =
			opts?.strokeLineCap === "butt"
				? 1
				: opts?.strokeLineCap === "square"
					? 2
					: 0;
		data[21] = 0;
		data[22] = 0;
		data[23] = 0;
		const uniformBuffer = this.uniformPool.getBuffer(this.device, data);
		const segmentBuffer = this.segmentPool.getBuffer(
			this.device,
			ends.subarray(0, count * SEGMENT_FLOATS),
		);

		const useMax = (opts?.blendMode as string | undefined) === "max";
		pass.setPipeline(useMax ? this.maxPipeline : this.pipeline);
		pass.setBindGroup(
			0,
			this.uniformBindGroupCache.getBindGroup(
				this.device,
				this.uniformLayout,
				uniformBuffer,
			),
		);
		pass.setVertexBuffer(0, segmentBuffer);
		pass.draw(4, count);
	}

	destroy(): void {
		this.uniformPool.destroy();
		this.segmentPool.destroy();
		this.uniformBindGroupCache.destroy();
	}
}
