import type { PoseSkeletonOptions } from "@gitframes/tensor-webgpu";
import { PoseSkeletonComputePipeline } from "@gitframes/tensor-webgpu";
import { YOLO_COCO17_BONES } from "../extractors/canonical-indices.js";
import type { YoloPoseKeypoint } from "../types.js";

export type { PoseSkeletonOptions };
export type { CanonicalBoneDef as SkeletonBone } from "@gitframes/tensor-webgpu";

/**
 * WebGPU skeleton renderer for YOLO pose results.
 *
 * Rasterizes the primary person's COCO-17 keypoints into an OpenPose-style
 * conditioning texture natively in VRAM — same compute pipeline as the MediaPipe
 * renderer, with the COCO-17 bone set instead of the 33-point OpenPose set.
 */
export class PoseSkeletonRenderer {
	private pipeline: PoseSkeletonComputePipeline;

	constructor(device: GPUDevice) {
		this.pipeline = new PoseSkeletonComputePipeline(device);
	}

	public renderToTexture(
		keypoints: readonly YoloPoseKeypoint[],
		options: PoseSkeletonOptions,
		bones = YOLO_COCO17_BONES,
	): GPUTexture {
		return this.pipeline.execute(keypoints as never, options, bones);
	}

	public destroy(): void {
		this.pipeline.destroy();
	}
}
