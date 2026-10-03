export type {
	CannyOptions,
	ControlNetConditioningOutputs,
	DeflickerOptions,
	DepthNormalsOptions,
	FaceLandmarksOptions,
	NormalRelightingOptions,
	NormalizedLandmarkList,
	OpticalFlowOptions,
	PoseSkeletonOptions,
	SegmentationOptions,
	TensorData,
	TensorDimensions,
	TensorFormat,
	TensorNode,
	TensorPipelineConfig,
} from "@gitframes/core";

export type TensorSource =
	| GPUTexture
	| { inputHandleId?: string; id?: string; [key: string]: unknown }
	| string;

export interface TensorViewExport {
	readonly texture: GPUTexture;
	readonly width: number;
	readonly height: number;
	readonly format: GPUTextureFormat;
}
