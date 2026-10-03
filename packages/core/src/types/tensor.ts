import type { Signal } from "../signals/index.js";
import type { NormalizedLandmarkList } from "./vision.js";

export type TensorFormat =
	| "r8unorm"
	| "r32float"
	| "rg16float"
	| "rgba16float"
	| "rgba8unorm";

export interface TensorDimensions {
	readonly width: number;
	readonly height: number;
	readonly channels: number;
}

export interface OpticalFlowOptions {
	readonly scale?: number;
	readonly windowSize?: number;
	readonly regularization?: number;
	readonly outputFormat?: "rgba16float" | "rg32float";
}

export interface DeflickerOptions {
	readonly blendWeight?: number | Signal<number>;
	readonly disocclusionThreshold?: number;
	readonly maxMotionPixels?: number;
	readonly opticalFlow?: OpticalFlowOptions;
}

export interface NormalRelightingOptions {
	readonly normalMap?: GPUTexture | unknown;
	readonly depthScale?: number | Signal<number>;
	readonly roughness?: number | Signal<number>;
	readonly specularStrength?: number | Signal<number>;
	readonly metallic?: number | Signal<number>;
	readonly ambientIntensity?: number | Signal<number>;
	readonly volumetricDensity?: number | Signal<number>;
}

export interface ControlNetConditioningOutputs {
	readonly canny?: GPUTexture;
	readonly depth?: GPUTexture;
	readonly normals?: GPUTexture;
	readonly poseSkeleton?: GPUTexture;
	readonly segmentationMask?: GPUTexture;
	readonly faceLandmarks?: GPUTexture;
	readonly motionVectors?: GPUTexture;
	readonly deflickered?: GPUTexture;
}

export interface TensorData {
	readonly data: Float32Array;
	readonly shape: readonly number[];
	readonly dtype: "float32";
}

export interface CannyOptions {
	readonly low?: number;
	readonly high?: number;
	readonly outputFormat?: "rgba8unorm" | "r32float";
}

export interface DepthNormalsOptions {
	readonly depthQuality?: "high" | "standard";
	readonly depthScale?: number;
	readonly outputFormat?: "rgba16float" | "rgba8unorm";
}

export interface PoseSkeletonOptions {
	readonly width?: number;
	readonly height?: number;
	readonly lineWidth?: number;
	readonly landmarks?: NormalizedLandmarkList;
}

export interface FaceLandmarksOptions {
	readonly width?: number;
	readonly height?: number;
	readonly lineWidth?: number;
	readonly landmarks?: NormalizedLandmarkList;
}

export interface SegmentationOptions {
	readonly threshold?: number;
	readonly feather?: number;
	readonly outputFormat?: "rgba8unorm" | "r8unorm";
}

export interface TensorPipelineConfig {
	readonly canny?: CannyOptions;
	readonly depthNormals?: DepthNormalsOptions;
	readonly poseSkeleton?: PoseSkeletonOptions;
	readonly faceLandmarks?: FaceLandmarksOptions;
	readonly segmentation?: SegmentationOptions;
	readonly opticalFlow?: OpticalFlowOptions;
	readonly deflicker?: DeflickerOptions;
}

export interface TensorNode {
	readonly id: string;
	readonly kind: "tensor";
	readonly source?: unknown;
	readonly config: TensorPipelineConfig;
}

export interface MeshAudioDeformConfig {
	readonly audioTrackId?: string;
	/**
	 * normal_extrusion pushes vertices out along their normals by the band's
	 * energy; radial_pulse inflates the mesh from its origin on bass and
	 * drums; harmonic_wave runs a sine along Y; twist turns each slice about
	 * the Y axis in proportion to its height and the bass; ripple sends
	 * concentric waves across the XY plane, struck by the drums.
	 */
	readonly mode:
		| "radial_pulse"
		| "harmonic_wave"
		| "normal_extrusion"
		| "twist"
		| "ripple";
	readonly frequencyRange?: [minHz: number, maxHz: number];
	readonly amplitudeMultiplier?: number | Signal<number>;
	readonly damping?: number;
}
