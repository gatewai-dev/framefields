/**
 * YOLO11 model registry — single source of truth for what exists, where it lives,
 * and which model key serves which task + variant.
 *
 * Downloads are ALWAYS lazy: nothing here touches the network. The store (model-store.ts)
 * fetches a model only when an inference function that needs it is first called.
 */

export type YoloTask =
	| "detect"
	| "segment"
	| "pose"
	| "obb"
	| "classify"
	| "world";

export type YoloVariant = "n" | "s" | "m" | "l" | "x";

export const YOLO_TASKS: readonly YoloTask[] = [
	"detect",
	"segment",
	"pose",
	"obb",
	"classify",
	"world",
];

export const YOLO_VARIANTS: readonly YoloVariant[] = ["n", "s", "m", "l", "x"];

export type YoloModelKey =
	| "yolo11n"
	| "yolo11s"
	| "yolo11m"
	| "yolo11l"
	| "yolo11x"
	| "yolo11n-seg"
	| "yolo11s-seg"
	| "yolo11m-seg"
	| "yolo11n-pose"
	| "yolo11s-pose"
	| "yolo11m-pose"
	| "yolo11l-pose"
	| "yolo11n-obb"
	| "yolo11s-obb"
	| "yolo11m-obb"
	| "yolo11l-obb"
	| "yolo11n-cls"
	| "yolo11s-cls"
	| "yolov8s-worldv2"
	| "yolov8m-worldv2";

export interface YoloModelDescriptor {
	readonly key: YoloModelKey;
	readonly task: YoloTask;
	readonly variant: YoloVariant;
	/** Filename relative to the download base URL. */
	readonly filename: string;
	/** Optional absolute download URL (used when the asset is not at the shared base URL). */
	readonly url?: string;
	/** Approximate FP32 byte size — used for progress reporting only. */
	readonly bytesFp32: number;
	/** Approximate FP16 byte size (web/WebGPU only; CPU EP stays fp32). Metadata only. */
	readonly bytesFp16?: number;
	readonly nc: number;
	readonly imgsz: number;
}

/**
 * Default download origin. Override per-run with `baseUrl` option or the
 * GITFRAMES_YOLO_BASE_URL environment variable.
 */
export const YOLO_ASSETS_RELEASE = "v8.3.0";

export const DEFAULT_YOLO_BASE_URL = `https://github.com/ultralytics/assets/releases/download/${YOLO_ASSETS_RELEASE}/`;

export const YOLO_MODELS: Readonly<Record<YoloModelKey, YoloModelDescriptor>> =
	{
		// ── Detect (COCO 80) ────────────────────────────────────────────────
		yolo11n: {
			key: "yolo11n",
			task: "detect",
			variant: "n",
			filename: "yolo11n.onnx",
			bytesFp32: 10_723_904,
			bytesFp16: 5_361_952,
			nc: 80,
			imgsz: 640,
		},
		yolo11s: {
			key: "yolo11s",
			task: "detect",
			variant: "s",
			filename: "yolo11s.onnx",
			url: "https://huggingface.co/mobilint/YOLO11s/resolve/main/yolo11s.onnx",
			bytesFp32: 38_502_400,
			bytesFp16: 19_251_200,
			nc: 80,
			imgsz: 640,
		},
		yolo11m: {
			key: "yolo11m",
			task: "detect",
			variant: "m",
			filename: "yolo11m.onnx",
			bytesFp32: 82_329_600,
			bytesFp16: 41_164_800,
			nc: 80,
			imgsz: 640,
		},
		yolo11l: {
			key: "yolo11l",
			task: "detect",
			variant: "l",
			filename: "yolo11l.onnx",
			bytesFp32: 103_628_800,
			bytesFp16: 51_814_400,
			nc: 80,
			imgsz: 640,
		},
		yolo11x: {
			key: "yolo11x",
			task: "detect",
			variant: "x",
			filename: "yolo11x.onnx",
			bytesFp32: 233_062_400,
			bytesFp16: 116_531_200,
			nc: 80,
			imgsz: 640,
		},
		// ── Instance segmentation (COCO 80) ─────────────────────────────────
		"yolo11n-seg": {
			key: "yolo11n-seg",
			task: "segment",
			variant: "n",
			filename: "yolo11n-seg.onnx",
			bytesFp32: 11_886_592,
			nc: 80,
			imgsz: 640,
		},
		"yolo11s-seg": {
			key: "yolo11s-seg",
			task: "segment",
			variant: "s",
			filename: "yolo11s-seg.onnx",
			// Ultralytics only hosts the `n` ONNX at the shared release URL; the `s`
			// weights are published on Hugging Face (standard Ultralytics ONNX export).
			url: "https://huggingface.co/mobilint/YOLO11s-seg/resolve/main/yolo11s-seg.onnx",
			bytesFp32: 42_631_168,
			nc: 80,
			imgsz: 640,
		},
		"yolo11m-seg": {
			key: "yolo11m-seg",
			task: "segment",
			variant: "m",
			filename: "yolo11m-seg.onnx",
			bytesFp32: 91_128_832,
			nc: 80,
			imgsz: 640,
		},
		// ── Pose (COCO-17, nc = 1 "person") ─────────────────────────────────
		"yolo11n-pose": {
			key: "yolo11n-pose",
			task: "pose",
			variant: "n",
			filename: "yolo11n-pose.onnx",
			bytesFp32: 11_450_368,
			nc: 1,
			imgsz: 640,
		},
		"yolo11s-pose": {
			key: "yolo11s-pose",
			task: "pose",
			variant: "s",
			filename: "yolo11s-pose.onnx",
			url: "https://huggingface.co/mobilint/YOLO11s-pose/resolve/main/yolo11s-pose.onnx",
			bytesFp32: 41_050_112,
			nc: 1,
			imgsz: 640,
		},
		"yolo11m-pose": {
			key: "yolo11m-pose",
			task: "pose",
			variant: "m",
			filename: "yolo11m-pose.onnx",
			url: "https://huggingface.co/mobilint/YOLO11m-pose/resolve/main/yolo11m-pose.onnx",
			bytesFp32: 82_100_000,
			nc: 1,
			imgsz: 640,
		},
		"yolo11l-pose": {
			key: "yolo11l-pose",
			task: "pose",
			variant: "l",
			filename: "yolo11l-pose.onnx",
			url: "https://huggingface.co/mobilint/YOLO11l-pose/resolve/main/yolo11l-pose.onnx",
			bytesFp32: 110_500_000,
			nc: 1,
			imgsz: 640,
		},
		// ── Oriented bounding boxes (DOTA 15 OBB) ─────────────────────────
		// Head layout: 4 xywh + 15 classes + 1 angle = 20 rows per anchor (angle last).
		"yolo11n-obb": {
			key: "yolo11n-obb",
			task: "obb",
			variant: "n",
			filename: "yolo11n-obb.onnx",
			bytesFp32: 12_048_384,
			nc: 15,
			imgsz: 1024,
		},
		"yolo11s-obb": {
			key: "yolo11s-obb",
			task: "obb",
			variant: "s",
			filename: "yolo11s-obb.onnx",
			bytesFp32: 43_253_760,
			nc: 15,
			imgsz: 1024,
		},
		"yolo11m-obb": {
			key: "yolo11m-obb",
			task: "obb",
			variant: "m",
			filename: "yolo11m-obb.onnx",
			url: "https://huggingface.co/mobilint/YOLO11m-obb/resolve/main/yolo11m-obb.onnx",
			bytesFp32: 83_200_000,
			nc: 15,
			imgsz: 1024,
		},
		"yolo11l-obb": {
			key: "yolo11l-obb",
			task: "obb",
			variant: "l",
			filename: "yolo11l-obb.onnx",
			url: "https://huggingface.co/mobilint/YOLO11l-obb/resolve/main/yolo11l-obb.onnx",
			bytesFp32: 111_000_000,
			nc: 15,
			imgsz: 1024,
		},
		// ── Classification (ImageNet-1k) ────────────────────────────────────
		"yolo11n-cls": {
			key: "yolo11n-cls",
			task: "classify",
			variant: "n",
			filename: "yolo11n-cls.onnx",
			bytesFp32: 11_918_848,
			nc: 1000,
			imgsz: 224,
		},
		"yolo11s-cls": {
			key: "yolo11s-cls",
			task: "classify",
			variant: "s",
			filename: "yolo11s-cls.onnx",
			bytesFp32: 42_704_896,
			nc: 1000,
			imgsz: 224,
		},
		// ── Open-Vocabulary YOLO-World (v2) ─────────────────────────────────
		"yolov8s-worldv2": {
			key: "yolov8s-worldv2",
			task: "world",
			variant: "s",
			filename: "yolov8s-worldv2.onnx",
			url: "https://huggingface.co/Instemic/yolo-world-onnx/resolve/main/yolov8s-worldv2.onnx",
			bytesFp32: 52_000_000,
			nc: 80,
			imgsz: 640,
		},
		"yolov8m-worldv2": {
			key: "yolov8m-worldv2",
			task: "world",
			variant: "m",
			filename: "yolov8m-worldv2.onnx",
			url: "https://huggingface.co/ultralytics/yolov8/resolve/main/yolov8m-worldv2.onnx",
			bytesFp32: 108_000_000,
			nc: 80,
			imgsz: 640,
		},
	};

export const DEFAULT_MODEL_KEY_BY_TASK: Readonly<
	Record<YoloTask, (variant: YoloVariant) => YoloModelKey>
> = {
	detect: (v) =>
		v === "n"
			? "yolo11n"
			: v === "s"
				? "yolo11s"
				: v === "m"
					? "yolo11m"
					: v === "l"
						? "yolo11l"
						: "yolo11x",
	segment: (v) =>
		v === "m" ? "yolo11m-seg" : v === "s" ? "yolo11s-seg" : "yolo11n-seg",
	pose: (v) =>
		v === "l"
			? "yolo11l-pose"
			: v === "m"
				? "yolo11m-pose"
				: v === "s"
					? "yolo11s-pose"
					: "yolo11n-pose",
	obb: (v) =>
		v === "l"
			? "yolo11l-obb"
			: v === "m"
				? "yolo11m-obb"
				: v === "s"
					? "yolo11s-obb"
					: "yolo11n-obb",
	classify: (v) => (v === "s" ? "yolo11s-cls" : "yolo11n-cls"),
	world: (v) =>
		v === "m" || v === "l" || v === "x" ? "yolov8m-worldv2" : "yolov8s-worldv2",
};

/** COCO 80 class names — index order matches every ultralytics COCO export. */
export const YOLO_COCO_CLASSES = [
	"person",
	"bicycle",
	"car",
	"motorcycle",
	"airplane",
	"bus",
	"train",
	"truck",
	"boat",
	"traffic light",
	"fire hydrant",
	"stop sign",
	"parking meter",
	"bench",
	"bird",
	"cat",
	"dog",
	"horse",
	"sheep",
	"cow",
	"elephant",
	"bear",
	"zebra",
	"giraffe",
	"backpack",
	"umbrella",
	"handbag",
	"tie",
	"suitcase",
	"frisbee",
	"skis",
	"snowboard",
	"sports ball",
	"kite",
	"baseball bat",
	"baseball glove",
	"skateboard",
	"surfboard",
	"tennis racket",
	"bottle",
	"wine glass",
	"cup",
	"fork",
	"knife",
	"spoon",
	"bowl",
	"banana",
	"apple",
	"sandwich",
	"orange",
	"broccoli",
	"carrot",
	"hot dog",
	"pizza",
	"donut",
	"cake",
	"chair",
	"couch",
	"potted plant",
	"bed",
	"dining table",
	"toilet",
	"tv",
	"laptop",
	"mouse",
	"remote",
	"keyboard",
	"cell phone",
	"microwave",
	"oven",
	"toaster",
	"sink",
	"refrigerator",
	"book",
	"clock",
	"vase",
	"scissors",
	"teddy bear",
	"hair drier",
	"toothbrush",
] as const;

/** DOTA-v1.0 15 class names — index order matches ultralytics YOLO11-OBB export. */
export const YOLO_DOTA_CLASSES = [
	"plane",
	"ship",
	"storage tank",
	"baseball diamond",
	"tennis court",
	"basketball court",
	"ground track field",
	"harbor",
	"bridge",
	"large vehicle",
	"small vehicle",
	"helicopter",
	"roundabout",
	"soccer ball field",
	"swimming pool",
] as const;
