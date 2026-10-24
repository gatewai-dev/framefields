import { parseColor } from "../color.js";
import { GRADIENT_UNIFORM_FLOATS } from "../shaders/gradient.js";
import { solidWgsl } from "../shaders/solid.js";
import { BufferPool } from "./buffer-pool.js";
import { asGradient, packGradientUniforms } from "./gradient-uniforms.js";
import type { Color, DrawOpts, Rect } from "./index.js";
import { createUniformLayout, createVec2Pipeline } from "./pipeline-utils.js";
import type { TransformStack } from "./transform-stack.js";
import { UniformBindGroupCache } from "./uniform-bind-group-cache.js";

export class SolidPipeline {
	private device: GPUDevice;
	private pipeline: GPURenderPipeline;
	private uniformLayout: GPUBindGroupLayout;
	private uniformPool: BufferPool;
	private vertexPool: BufferPool;
	private uniformBindGroupCache = new UniformBindGroupCache();
	private uniformData = new Float32Array(24 + GRADIENT_UNIFORM_FLOATS);
	private vertexData = new Float32Array(8);
	// Correct layout for uniformData:
	// transformCol0: vec4 (4)
	// transformCol1: vec4 (4)
	// transformCol2: vec4 (4)
	// params: vec4 (4)
	// color: vec4 (4)
	// rect: vec4 (4)
	// gradient: GradientUniforms (48)
	// Total: 72 floats

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

		this.uniformLayout = createUniformLayout(device);

		this.pipeline = createVec2Pipeline(device, {
			label: "SolidPipeline",
			module,
			uniformLayout: this.uniformLayout,
			format,
			topology: "triangle-strip",
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
		// A CSS gradient string paints the rect with that gradient.
		const gradient = asGradient(color);
		const c = gradient ? { r: 0, g: 0, b: 0, a: 1 } : parseColor(color);
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
		packGradientUniforms(gradient, rect, this.uniformData, 24);

		const uniformBuffer = this.uniformPool.getBuffer(
			this.device,
			this.uniformData,
		);

		// A rounded shape's anti-aliased edge reaches half a device pixel past
		// the rect; grow the quad by a couple of device pixels (in local units)
		// so it isn't cut where the curve meets the rect's sides.
		let grow = 0;
		if (cornerRadius > 0) {
			const m = opts?.transform
				? transformStack.getCurrent().multiply(opts.transform)
				: transformStack.getCurrent();
			const scale = Math.min(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
			grow = 2 / Math.max(scale, 1e-3);
		}
		const x0 = rect.x - grow;
		const y0 = rect.y - grow;
		const x1 = rect.x + rect.width + grow;
		const y1 = rect.y + rect.height + grow;
		this.vertexData[0] = x0;
		this.vertexData[1] = y0;
		this.vertexData[2] = x1;
		this.vertexData[3] = y0;
		this.vertexData[4] = x0;
		this.vertexData[5] = y1;
		this.vertexData[6] = x1;
		this.vertexData[7] = y1;

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
