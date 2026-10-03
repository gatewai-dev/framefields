import type { PoseSkeletonOptions } from "@gitframes/tensor-webgpu";
import { PoseSkeletonComputePipeline } from "@gitframes/tensor-webgpu";
import { COCO17_BONES } from "../pose/keypoints.js";
import type { PoseKeypoint } from "../types.js";

export type { PoseSkeletonOptions };
export type { CanonicalBoneDef as SkeletonBone } from "@gitframes/tensor-webgpu";

/**
 * WebGPU skeleton renderer for pose results.
 *
 * Rasterizes the primary person's COCO-17 keypoints into an OpenPose-style
 * conditioning texture natively in VRAM, using the COCO-17 bone set.
 */
export class PoseSkeletonRenderer {
	private pipeline: PoseSkeletonComputePipeline;

	constructor(device: GPUDevice) {
		this.pipeline = new PoseSkeletonComputePipeline(device);
	}

	public renderToTexture(
		keypoints: readonly PoseKeypoint[],
		options: PoseSkeletonOptions,
		bones = COCO17_BONES,
	): GPUTexture {
		return this.pipeline.execute(keypoints as never, options, bones);
	}

	public destroy(): void {
		this.pipeline.destroy();
	}
}
