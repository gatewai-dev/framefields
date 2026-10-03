import { ControlNetMultiplexer } from "../multiplexer/controlnet-multiplexer.js";
import { CannyComputePipeline } from "../pipelines/canny-pipeline.js";
import { DepthNormalsComputePipeline } from "../pipelines/depth-normals-pipeline.js";
import { FaceLandmarksComputePipeline } from "../pipelines/face-landmarks-pipeline.js";
import { OpticalFlowComputePipeline } from "../pipelines/optical-flow-pipeline.js";
import { PoseSkeletonComputePipeline } from "../pipelines/pose-skeleton-pipeline.js";
import { SegmentationComputePipeline } from "../pipelines/segmentation-pipeline.js";
import { TemporalDeflickerPipeline } from "../pipelines/temporal-deflicker-pipeline.js";
import type {
	CannyOptions,
	ControlNetConditioningOutputs,
	DeflickerOptions,
	DepthNormalsOptions,
	FaceLandmarksOptions,
	NormalizedLandmarkList,
	OpticalFlowOptions,
	PoseSkeletonOptions,
	SegmentationOptions,
	TensorNode,
	TensorPipelineConfig,
	TensorSource,
} from "../types.js";

export class TensorPipeline {
	public readonly id: string;
	private cannyOptions?: CannyOptions;
	private depthNormalsOptions?: DepthNormalsOptions;
	private poseSkeletonOptions?: PoseSkeletonOptions;
	private faceLandmarksOptions?: FaceLandmarksOptions;
	private segmentationOptions?: SegmentationOptions;
	private opticalFlowOptions?: OpticalFlowOptions;
	private deflickerOptions?: DeflickerOptions;
	private multiplexer = new ControlNetMultiplexer();
	private cannyPipeline?: CannyComputePipeline;
	private depthNormalsPipeline?: DepthNormalsComputePipeline;
	private posePipeline?: PoseSkeletonComputePipeline;
	private facePipeline?: FaceLandmarksComputePipeline;
	private segmentationPipeline?: SegmentationComputePipeline;
	private opticalFlowPipeline?: OpticalFlowComputePipeline;
	private deflickerPipeline?: TemporalDeflickerPipeline;
	private prevInputTexture?: GPUTexture;

	constructor(public readonly source: TensorSource) {
		this.id = `tensor-${Math.random().toString(36).slice(2, 9)}`;
	}

	public static from(source: TensorSource): TensorPipeline {
		return new TensorPipeline(source);
	}

	public canny(options: CannyOptions = {}): this {
		this.cannyOptions = options;
		return this;
	}

	public depthNormals(options: DepthNormalsOptions = {}): this {
		this.depthNormalsOptions = options;
		return this;
	}

	public poseSkeleton(options: PoseSkeletonOptions = {}): this {
		this.poseSkeletonOptions = options;
		return this;
	}

	public pose(
		landmarks: NormalizedLandmarkList,
		options: Omit<PoseSkeletonOptions, "landmarks"> = {},
	): this {
		this.poseSkeletonOptions = { ...options, landmarks };
		return this;
	}

	public faceLandmarks(options: FaceLandmarksOptions = {}): this {
		this.faceLandmarksOptions = options;
		return this;
	}

	public face(
		landmarks: NormalizedLandmarkList,
		options: Omit<FaceLandmarksOptions, "landmarks"> = {},
	): this {
		this.faceLandmarksOptions = { ...options, landmarks };
		return this;
	}

	public segmentation(options: SegmentationOptions = {}): this {
		this.segmentationOptions = options;
		return this;
	}

	public opticalFlow(options: OpticalFlowOptions = {}): this {
		this.opticalFlowOptions = options;
		return this;
	}

	public deflicker(options: DeflickerOptions = {}): this {
		this.deflickerOptions = options;
		return this;
	}

	public getMultiplexer(): ControlNetMultiplexer {
		return this.multiplexer;
	}

	public async execute(
		device: GPUDevice,
		overrideSourceTexture?: GPUTexture,
	): Promise<ControlNetConditioningOutputs> {
		let inputTexture: GPUTexture | undefined = overrideSourceTexture;

		if (
			!inputTexture &&
			typeof (this.source as GPUTexture)?.createView === "function"
		) {
			inputTexture = this.source as GPUTexture;
		}

		if (!inputTexture) {
			throw new Error(
				"[TensorPipeline.execute] No GPUTexture available for tensor compute execution. Pass a valid GPUTexture to execute() or initialize with a GPUTexture source.",
			);
		}

		if (this.cannyOptions) {
			if (!this.cannyPipeline) {
				this.cannyPipeline = new CannyComputePipeline(device);
			}
			const cannyTex = this.cannyPipeline.execute(
				inputTexture,
				this.cannyOptions,
			);
			this.multiplexer.set("canny", cannyTex);
		}

		if (this.depthNormalsOptions) {
			if (!this.depthNormalsPipeline) {
				this.depthNormalsPipeline = new DepthNormalsComputePipeline(device);
			}
			const normalTex = this.depthNormalsPipeline.execute(
				inputTexture,
				this.depthNormalsOptions,
			);
			this.multiplexer.set("normals", normalTex);
		}

		if (this.poseSkeletonOptions?.landmarks) {
			if (!this.posePipeline) {
				this.posePipeline = new PoseSkeletonComputePipeline(device);
			}
			const skeletonTex = this.posePipeline.execute(
				this.poseSkeletonOptions.landmarks,
				{
					width: this.poseSkeletonOptions.width ?? inputTexture.width,
					height: this.poseSkeletonOptions.height ?? inputTexture.height,
					lineWidth: this.poseSkeletonOptions.lineWidth,
				},
			);
			this.multiplexer.set("poseSkeleton", skeletonTex);
		}

		if (this.faceLandmarksOptions?.landmarks) {
			if (!this.facePipeline) {
				this.facePipeline = new FaceLandmarksComputePipeline(device);
			}
			const faceTex = this.facePipeline.execute(
				this.faceLandmarksOptions.landmarks,
				{
					width: this.faceLandmarksOptions.width ?? inputTexture.width,
					height: this.faceLandmarksOptions.height ?? inputTexture.height,
					lineWidth: this.faceLandmarksOptions.lineWidth,
				},
			);
			this.multiplexer.set("faceLandmarks", faceTex);
		}

		if (this.segmentationOptions) {
			if (!this.segmentationPipeline) {
				this.segmentationPipeline = new SegmentationComputePipeline(device);
			}
			const segTex = this.segmentationPipeline.execute(
				inputTexture,
				this.segmentationOptions,
			);
			this.multiplexer.set("segmentationMask", segTex);
		}

		if (this.opticalFlowOptions) {
			if (!this.opticalFlowPipeline) {
				this.opticalFlowPipeline = new OpticalFlowComputePipeline(device);
			}
			const prevTex = this.prevInputTexture ?? inputTexture;
			const flowTex = this.opticalFlowPipeline.execute(
				prevTex,
				inputTexture,
				this.opticalFlowOptions,
			);
			this.multiplexer.set("motionVectors", flowTex);
		}

		if (this.deflickerOptions) {
			if (!this.deflickerPipeline) {
				this.deflickerPipeline = new TemporalDeflickerPipeline(device);
			}
			const deflickeredTex = this.deflickerPipeline.execute(
				inputTexture,
				this.deflickerOptions,
			);
			this.multiplexer.set("deflickered", deflickeredTex);
		}

		this.prevInputTexture = inputTexture;

		return this.multiplexer.getOutputs();
	}

	public toConfig(): TensorPipelineConfig {
		return {
			canny: this.cannyOptions,
			depthNormals: this.depthNormalsOptions,
			poseSkeleton: this.poseSkeletonOptions,
			faceLandmarks: this.faceLandmarksOptions,
			segmentation: this.segmentationOptions,
			opticalFlow: this.opticalFlowOptions,
			deflicker: this.deflickerOptions,
		};
	}

	public toNode(): TensorNode {
		return {
			id: this.id,
			kind: "tensor",
			source: this.source,
			config: this.toConfig(),
		};
	}

	public destroy(): void {
		this.cannyPipeline?.destroy();
		this.depthNormalsPipeline?.destroy();
		this.posePipeline?.destroy();
		this.facePipeline?.destroy();
		this.segmentationPipeline?.destroy();
		this.opticalFlowPipeline?.destroy();
		this.deflickerPipeline?.destroy();
		this.multiplexer.destroy();
	}
}
