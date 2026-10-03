import type { NormalizedLandmarkList, PoseSkeletonOptions } from "../types.js";
import { poseSkeletonWgsl } from "../shaders/pose-skeleton.wgsl.js";

export interface CanonicalBoneDef {
	readonly from: number;
	readonly to: number;
	readonly color: readonly [r: number, g: number, b: number, a: number];
}

export const CANONICAL_OPENPOSE_BONES: readonly CanonicalBoneDef[] = [
	// Upper Body & Arms
	{ from: 0, to: 11, color: [0.0, 1.0, 1.0, 1.0] }, // Nose -> L Shoulder
	{ from: 0, to: 12, color: [0.0, 1.0, 1.0, 1.0] }, // Nose -> R Shoulder
	{ from: 11, to: 12, color: [1.0, 0.0, 0.0, 1.0] }, // L Shoulder -> R Shoulder
	{ from: 11, to: 13, color: [1.0, 0.333, 0.0, 1.0] }, // L Shoulder -> L Elbow
	{ from: 13, to: 15, color: [1.0, 0.667, 0.0, 1.0] }, // L Elbow -> L Wrist
	{ from: 12, to: 14, color: [1.0, 1.0, 0.0, 1.0] }, // R Shoulder -> R Elbow
	{ from: 14, to: 16, color: [0.667, 1.0, 0.0, 1.0] }, // R Elbow -> R Wrist

	// Torso & Hips
	{ from: 11, to: 23, color: [0.333, 1.0, 0.0, 1.0] }, // L Shoulder -> L Hip
	{ from: 12, to: 24, color: [0.0, 1.0, 0.0, 1.0] }, // R Shoulder -> R Hip
	{ from: 23, to: 24, color: [0.0, 1.0, 0.333, 1.0] }, // L Hip -> R Hip

	// Lower Body & Legs
	{ from: 23, to: 25, color: [0.0, 1.0, 0.667, 1.0] }, // L Hip -> L Knee
	{ from: 25, to: 27, color: [0.0, 1.0, 1.0, 1.0] }, // L Knee -> L Ankle
	{ from: 24, to: 26, color: [0.0, 0.667, 1.0, 1.0] }, // R Hip -> R Knee
	{ from: 26, to: 28, color: [0.0, 0.333, 1.0, 1.0] }, // R Knee -> R Ankle
];

export class PoseSkeletonComputePipeline {
	private computePipeline: GPUComputePipeline;
	private uniformBuffer: GPUBuffer;
	private cachedOutputTexture?: GPUTexture;

	constructor(private device: GPUDevice) {
		const shaderModule = device.createShaderModule({
			label: "pose_skeleton.wgsl",
			code: poseSkeletonWgsl,
		});

		this.computePipeline = device.createComputePipeline({
			label: "PoseSkeletonComputePipeline",
			layout: "auto",
			compute: {
				module: shaderModule,
				entryPoint: "computePoseSkeleton",
			},
		});

		// 16 bytes header + 24 bones * 48 bytes = 1168 bytes (align to 1280)
		this.uniformBuffer = device.createBuffer({
			size: 1280,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "pose_skeleton_uniform_buffer",
		});
	}

	public execute(
		landmarks: NormalizedLandmarkList,
		options: PoseSkeletonOptions = {},
		bones?: readonly CanonicalBoneDef[],
	): GPUTexture {
		const boneDefs = bones ?? CANONICAL_OPENPOSE_BONES;
		const width = options.width ?? 1024;
		const height = options.height ?? 1024;
		const lineWidth = options.lineWidth ?? 6.0;
		const radius = Math.max(1.0, lineWidth / 2.0);

		// Prepare uniform buffer
		const bufferSize = 1280;
		const arrayBuf = new ArrayBuffer(bufferSize);
		const u32View = new Uint32Array(arrayBuf);
		const f32View = new Float32Array(arrayBuf);

		u32View[0] = width;
		u32View[1] = height;
		u32View[2] = boneDefs.length;
		u32View[3] = 0; // pad

		// Write each bone
		const boneBaseFloatOffset = 4; // 16 bytes = 4 floats
		for (let i = 0; i < boneDefs.length; i++) {
			const boneDef = boneDefs[i];
			const ptA = landmarks[boneDef.from];
			const ptB = landmarks[boneDef.to];

			const offset = boneBaseFloatOffset + i * 12; // 48 bytes = 12 floats per bone
			if (
				!ptA ||
				!ptB ||
				(ptA.visibility ?? 1.0) < 0.2 ||
				(ptB.visibility ?? 1.0) < 0.2
			) {
				f32View[offset + 9] = 0.0; // enabled = false
				continue;
			}

			// start (x, y) in pixel coordinates
			f32View[offset + 0] = ptA.x * width;
			f32View[offset + 1] = ptA.y * height;
			// end (x, y) in pixel coordinates
			f32View[offset + 2] = ptB.x * width;
			f32View[offset + 3] = ptB.y * height;
			// color (r, g, b, a)
			f32View[offset + 4] = boneDef.color[0];
			f32View[offset + 5] = boneDef.color[1];
			f32View[offset + 6] = boneDef.color[2];
			f32View[offset + 7] = boneDef.color[3];
			// radius
			f32View[offset + 8] = radius;
			// enabled
			f32View[offset + 9] = 1.0;
		}

		this.device.queue.writeBuffer(
			this.uniformBuffer,
			0,
			arrayBuf as unknown as GPUAllowSharedBufferSource,
		);

		// Output texture
		if (
			!this.cachedOutputTexture ||
			this.cachedOutputTexture.width !== width ||
			this.cachedOutputTexture.height !== height
		) {
			this.cachedOutputTexture?.destroy();
			this.cachedOutputTexture = this.device.createTexture({
				label: "openpose_skeleton_texture",
				size: [width, height],
				format: "rgba8unorm",
				usage:
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_SRC,
			});
		}

		const commandEncoder = this.device.createCommandEncoder({
			label: "pose_skeleton_command_encoder",
		});

		const bindGroup = this.device.createBindGroup({
			label: "pose_skeleton_bind_group",
			layout: this.computePipeline.getBindGroupLayout(0),
			entries: [
				{
					binding: 0,
					resource: this.cachedOutputTexture.createView({
						label: "pose_skeleton_output_view",
					}),
				},
				{
					binding: 1,
					resource: {
						buffer: this.uniformBuffer,
					},
				},
			],
		});

		const pass = commandEncoder.beginComputePass({
			label: "pose_skeleton_compute_pass",
		});
		pass.setPipeline(this.computePipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16), 1);
		pass.end();

		this.device.queue.submit([commandEncoder.finish()]);

		return this.cachedOutputTexture;
	}

	public destroy(): void {
		this.cachedOutputTexture?.destroy();
		this.cachedOutputTexture = undefined;
		this.uniformBuffer.destroy();
	}
}
