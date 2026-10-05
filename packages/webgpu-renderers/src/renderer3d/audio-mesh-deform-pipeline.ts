/**
 * @file audio-mesh-deform-pipeline.ts
 * WebGPU Compute Pipeline for Audio Latent 3D Mesh Vertex Displacement.
 * Executes audioMeshDisplace.wgsl compute pass across mesh vertex buffers.
 */

import type { MeshAudioDeformConfig } from "@framefields/core";
import { BufferPool } from "../renderer2d/buffer-pool.js";
import { audioMeshDisplaceWgsl } from "../shaders/audio-mesh-displace.js";

/** Shader mode ids (audio-mesh-displace.wgsl). */
const DEFORM_MODES: Record<MeshAudioDeformConfig["mode"], number> = {
	normal_extrusion: 0,
	radial_pulse: 1,
	harmonic_wave: 2,
	twist: 3,
	ripple: 4,
};

export interface DeformDispatchOptions {
	config: MeshAudioDeformConfig;
	audioLatentBuffer: GPUBuffer;
	vertexCount: number;
	timeMs?: number;
	sampleRate?: number;
}

export class AudioMeshDeformPipeline {
	private device: GPUDevice;
	public pipeline: GPUComputePipeline;
	public bindGroupLayout: GPUBindGroupLayout;
	private uniformPool: BufferPool;
	private deformedBuffers = new WeakMap<GPUBuffer, GPUBuffer>();

	// 8 floats = 32 bytes for DeformParams uniform
	private uniformData = new ArrayBuffer(32);
	private uniformUint32 = new Uint32Array(this.uniformData);
	private uniformFloat32 = new Float32Array(this.uniformData);

	constructor(device: GPUDevice) {
		this.device = device;
		this.uniformPool = new BufferPool(
			32,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		this.bindGroupLayout = device.createBindGroupLayout({
			label: "AudioMeshDeformBindGroupLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "uniform" },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" },
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" },
				},
			],
		});

		const shaderModule = device.createShaderModule({
			label: "audioMeshDisplace.wgsl",
			code: audioMeshDisplaceWgsl,
		});

		const pipelineLayout = device.createPipelineLayout({
			label: "AudioMeshDeformPipelineLayout",
			bindGroupLayouts: [this.bindGroupLayout],
		});

		this.pipeline = device.createComputePipeline({
			label: "AudioMeshDeformComputePipeline",
			layout: pipelineLayout,
			compute: {
				module: shaderModule,
				entryPoint: "cs_displace",
			},
		});
	}

	public getOrCreateDeformedBuffer(
		srcBuffer: GPUBuffer,
		byteLength: number,
	): GPUBuffer {
		let dst = this.deformedBuffers.get(srcBuffer);
		if (!dst || dst.size < byteLength) {
			dst?.destroy();
			dst = this.device.createBuffer({
				label: "DeformedMeshVertexBuffer",
				size: Math.max(64, Math.ceil(byteLength / 4) * 4),
				usage:
					GPUBufferUsage.VERTEX |
					GPUBufferUsage.STORAGE |
					GPUBufferUsage.COPY_DST |
					GPUBufferUsage.COPY_SRC,
			});
			this.deformedBuffers.set(srcBuffer, dst);
		}
		return dst;
	}

	public execute(
		encoder: GPUCommandEncoder,
		srcVertexBuffer: GPUBuffer,
		options: DeformDispatchOptions,
	): GPUBuffer {
		const {
			config,
			audioLatentBuffer,
			vertexCount,
			timeMs = 0,
			sampleRate = 48000,
		} = options;
		const byteLength = vertexCount * 64; // 16 floats * 4 bytes
		const dstVertexBuffer = this.getOrCreateDeformedBuffer(
			srcVertexBuffer,
			byteLength,
		);

		const modeInt = DEFORM_MODES[config.mode] ?? 0;

		// Calculate frequency bins (FFT_SIZE = 2048)
		const hzPerBin = sampleRate / 2048;
		const minHz = config.frequencyRange ? config.frequencyRange[0] : 20;
		const maxHz = config.frequencyRange ? config.frequencyRange[1] : 120;
		const minBin = Math.max(0, Math.min(1023, Math.round(minHz / hzPerBin)));
		const maxBin = Math.max(
			minBin,
			Math.min(1023, Math.round(maxHz / hzPerBin)),
		);

		// Extract amplitude multiplier (if Signal, caller evaluates value before passing or defaults to 1.0)
		const amp =
			typeof config.amplitudeMultiplier === "number"
				? config.amplitudeMultiplier
				: typeof (config.amplitudeMultiplier as { value?: number })?.value ===
						"number"
					? (config.amplitudeMultiplier as { value: number }).value
					: 1.0;

		const damping = config.damping ?? 0.0;

		// Pack uniform data
		this.uniformUint32[0] = modeInt;
		this.uniformUint32[1] = minBin;
		this.uniformUint32[2] = maxBin;
		this.uniformUint32[3] = vertexCount;
		this.uniformFloat32[4] = amp;
		this.uniformFloat32[5] = damping;
		this.uniformFloat32[6] = timeMs;
		this.uniformFloat32[7] = 0.0; // padding

		const uniformBuffer = this.uniformPool.getBuffer(
			this.device,
			new Uint8Array(this.uniformData),
		);

		const bindGroup = this.device.createBindGroup({
			layout: this.bindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: audioLatentBuffer } },
				{ binding: 1, resource: { buffer: uniformBuffer } },
				{ binding: 2, resource: { buffer: srcVertexBuffer } },
				{ binding: 3, resource: { buffer: dstVertexBuffer } },
			],
		});

		const computePass = encoder.beginComputePass({
			label: "AudioMeshDeformComputePass",
		});
		computePass.setPipeline(this.pipeline);
		computePass.setBindGroup(0, bindGroup);

		// Workgroup size is 256
		const workgroups = Math.ceil(vertexCount / 256);
		computePass.dispatchWorkgroups(workgroups);
		computePass.end();

		return dstVertexBuffer;
	}

	public resetPools(): void {
		this.uniformPool.reset();
	}

	public destroy(): void {
		this.uniformPool.destroy();
	}
}
