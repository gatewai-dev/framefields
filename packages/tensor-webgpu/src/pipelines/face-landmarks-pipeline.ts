/**
 * @file face-landmarks-pipeline.ts
 * WebGPU compute pipeline for generating SDXL ControlNet Face conditioning textures.
 * Rasterizes canonical 478 MediaPipe facial contours directly onto a GPUTexture in VRAM.
 */

import type { FaceLandmarksOptions, NormalizedLandmarkList } from "../types.js";
import { faceLandmarksWgsl } from "../shaders/face-landmarks.wgsl.js";

export interface FaceSegmentDef {
	readonly from: number;
	readonly to: number;
	readonly color: readonly [r: number, g: number, b: number, a: number];
}

function buildLoopSegments(
	indices: readonly number[],
	color: readonly [number, number, number, number],
): FaceSegmentDef[] {
	const segs: FaceSegmentDef[] = [];
	for (let i = 0; i < indices.length - 1; i++) {
		segs.push({ from: indices[i], to: indices[i + 1], color });
	}
	return segs;
}

export const CANONICAL_FACE_CONTOURS: readonly FaceSegmentDef[] = [
	// Left Eyebrow (Cyan)
	...buildLoopSegments([70, 63, 105, 66, 107], [0.0, 1.0, 1.0, 1.0]),
	// Right Eyebrow (Cyan)
	...buildLoopSegments([300, 293, 334, 296, 336], [0.0, 1.0, 1.0, 1.0]),
	// Left Eye (Green)
	...buildLoopSegments([33, 160, 158, 133, 153, 144, 33], [0.0, 1.0, 0.0, 1.0]),
	// Right Eye (Green)
	...buildLoopSegments([263, 387, 385, 362, 380, 373, 263], [0.0, 1.0, 0.0, 1.0]),
	// Nose Bridge & Tip (Yellow)
	...buildLoopSegments([168, 6, 197, 195, 4], [1.0, 1.0, 0.0, 1.0]),
	...buildLoopSegments([98, 97, 2, 326, 327], [1.0, 1.0, 0.0, 1.0]),
	// Outer Lips (Red)
	...buildLoopSegments(
		[61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61],
		[1.0, 0.2, 0.2, 1.0],
	),
	// Inner Lips (Magenta)
	...buildLoopSegments(
		[78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78],
		[1.0, 0.0, 0.8, 1.0],
	),
	// Face Oval / Jawline (White)
	...buildLoopSegments(
		[
			10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
			400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
			54, 103, 67, 109, 10,
		],
		[0.9, 0.9, 0.9, 1.0],
	),
];

export class FaceLandmarksComputePipeline {
	private computePipeline: GPUComputePipeline;
	private uniformBuffer: GPUBuffer;
	private storageBuffer: GPUBuffer;
	private cachedOutputTexture?: GPUTexture;

	constructor(private device: GPUDevice) {
		const shaderModule = device.createShaderModule({
			label: "face_landmarks.wgsl",
			code: faceLandmarksWgsl,
		});

		this.computePipeline = device.createComputePipeline({
			label: "FaceLandmarksComputePipeline",
			layout: "auto",
			compute: {
				module: shaderModule,
				entryPoint: "computeFaceLandmarks",
			},
		});

		// Uniform buffer: 4 u32s = 16 bytes (aligned to 64)
		this.uniformBuffer = device.createBuffer({
			size: 64,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "face_landmarks_uniform_buffer",
		});

		// Storage buffer for FaceSegments: 48 bytes per segment * CANONICAL_FACE_CONTOURS.length
		const storageSize = Math.max(256, CANONICAL_FACE_CONTOURS.length * 48);
		this.storageBuffer = device.createBuffer({
			size: storageSize,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			label: "face_landmarks_storage_buffer",
		});
	}

	public execute(
		landmarks: NormalizedLandmarkList,
		options: FaceLandmarksOptions = {},
	): GPUTexture {
		const width = options.width ?? 1024;
		const height = options.height ?? 1024;
		const lineWidth = options.lineWidth ?? 4.0;
		const radius = Math.max(1.0, lineWidth / 2.0);

		// Write Uniforms
		const u32Uniforms = new Uint32Array(4);
		u32Uniforms[0] = width;
		u32Uniforms[1] = height;
		u32Uniforms[2] = CANONICAL_FACE_CONTOURS.length;
		u32Uniforms[3] = 0;
		this.device.queue.writeBuffer(this.uniformBuffer, 0, u32Uniforms);

		// Write Segments Storage Buffer
		const f32Segments = new Float32Array(CANONICAL_FACE_CONTOURS.length * 12);
		for (let i = 0; i < CANONICAL_FACE_CONTOURS.length; i++) {
			const seg = CANONICAL_FACE_CONTOURS[i];
			const ptA = landmarks[seg.from];
			const ptB = landmarks[seg.to];
			const offset = i * 12;

			if (!ptA || !ptB || (ptA.visibility ?? 1.0) < 0.2 || (ptB.visibility ?? 1.0) < 0.2) {
				f32Segments[offset + 9] = 0.0; // enabled = false
				continue;
			}

			f32Segments[offset + 0] = ptA.x * width;
			f32Segments[offset + 1] = ptA.y * height;
			f32Segments[offset + 2] = ptB.x * width;
			f32Segments[offset + 3] = ptB.y * height;
			f32Segments[offset + 4] = seg.color[0];
			f32Segments[offset + 5] = seg.color[1];
			f32Segments[offset + 6] = seg.color[2];
			f32Segments[offset + 7] = seg.color[3];
			f32Segments[offset + 8] = radius;
			f32Segments[offset + 9] = 1.0; // enabled = true
			f32Segments[offset + 10] = 0.0;
			f32Segments[offset + 11] = 0.0;
		}
		this.device.queue.writeBuffer(this.storageBuffer, 0, f32Segments);

		// Prepare Output Texture
		if (
			!this.cachedOutputTexture ||
			this.cachedOutputTexture.width !== width ||
			this.cachedOutputTexture.height !== height
		) {
			this.cachedOutputTexture?.destroy();
			this.cachedOutputTexture = this.device.createTexture({
				size: { width, height },
				format: "rgba8unorm",
				usage:
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_SRC |
					GPUTextureUsage.COPY_DST,
				label: "face_landmarks_output_texture",
			});
		}

		const bindGroup = this.device.createBindGroup({
			label: "FaceLandmarksBindGroup",
			layout: this.computePipeline.getBindGroupLayout(0),
			entries: [
				{
					binding: 0,
					resource: this.cachedOutputTexture.createView(),
				},
				{
					binding: 1,
					resource: { buffer: this.uniformBuffer },
				},
				{
					binding: 2,
					resource: { buffer: this.storageBuffer },
				},
			],
		});

		const commandEncoder = this.device.createCommandEncoder({
			label: "FaceLandmarksCommandEncoder",
		});
		const pass = commandEncoder.beginComputePass({
			label: "FaceLandmarksComputePass",
		});
		pass.setPipeline(this.computePipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
		pass.end();

		this.device.queue.submit([commandEncoder.finish()]);
		return this.cachedOutputTexture;
	}

	public destroy(): void {
		this.uniformBuffer.destroy();
		this.storageBuffer.destroy();
		this.cachedOutputTexture?.destroy();
	}
}
