import type { VisionTask, VisionVariant } from "@framefields/core";

/**
 * Vision model registry — single source of truth for what exists, where it lives, and which
 * model serves which task + variant.
 *
 * Every model in this package is Apache-2.0 and pinned to an immutable Hugging Face revision.
 * The store verifies the SHA-256 below after download, so a moved or tampered file fails loudly.
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
	| "selfie-landscape"
	| (string & {});

/** Which decoder a model's outputs feed (see runner/vision-runner.ts). */
export type VisionModelFamily =
	| "rtmdet-ins"
	| "rtmo"
	| "selfie"
	| (string & {});

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
	/** License identifier (e.g. "Apache-2.0" or "Meta SAM License"). Defaults to "Apache-2.0". */
	readonly license?: string;
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

export const VISION_MODELS: Record<string, VisionModelDescriptor> = {
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
		license: "Apache-2.0",
	},
	"rtmdet-ins-s": {
		key: "rtmdet-ins-s",
		family: "rtmdet-ins",
		filename: "rtmdet-ins-s.onnx",
		url: hf(
			RTMDET_INS_REPO,
			RTMDET_INS_REV,
			"models/small/rtmdet-ins_s_640x640.onnx",
		),
		bytes: 38_745_918,
		sha256: "0faef2be711666ff726d40026e6d11e5fc24c6c45ea4e4cb3ddf295b77e83492",
		input: [640, 640],
		source: RTMDET_INS_SOURCE,
		license: "Apache-2.0",
	},
	"rtmdet-ins-m": {
		key: "rtmdet-ins-m",
		family: "rtmdet-ins",
		filename: "rtmdet-ins-m.onnx",
		url: hf(
			RTMDET_INS_REPO,
			RTMDET_INS_REV,
			"models/medium/rtmdet-ins_m_640x640.onnx",
		),
		bytes: 104_139_518,
		sha256: "c18fa83ee42a5c37894a896d8e8b615c4d3ddf8b7ffda62fa1e1b12b591b61c9",
		input: [640, 640],
		source: RTMDET_INS_SOURCE,
		license: "Apache-2.0",
	},

	// ── Top-down pose estimation (COCO 17 keypoints) ──────────────────
	"rtmo-t": {
		key: "rtmo-t",
		family: "rtmo",
		filename: "rtmo-t.onnx",
		url: hf(
			"tori29umai/rtmo-onnx-pose",
			"550cbb91cfc29013b35eb65ce90c42d3c907d884",
			"models/tiny/rtmo_tiny_640x640.onnx",
		),
		bytes: 20_814_230,
		sha256: "a1a8c08198f8a14b534958ea346ecce43867c2966bfb578c74d39f40c74ceca5",
		input: [640, 640],
		source: RTMO_SOURCE,
		license: "Apache-2.0",
	},
	"rtmo-s": {
		key: "rtmo-s",
		family: "rtmo",
		filename: "rtmo-s.onnx",
		url: hf(
			"tori29umai/rtmo-onnx-pose",
			"550cbb91cfc29013b35eb65ce90c42d3c907d884",
			"models/small/rtmo_s_640x640.onnx",
		),
		bytes: 69_097_650,
		sha256: "25064e7a8585e509aa09fb6fbff3eeae0c1c875d9e512cb59bf4ceab90604b38",
		input: [640, 640],
		source: RTMO_SOURCE,
		license: "Apache-2.0",
	},
	"rtmo-m": {
		key: "rtmo-m",
		family: "rtmo",
		filename: "rtmo-m.onnx",
		url: hf(
			"tori29umai/rtmo-onnx-pose",
			"550cbb91cfc29013b35eb65ce90c42d3c907d884",
			"models/medium/rtmo_m_640x640.onnx",
		),
		bytes: 139_067_314,
		sha256: "36009f4dd45a271701b2ca7226f318357f4fb2bc13d702d849509df6c2763f35",
		input: [640, 640],
		source: RTMO_SOURCE,
		license: "Apache-2.0",
	},

	// ── Binary selfie segmenter (matte) ───────────────────────────────
	"selfie-square": {
		key: "selfie-square",
		family: "selfie",
		filename: "selfie-square.onnx",
		url: hf(
			"onnx-community/mediapipe_selfie_segmentation_square",
			"b5066db2bc1be0c926a84f331ea06eb6e91f0a14",
			"onnx/model.onnx",
		),
		bytes: 462_338,
		sha256: "13511eb85ca8eb90b9f0bc94be6bc961448b30efab31f49635beea7b7a2bbcd2",
		input: [256, 256],
		source: SELFIE_SOURCE,
		license: "Apache-2.0",
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
		license: "Apache-2.0",
	},
};

/** Register external or plugin vision models into the runtime registry. */
export function registerVisionModel(descriptor: VisionModelDescriptor): void {
	VISION_MODELS[descriptor.key] = descriptor;
}

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
