/**
 * @file packages/webgpu-renderers/src/renderer3d/motion-blur-pipeline.ts
 * WebGPU render pipeline for camera shutter motion blur using screen-space velocity buffers.
 */

import { motionBlurWgsl } from "../shaders/motion-blur.js";

export interface MotionBlurPassOptions {
	shutterAngle?: number;
	sampleCount?: number;
	maxVelocity?: number;
	depthThreshold?: number;
	curveType?: "box" | "gaussian" | "triangle";
	width: number;
	height: number;
}

export class MotionBlurPipeline {
	private device: GPUDevice;
	private pipeline: GPURenderPipeline;
	private bindGroupLayout: GPUBindGroupLayout;
	private uniformBuffer: GPUBuffer;
	private sampler: GPUSampler;

	constructor(device: GPUDevice) {
		this.device = device;

		const shaderModule = device.createShaderModule({
			label: "motion-blur-shader",
			code: motionBlurWgsl,
		});

		this.bindGroupLayout = device.createBindGroupLayout({
			label: "motion-blur-bgl",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "depth" },
				},
				{
					binding: 3,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				},
				{
					binding: 4,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		const pipelineLayout = device.createPipelineLayout({
			label: "motion-blur-layout",
			bindGroupLayouts: [this.bindGroupLayout],
		});

		this.pipeline = device.createRenderPipeline({
			label: "motion-blur-pipeline",
			layout: pipelineLayout,
			vertex: {
				module: shaderModule,
				entryPoint: "vs_main",
			},
			fragment: {
				module: shaderModule,
				entryPoint: "fs_motion_blur",
				targets: [
					{
						format: "rgba8unorm",
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

		this.uniformBuffer = device.createBuffer({
			label: "motion-blur-uniforms",
			size: 32, // 8 * 4 bytes
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		this.sampler = device.createSampler({
			label: "motion-blur-sampler",
			magFilter: "linear",
			minFilter: "linear",
		});
	}

	public render(
		commandEncoder: GPUCommandEncoder,
		colorView: GPUTextureView,
		velocityView: GPUTextureView,
		depthView: GPUTextureView,
		targetView: GPUTextureView,
		options: MotionBlurPassOptions,
	): void {
		const shutterFraction = (options.shutterAngle ?? 180) / 360;
		const sampleCount = options.sampleCount ?? 16;
		const maxVelocity = options.maxVelocity ?? 64;
		const depthThreshold = options.depthThreshold ?? 0.05;
		const curveType =
			options.curveType === "box"
				? 0
				: options.curveType === "triangle"
					? 2
					: 1;

		const uniformData = new ArrayBuffer(32);
		const f32View = new Float32Array(uniformData);
		const u32View = new Uint32Array(uniformData);

		f32View[0] = shutterFraction;
		u32View[1] = sampleCount;
		f32View[2] = maxVelocity;
		u32View[3] = 16; // tileDilation
		f32View[4] = options.width;
		f32View[5] = options.height;
		f32View[6] = depthThreshold;
		u32View[7] = curveType;

		this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

		const bindGroup = this.device.createBindGroup({
			label: "motion-blur-bg",
			layout: this.bindGroupLayout,
			entries: [
				{ binding: 0, resource: colorView },
				{ binding: 1, resource: velocityView },
				{ binding: 2, resource: depthView },
				{ binding: 3, resource: this.sampler },
				{ binding: 4, resource: { buffer: this.uniformBuffer } },
			],
		});

		const pass = commandEncoder.beginRenderPass({
			label: "motion-blur-pass",
			colorAttachments: [
				{
					view: targetView,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});

		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(4);
		pass.end();
	}

	public destroy(): void {
		this.uniformBuffer.destroy();
	}
}
