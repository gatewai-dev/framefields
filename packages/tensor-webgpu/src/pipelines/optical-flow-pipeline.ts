/**
 * @file optical-flow-pipeline.ts
 * WebGPU Optical Flow Compute Pipeline
 * Executes dense coarse-to-fine Lucas-Kanade motion vector estimation.
 */

import type { OpticalFlowOptions } from "@gitframes/core";
import {
	opticalFlowDirectWgsl,
	opticalFlowRefineWgsl,
} from "../shaders/optical-flow.wgsl.js";

export class OpticalFlowComputePipeline {
	private directPipeline: GPUComputePipeline;
	private refinePipeline: GPUComputePipeline;
	private directUniformBuffer: GPUBuffer;
	private refineUniformBuffer: GPUBuffer;
	private bilinearSampler: GPUSampler;

	private cachedCoarseTexture?: GPUTexture;
	private cachedOutputTexture?: GPUTexture;

	constructor(private device: GPUDevice) {
		const directModule = device.createShaderModule({
			label: "optical_flow_direct.wgsl",
			code: opticalFlowDirectWgsl,
		});
		this.directPipeline = device.createComputePipeline({
			label: "OpticalFlowDirectPipeline",
			layout: "auto",
			compute: {
				module: directModule,
				entryPoint: "computeFlow",
			},
		});

		const refineModule = device.createShaderModule({
			label: "optical_flow_refine.wgsl",
			code: opticalFlowRefineWgsl,
		});
		this.refinePipeline = device.createComputePipeline({
			label: "OpticalFlowRefinePipeline",
			layout: "auto",
			compute: {
				module: refineModule,
				entryPoint: "refineFlow",
			},
		});

		this.directUniformBuffer = device.createBuffer({
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "optical_flow_direct_uniform",
		});

		this.refineUniformBuffer = device.createBuffer({
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "optical_flow_refine_uniform",
		});

		this.bilinearSampler = device.createSampler({
			label: "optical_flow_bilinear_sampler",
			magFilter: "linear",
			minFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
		});
	}

	public execute(
		prevTexture: GPUTexture,
		currTexture: GPUTexture,
		options: OpticalFlowOptions = {},
		customEncoder?: GPUCommandEncoder,
	): GPUTexture {
		const width = currTexture.width;
		const height = currTexture.height;
		const windowSize = options?.windowSize ?? 3;
		const regularization =
			options?.regularization ?? (options as { lambda?: number })?.lambda ?? 0.05;
		const scale = options?.scale ?? 0.5;
		const maxDisplacement = 64.0;
		const outputFormat: "rgba16float" | "rg32float" =
			options.outputFormat ?? "rgba16float";

		// Ensure main output texture is allocated
		if (
			!this.cachedOutputTexture ||
			this.cachedOutputTexture.width !== width ||
			this.cachedOutputTexture.height !== height ||
			this.cachedOutputTexture.format !== outputFormat
		) {
			this.cachedOutputTexture?.destroy();
			this.cachedOutputTexture = this.device.createTexture({
				label: `optical_flow_output_${outputFormat}`,
				size: [width, height],
				format: outputFormat,
				usage:
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_SRC,
			});
		}

		const commandEncoder =
			customEncoder ??
			this.device.createCommandEncoder({
				label: "optical_flow_command_encoder",
			});

		const useMultiScale = scale > 0.1 && scale < 0.95 && width >= 64 && height >= 64;

		if (useMultiScale) {
			const coarseW = Math.max(16, Math.floor(width * scale));
			const coarseH = Math.max(16, Math.floor(height * scale));

			if (
				!this.cachedCoarseTexture ||
				this.cachedCoarseTexture.width !== coarseW ||
				this.cachedCoarseTexture.height !== coarseH
			) {
				this.cachedCoarseTexture?.destroy();
				this.cachedCoarseTexture = this.device.createTexture({
					label: "optical_flow_coarse",
					size: [coarseW, coarseH],
					format: "rgba16float",
					usage:
						GPUTextureUsage.STORAGE_BINDING |
						GPUTextureUsage.TEXTURE_BINDING |
						GPUTextureUsage.COPY_SRC,
				});
			}

			// Pass 1: Coarse flow computation
			const directData = new ArrayBuffer(32);
			const directU32 = new Uint32Array(directData);
			const directF32 = new Float32Array(directData);
			directU32[0] = coarseW;
			directU32[1] = coarseH;
			directU32[2] = windowSize;
			directF32[3] = regularization;
			directF32[4] = maxDisplacement * scale;

			this.device.queue.writeBuffer(
				this.directUniformBuffer,
				0,
				directData as unknown as GPUAllowSharedBufferSource,
			);

			const coarseBindGroup = this.device.createBindGroup({
				layout: this.directPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: prevTexture.createView() },
					{ binding: 1, resource: currTexture.createView() },
					{ binding: 2, resource: this.cachedCoarseTexture.createView() },
					{ binding: 3, resource: { buffer: this.directUniformBuffer } },
				],
			});

			const coarsePass = commandEncoder.beginComputePass({
				label: "optical_flow_coarse_pass",
			});
			coarsePass.setPipeline(this.directPipeline);
			coarsePass.setBindGroup(0, coarseBindGroup);
			coarsePass.dispatchWorkgroups(
				Math.ceil(coarseW / 16),
				Math.ceil(coarseH / 16),
			);
			coarsePass.end();

			// Pass 2: Fine flow refinement
			const refineData = new ArrayBuffer(32);
			const refineU32 = new Uint32Array(refineData);
			const refineF32 = new Float32Array(refineData);
			refineU32[0] = width;
			refineU32[1] = height;
			refineU32[2] = windowSize;
			refineF32[3] = regularization;
			refineF32[4] = maxDisplacement;
			refineU32[5] = coarseW;
			refineU32[6] = coarseH;

			this.device.queue.writeBuffer(
				this.refineUniformBuffer,
				0,
				refineData as unknown as GPUAllowSharedBufferSource,
			);

			const refineBindGroup = this.device.createBindGroup({
				layout: this.refinePipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: prevTexture.createView() },
					{ binding: 1, resource: currTexture.createView() },
					{ binding: 2, resource: this.cachedCoarseTexture.createView() },
					{ binding: 3, resource: this.cachedOutputTexture.createView() },
					{ binding: 4, resource: { buffer: this.refineUniformBuffer } },
					{ binding: 5, resource: this.bilinearSampler },
				],
			});

			const finePass = commandEncoder.beginComputePass({
				label: "optical_flow_fine_pass",
			});
			finePass.setPipeline(this.refinePipeline);
			finePass.setBindGroup(0, refineBindGroup);
			finePass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
			finePass.end();
		} else {
			// Single-scale direct computation
			const directData = new ArrayBuffer(32);
			const directU32 = new Uint32Array(directData);
			const directF32 = new Float32Array(directData);
			directU32[0] = width;
			directU32[1] = height;
			directU32[2] = windowSize;
			directF32[3] = regularization;
			directF32[4] = maxDisplacement;

			this.device.queue.writeBuffer(
				this.directUniformBuffer,
				0,
				directData as unknown as GPUAllowSharedBufferSource,
			);

			const directBindGroup = this.device.createBindGroup({
				layout: this.directPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: prevTexture.createView() },
					{ binding: 1, resource: currTexture.createView() },
					{ binding: 2, resource: this.cachedOutputTexture.createView() },
					{ binding: 3, resource: { buffer: this.directUniformBuffer } },
				],
			});

			const directPass = commandEncoder.beginComputePass({
				label: "optical_flow_direct_pass",
			});
			directPass.setPipeline(this.directPipeline);
			directPass.setBindGroup(0, directBindGroup);
			directPass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
			directPass.end();
		}

		if (!customEncoder) {
			this.device.queue.submit([commandEncoder.finish()]);
		}
		return this.cachedOutputTexture;
	}

	public destroy(): void {
		this.cachedCoarseTexture?.destroy();
		this.cachedOutputTexture?.destroy();
		this.directUniformBuffer.destroy();
		this.refineUniformBuffer.destroy();
	}
}
