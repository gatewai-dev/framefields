import type { VisionTask, VisionVariant } from "@framefields/core";

/**
 * Vision model registry — single source of truth for what exists, where it lives, and which
 * model serves which task + variant.
 *
 * Every model is Apache-2.0 and pinned to an immutable Hugging Face revision; the store
 * verifies the SHA-256 below after download, so a moved or tampered file fails loudly.
 *
 * Downloads are ALWAYS lazy: nothing here touches the network. The store (model-store.ts)
 * fetches a model only when an inference function that needs it is first called.
 */

export type { VisionTask, VisionVariant };

export const VISION_TASKS: readonly VisionTask[] = [
	"detect",
	"segment",
	"pose",
	"matte",
];

export const VISION_VARIANTS: readonly VisionVariant[] = ["t", "s", "m"];

export type VisionModelKey =
	| "rtmdet-ins-t"
	| "rtmdet-ins-s"
	| "rtmdet-ins-m"
	| "rtmo-t"
	| "rtmo-s"
	| "rtmo-m"
	| "selfie-square"
	| "selfie-landscape";

/** Which decoder a model's outputs feed (see runner/vision-runner.ts). */
export type VisionModelFamily = "rtmdet-ins" | "rtmo" | "selfie";

export interface VisionModelDescriptor {
	readonly key: VisionModelKey;
	readonly family: VisionModelFamily;
	/** Cache filename (also the path appended to a custom `baseUrl`). */
	readonly filename: string;
	/** Pinned download URL (immutable revision). */
	readonly url: string;
	/** Exact byte size of the pinned file. */
	readonly bytes: number;
	/** Hex SHA-256 of the pinned file. */
	readonly sha256: string;
	/** Model input size, `[width, height]` — must match the ONNX graph's input shape. */
	readonly input: readonly [number, number];
	/** Upstream project and license, surfaced in docs and errors. */
	readonly source: string;
}

const hf = (repo: string, revision: string, path: string): string =>
	`https://huggingface.co/${repo}/resolve/${revision}/${path}`;

const RTMDET_INS_REPO = "tori29umai/rtmdet-ins-onnx-person-masks";
const RTMDET_INS_REV = "e5218e8d47d7c50077f27f9893a28e0ef2ad5656";
const RTMDET_INS_SOURCE =
	"RTMDet-Ins (OpenMMLab mmdetection, Apache-2.0), mmdeploy ONNX export";
const RTMO_SOURCE = "RTMO (OpenMMLab mmpose, Apache-2.0), ONNX export";
const SELFIE_SOURCE =
	"MediaPipe Selfie Segmenter (Google, Apache-2.0), ONNX export";

export const VISION_MODELS: Readonly<
	Record<VisionModelKey, VisionModelDescriptor>
> = {
	// ── Detection + instance segmentation (COCO 80) ─────────────────────
	"rtmdet-ins-t": {
		key: "rtmdet-ins-t",
		family: "rtmdet-ins",
		filename: "rtmdet-ins-t.onnx",
		url: hf(
			RTMDET_INS_REPO,
			RTMDET_INS_REV,
			"models/tiny/rtmdet-ins_tiny_640x640.onnx",
		),
		bytes: 24_032_356,
		sha256: "99ee670820c4493aa13e20578b6a8e39781c319846dc41796a77765734beac5c",
		input: [640, 640],
		source: RTMDET_INS_SOURCE,
	},
	"rtmdet-ins-s": {
		key: "rtmdet-ins-s",
		family: "rtmdet-ins",
		filename: "rtmdet-ins-s.onnx",
		url: hf(
			RTMDET_INS_REPO,
			RTMDET_INS_REV,
			"models/s/rtmdet-ins_s_640x640.onnx",
		),
		bytes: 43_236_976,
		sha256: "9cd1787fbf3eb2bd64cc2d8154f41c036f5484b85599e1cbe0227a2dc5a4a08b",
		input: [640, 640],
		source: RTMDET_INS_SOURCE,
	},
	"rtmdet-ins-m": {
		key: "rtmdet-ins-m",
		family: "rtmdet-ins",
		filename: "rtmdet-ins-m.onnx",
		url: hf(
			RTMDET_INS_REPO,
			RTMDET_INS_REV,
			"models/m/rtmdet-ins_m_640x640.onnx",
		),
		bytes: 115_735_979,
		sha256: "a003bce80316e03467c2c2b483df2d5c0398220c2357a44f9bf985929f7eb052",
		input: [640, 640],
		source: RTMDET_INS_SOURCE,
	},
	// ── Multi-person pose (COCO-17) ─────────────────────────────────────
	"rtmo-t": {
		key: "rtmo-t",
		family: "rtmo",
		filename: "rtmo-t.onnx",
		url: hf(
			"Xenova/RTMO-t",
			"f29d13ce5ee291fbe505e9d06a049992f05699dc",
			"onnx/model.onnx",
		),
		bytes: 27_360_569,
		sha256: "cb54dd042bf997df86d938721c94238940f2bff98ba8d2ccc834430de5c65c13",
		input: [416, 416],
		source: RTMO_SOURCE,
	},
	"rtmo-s": {
		key: "rtmo-s",
		family: "rtmo",
		filename: "rtmo-s.onnx",
		url: hf(
			"Xenova/RTMO-s",
			"d8c526187f341d287753831c9c8b1ecc4855bba1",
			"onnx/model.onnx",
		),
		bytes: 39_636_400,
		sha256: "1cd6a3517658903233e9ccb78666554862f57f0944b6886e2048093594aef4e7",
		input: [640, 640],
		source: RTMO_SOURCE,
	},
	"rtmo-m": {
		key: "rtmo-m",
		family: "rtmo",
		filename: "rtmo-m.onnx",
		url: hf(
			"Xenova/RTMO-m",
			"3aba1280472b98ee2bf663482e27e243038d23fe",
			"onnx/model.onnx",
		),
		bytes: 89_291_929,
		sha256: "76d82c45e5c4810baf587ecf2638d15cbf7ed196afb2055e977382532021b59e",
		input: [640, 640],
		source: RTMO_SOURCE,
	},
	// ── Person matte ────────────────────────────────────────────────────
	"selfie-square": {
		key: "selfie-square",
		family: "selfie",
		filename: "selfie-square.onnx",
		url: hf(
			"onnx-community/mediapipe_selfie_segmentation",
			"be49485c8e027524be38591817fc5cd31bd9d00e",
			"onnx/model.onnx",
		),
		bytes: 462_352,
		sha256: "3241ac4ad8aa35bdaf33946776db29f7c283a413aa0b0dacb9483594b4531aad",
		input: [256, 256],
		source: SELFIE_SOURCE,
	},
	"selfie-landscape": {
		key: "selfie-landscape",
		family: "selfie",
		filename: "selfie-landscape.onnx",
		url: hf(
			"onnx-community/mediapipe_selfie_segmentation_landscape",
			"2497d5bec26c626c7b3c4edc6e1fefc21b64f6c3",
			"onnx/model.onnx",
		),
		bytes: 462_338,
		sha256: "7a0adcfdb1715d3b0ff0f61486d8a181c33f4a208343a5abfccbc6540e872d24",
		input: [256, 144],
		source: SELFIE_SOURCE,
	},
};

/**
 * Resolves the model for a task. `detect` and `segment` share RTMDet-Ins (one forward pass
 * yields both); `matte` picks the landscape Selfie Segmenter for wide frames.
 */
export function modelKeyFor(
	task: VisionTask,
	variant: VisionVariant = "s",
	aspect = 1,
): VisionModelKey {
	if (task === "pose") return `rtmo-${variant}` as const;
	if (task === "matte") {
		return aspect > 1.3 ? "selfie-landscape" : "selfie-square";
	}
	return `rtmdet-ins-${variant}` as const;
}

/** COCO 80 class names — index order matches the RTMDet-Ins `labels` output. */
export const COCO_CLASSES = [
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

export type CocoClass = (typeof COCO_CLASSES)[number];
