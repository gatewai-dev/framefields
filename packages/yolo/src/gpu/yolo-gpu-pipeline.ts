/**
 * @file yolo-gpu-pipeline.ts
 * WebGPU Tier T2 acceleration pipeline for hardware letterboxing and mask upscaling.
 */

import { letterboxResizeWgsl } from "./letterbox-resize.wgsl.js";
import { maskUpscaleWgsl } from "./mask-upscale.wgsl.js";

export interface GpuLetterboxOptions {
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly imgsz: number;
	readonly padDw: number;
	readonly padDh: number;
	readonly scale: number;
}

export interface GpuMaskUpscaleOptions {
	readonly maskWidth: number;
	readonly maskHeight: number;
	readonly protoDim: number;
	readonly imgsz: number;
	readonly padDw: number;
	readonly padDh: number;
	readonly scale: number;
	readonly maskThreshold?: number;
	readonly featherRadius?: number;
}

export class YoloGpuPipeline {
	private readonly _device: GPUDevice;
	private _letterboxPipeline?: GPUComputePipeline;
	private _maskUpscalePipeline?: GPUComputePipeline;

	constructor(device: GPUDevice) {
		this._device = device;
	}

	public get device(): GPUDevice {
		return this._device;
	}

	/**
	 * Dispatches hardware letterboxing on a GPU compute queue.
	 */
	public dispatchLetterbox(
		inputTexture: GPUTexture,
		outputBuffer: GPUBuffer,
		options: GpuLetterboxOptions,
		encoder?: GPUCommandEncoder,
	): void {
		if (!this._letterboxPipeline) {
			const module = this._device.createShaderModule({
				label: "yolo_letterbox_resize.wgsl",
				code: letterboxResizeWgsl,
			});
			this._letterboxPipeline = this._device.createComputePipeline({
				label: "YoloLetterboxPipeline",
				layout: "auto",
				compute: {
					module,
					entryPoint: "computeLetterbox",
				},
			});
		}

		// Prepare uniform buffer
		// sourceWidth, sourceHeight, imgsz, padDw, padDh, scale, padValue, pad
		const uniformData = new ArrayBuffer(32);
		const u32View = new Uint32Array(uniformData);
		const f32View = new Float32Array(uniformData);
		u32View[0] = options.sourceWidth;
		u32View[1] = options.sourceHeight;
		u32View[2] = options.imgsz;
		u32View[3] = options.padDw;
		u32View[4] = options.padDh;
		f32View[5] = options.scale;
		f32View[6] = 114.0 / 255.0; // padValue

		const uniformBuffer = this._device.createBuffer({
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this._device.queue.writeBuffer(uniformBuffer, 0, uniformData);

		const bindGroup = this._device.createBindGroup({
			layout: this._letterboxPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: inputTexture.createView() },
				{ binding: 1, resource: { buffer: outputBuffer } },
				{ binding: 2, resource: { buffer: uniformBuffer } },
			],
		});

		const enc =
			encoder ??
			this._device.createCommandEncoder({ label: "yolo_letterbox_encoder" });
		const pass = enc.beginComputePass({ label: "yolo_letterbox_pass" });
		pass.setPipeline(this._letterboxPipeline);
		pass.setBindGroup(0, bindGroup);
		const workgroups = Math.ceil(options.imgsz / 16);
		pass.dispatchWorkgroups(workgroups, workgroups);
		pass.end();

		if (!encoder) {
			this._device.queue.submit([enc.finish()]);
		}
	}

	/**
	 * Dispatches hardware mask upscaling on a GPU compute queue.
	 */
	public dispatchMaskUpscale(
		protoBuffer: GPUBuffer,
		coeffsBuffer: GPUBuffer,
		outputTexture: GPUTexture,
		options: GpuMaskUpscaleOptions,
		encoder?: GPUCommandEncoder,
	): void {
		if (!this._maskUpscalePipeline) {
			const module = this._device.createShaderModule({
				label: "yolo_mask_upscale.wgsl",
				code: maskUpscaleWgsl,
			});
			this._maskUpscalePipeline = this._device.createComputePipeline({
				label: "YoloMaskUpscalePipeline",
				layout: "auto",
				compute: {
					module,
					entryPoint: "computeMaskUpscale",
				},
			});
		}

		// Uniform layout:
		// maskWidth (u32), maskHeight (u32), protoDim (u32), imgsz (u32),
		// padDw (u32), padDh (u32), scale (f32), maskThreshold (f32), featherRadius (f32)
		const uniformData = new ArrayBuffer(48);
		const u32View = new Uint32Array(uniformData);
		const f32View = new Float32Array(uniformData);
		u32View[0] = options.maskWidth;
		u32View[1] = options.maskHeight;
		u32View[2] = options.protoDim;
		u32View[3] = options.imgsz;
		u32View[4] = options.padDw;
		u32View[5] = options.padDh;
		f32View[6] = options.scale;
		f32View[7] = options.maskThreshold ?? 0.5;
		f32View[8] = options.featherRadius ?? 0.05;

		const uniformBuffer = this._device.createBuffer({
			size: 48,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		this._device.queue.writeBuffer(uniformBuffer, 0, uniformData);

		const bindGroup = this._device.createBindGroup({
			layout: this._maskUpscalePipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: protoBuffer } },
				{ binding: 1, resource: { buffer: coeffsBuffer } },
				{ binding: 2, resource: outputTexture.createView() },
				{ binding: 3, resource: { buffer: uniformBuffer } },
			],
		});

		const enc =
			encoder ??
			this._device.createCommandEncoder({ label: "yolo_mask_upscale_encoder" });
		const pass = enc.beginComputePass({ label: "yolo_mask_upscale_pass" });
		pass.setPipeline(this._maskUpscalePipeline);
		pass.setBindGroup(0, bindGroup);
		const wgX = Math.ceil(options.maskWidth / 16);
		const wgY = Math.ceil(options.maskHeight / 16);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();

		if (!encoder) {
			this._device.queue.submit([enc.finish()]);
		}
	}
}
