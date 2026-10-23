export type {
	CannyOptions,
	ControlNetConditioningOutputs,
	DeflickerOptions,
	DepthNormalsOptions,
	FaceLandmarksOptions,
	NormalizedLandmarkList,
	NormalRelightingOptions,
	OpticalFlowOptions,
	PoseSkeletonOptions,
	SegmentationOptions,
	TensorData,
	TensorDimensions,
	TensorFormat,
	TensorNode,
	TensorPipelineConfig,
} from "@framefields/core";

export type TensorSource =
	| GPUTexture
	| { inputHandleId?: string; id?: string }
	| string;

export interface TensorViewExport {
	readonly texture: GPUTexture;
	readonly width: number;
	readonly height: number;
	readonly format: GPUTextureFormat;
}
