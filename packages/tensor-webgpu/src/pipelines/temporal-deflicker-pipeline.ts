/**
 * @file temporal-deflicker-pipeline.ts
 * Native WebGPU Temporal De-flickering Pipeline
 * Combines dense optical flow motion estimation with motion-compensated forward warping
 * and adaptive photometric blending to eliminate generative video flicker.
 */

import type { DeflickerOptions } from "@gitframes/core";
import {
	temporalWarpBlendRgba8Wgsl,
	temporalWarpBlendRgba16fWgsl,
} from "../shaders/temporal-warp-blend.wgsl.js";
import { OpticalFlowComputePipeline } from "./optical-flow-pipeline.js";

export class TemporalDeflickerPipeline {
	private flowPipeline: OpticalFlowComputePipeline;
	private rgba8Pipeline: GPUComputePipeline;
	private rgba16fPipeline: GPUComputePipeline;
	private uniformBuffer: GPUBuffer;
	private bilinearSampler: GPUSampler;

	private historyTexture?: GPUTexture;
	private cachedOutputTexture?: GPUTexture;

	constructor(private device: GPUDevice) {
		this.flowPipeline = new OpticalFlowComputePipeline(device);

		const rgba8Module = device.createShaderModule({
			label: "temporal_warp_blend_rgba8.wgsl",
			code: temporalWarpBlendRgba8Wgsl,
		});
		this.rgba8Pipeline = device.createComputePipeline({
			label: "TemporalWarpBlendRgba8Pipeline",
			layout: "auto",
			compute: {
				module: rgba8Module,
				entryPoint: "warpBlend",
			},
		});

		const rgba16fModule = device.createShaderModule({
			label: "temporal_warp_blend_rgba16f.wgsl",
			code: temporalWarpBlendRgba16fWgsl,
		});
		this.rgba16fPipeline = device.createComputePipeline({
			label: "TemporalWarpBlendRgba16fPipeline",
			layout: "auto",
			compute: {
				module: rgba16fModule,
				entryPoint: "warpBlend",
			},
		});

		this.uniformBuffer = device.createBuffer({
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "temporal_deflicker_uniform",
		});

		this.bilinearSampler = device.createSampler({
			label: "temporal_deflicker_sampler",
			magFilter: "linear",
			minFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
		});
	}

	public execute(
		currTexture: GPUTexture,
		options: DeflickerOptions = {},
		customEncoder?: GPUCommandEncoder,
	): GPUTexture {
		const width = currTexture.width;
		const height = currTexture.height;
		const rawBlendWeight = options.blendWeight ?? 0.35;
		const blendWeight =
			typeof rawBlendWeight === "number"
				? rawBlendWeight
				: Number(rawBlendWeight);
		const disocclusionThreshold = options.disocclusionThreshold ?? 0.15;
		const maxMotionPixels = options.maxMotionPixels ?? 64.0;
		const format: GPUTextureFormat = currTexture.format;
		const isRgba16f = format === "rgba16float";

		// 1. Ensure output texture matches size & format
		if (
			!this.cachedOutputTexture ||
			this.cachedOutputTexture.width !== width ||
			this.cachedOutputTexture.height !== height ||
			this.cachedOutputTexture.format !== format
		) {
			this.cachedOutputTexture?.destroy();
			this.cachedOutputTexture = this.device.createTexture({
				label: `deflickered_output_${format}`,
				size: [width, height],
				format,
				usage:
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_SRC |
					GPUTextureUsage.COPY_DST |
					GPUTextureUsage.RENDER_ATTACHMENT,
			});
		}

		// 2. Check if this is the first frame or dimension change
		const isFirstFrame =
			!this.historyTexture ||
			this.historyTexture.width !== width ||
			this.historyTexture.height !== height;

		if (isFirstFrame) {
			this.historyTexture?.destroy();
			this.historyTexture = this.device.createTexture({
				label: "deflicker_history_texture",
				size: [width, height],
				format,
				usage:
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_DST |
					GPUTextureUsage.COPY_SRC,
			});

			const commandEncoder =
				customEncoder ??
				this.device.createCommandEncoder({
					label: "deflicker_first_frame_encoder",
				});

			// Copy current frame to history buffer
			commandEncoder.copyTextureToTexture(
				{ texture: currTexture },
				{ texture: this.historyTexture },
				[width, height],
			);

			// Copy current frame directly to output
			commandEncoder.copyTextureToTexture(
				{ texture: currTexture },
				{ texture: this.cachedOutputTexture },
				[width, height],
			);

			if (!customEncoder) {
				this.device.queue.submit([commandEncoder.finish()]);
			}
			return this.cachedOutputTexture;
		}

		// 3. For Frame N >= 1: Compute Optical Flow motion vectors between history (N-1) and curr (N)
		const flowTexture = this.flowPipeline.execute(
			this.historyTexture,
			currTexture,
			options.opticalFlow,
			customEncoder,
		);

		// 4. Update uniform buffer
		const uniformData = new ArrayBuffer(32);
		const u32View = new Uint32Array(uniformData);
		const f32View = new Float32Array(uniformData);
		u32View[0] = width;
		u32View[1] = height;
		f32View[2] = blendWeight;
		f32View[3] = disocclusionThreshold;
		f32View[4] = maxMotionPixels;
		f32View[5] = 0.0; // isFirstFrame = false

		this.device.queue.writeBuffer(
			this.uniformBuffer,
			0,
			uniformData as unknown as GPUAllowSharedBufferSource,
		);

		const pipeline = isRgba16f ? this.rgba16fPipeline : this.rgba8Pipeline;

		const commandEncoder =
			customEncoder ??
			this.device.createCommandEncoder({
				label: "deflicker_blend_encoder",
			});

		const bindGroup = this.device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: this.historyTexture.createView() },
				{ binding: 1, resource: currTexture.createView() },
				{ binding: 2, resource: flowTexture.createView() },
				{ binding: 3, resource: this.cachedOutputTexture.createView() },
				{ binding: 4, resource: { buffer: this.uniformBuffer } },
				{ binding: 5, resource: this.bilinearSampler },
			],
		});

		const pass = commandEncoder.beginComputePass({
			label: "deflicker_blend_pass",
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
		pass.end();

		// Update history texture with the deflickered result for recursive temporal coherence
		commandEncoder.copyTextureToTexture(
			{ texture: this.cachedOutputTexture },
			{ texture: this.historyTexture },
			[width, height],
		);

		if (!customEncoder) {
			this.device.queue.submit([commandEncoder.finish()]);
		}

		return this.cachedOutputTexture;
	}

	public reset(): void {
		this.historyTexture?.destroy();
		this.historyTexture = undefined;
	}

	public destroy(): void {
		this.flowPipeline.destroy();
		this.historyTexture?.destroy();
		this.cachedOutputTexture?.destroy();
		this.uniformBuffer.destroy();
	}
}
