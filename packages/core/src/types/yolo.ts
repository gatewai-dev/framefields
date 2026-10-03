/**
 * YOLO11 AST + config types (engine-agnostic — no ONNX/mediapipe imports here).
 */

export type YoloCoreTask = "detect" | "segment" | "pose" | "obb" | "classify" | "world";

export interface CustomModelConfig {
	readonly path?: string;
	readonly url?: string;
	readonly task: YoloCoreTask;
	readonly classes: readonly string[];
	readonly imgsz?: number;
}

export interface YoloConfig {
	readonly enableDetection?: boolean;
	readonly enableSegmentation?: boolean;
	readonly enablePose?: boolean;
	readonly enableClassification?: boolean;
	/** Rotated boxes (DOTA-style OBB models). */
	readonly enableObb?: boolean;
	/** Open-vocabulary YOLO-World detection. */
	readonly enableWorld?: boolean;
	/** Target open-vocabulary prompts (e.g. ["vintage guitar", "neon sunglasses"]). */
	readonly prompts?: readonly string[];
	/** Bring-your-own fine-tuned ONNX model configuration. */
	readonly customModel?: CustomModelConfig;
	/** COCO class-name filter (all classes when omitted). */
	readonly classes?: readonly string[];
	readonly confidence?: number; // default 0.25
	readonly iouThreshold?: number; // NMS, default 0.45
	readonly variant?: "n" | "s" | "m" | "l" | "x"; // default "n"
	readonly imgsz?: number; // default 640
	readonly delegate?: "cpu" | "webgpu"; // webgpu is a no-op on Node (CPU EP)
	readonly modelsDir?: string;
	readonly baseUrl?: string;
	/** Sigmoid threshold for instance-mask pixels (lower → fuller masks). Default 0.5. */
	readonly maskThreshold?: number;
	/** Transition band radius around maskThreshold for anti-aliased soft alpha. */
	readonly featherRadius?: number;
	/** Compatibility no-op: YOLO models are ALWAYS lazy (downloaded on first use). */
	readonly autoDownload?: boolean;
	readonly cameraFov?: number;
}

export interface YoloNode {
	readonly id: string;
	readonly kind: "yolo";
	readonly source?: unknown;
	readonly config: YoloConfig;
}
