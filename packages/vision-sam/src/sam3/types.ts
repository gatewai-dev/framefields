import type { SamLicenseOptions } from "../license.js";
import type { Sam3Precision } from "../models/registry.js";
import type { Sam2Point } from "../sam2/types.js";
import { validateSam2Prompts } from "../sam2/types.js";

export interface Sam3Prompt {
	/** Source analysis frame, before trimming or time remapping. */
	readonly frame: number;
	/** Normalized source coordinates; labels 2/3 define a box. */
	readonly points?: readonly Sam2Point[];
	/** Select matching instances (up to `maxObjects`, best first), then propagate their masks. */
	readonly text?: string;
	/**
	 * Track ID (1-based) a points prompt seeds or corrects; defaults to 1. The next unused
	 * ID adds an object. Text prompts re-select every object, so they take no ID.
	 */
	readonly object?: number;
}

export interface Sam3Options extends SamLicenseOptions {
	/** Prompt list across frames. Optional if shorthand `text` is supplied. */
	readonly prompts?: readonly Sam3Prompt[];
	/** Convenience shorthand to select by text at frame 0. */
	readonly text?: string;
	/** Signal category metadata; defaults to "object". */
	readonly category?: string;
	/** Minimum sigmoid score for a text-selected instance. Default 0.5. */
	readonly textThreshold?: number;
	/** Most instances a text prompt selects, as track IDs 1…N by score. Default 1, or every match with `merge`. */
	readonly maxObjects?: number;
	/**
	 * Select every instance matching the text as **one** object: one mask and one memory, so
	 * tracking costs the same as a single object however many match (e.g. a whole crowd).
	 */
	readonly merge?: boolean;
	/**
	 * Every this many frames after a text prompt, run that text again and add the instances no
	 * tracked object covers yet (people who walk in, turn up from behind someone, or were lost):
	 * into the one object with `merge`, otherwise as new track IDs up to `maxObjects`. Each
	 * detection pass costs about one text prompt. Default 0: select once, then only track.
	 */
	readonly redetect?: number;
	/** Image-encoder weights; defaults to the fastest for the backend in use (`SAM3_ENCODER`). */
	readonly precision?: Sam3Precision;
}

export function validateSam3Prompts(options: Sam3Options): void {
	const prompts =
		options.prompts ?? (options.text ? [{ frame: 0, text: options.text }] : []);
	if (!prompts.length)
		throw new Error("SAM 3 requires at least one prompt or text description.");
	let previous = -1;
	for (const prompt of prompts) {
		if (!Number.isSafeInteger(prompt.frame) || prompt.frame <= previous)
			throw new Error(
				"SAM 3 prompt frames must be nonnegative, unique and increasing.",
			);
		previous = prompt.frame;
		if ((prompt.points !== undefined) === (prompt.text !== undefined))
			throw new Error("SAM 3 prompts need either points/a box or text.");
		if (prompt.points)
			validateSam2Prompts([{ frame: prompt.frame, points: prompt.points }]);
		if (prompt.text !== undefined && !prompt.text.trim())
			throw new Error("SAM 3 text prompts must not be empty.");
		if (
			prompt.object !== undefined &&
			(prompt.text !== undefined ||
				!Number.isSafeInteger(prompt.object) ||
				prompt.object < 1)
		)
			throw new Error(
				"SAM 3 prompt objects are positive track IDs on points prompts.",
			);
	}
	const maxObjects = options.maxObjects ?? 1;
	if (!Number.isSafeInteger(maxObjects) || maxObjects < 1)
		throw new Error("SAM 3 maxObjects must be a positive integer.");
	const redetect = options.redetect ?? 0;
	if (!Number.isSafeInteger(redetect) || redetect < 0)
		throw new Error(
			"SAM 3 redetect must be a nonnegative integer frame interval.",
		);
	const threshold = options.textThreshold ?? 0.5;
	if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1)
		throw new Error("SAM 3 textThreshold must be between zero and one.");
}

/** One tracked SAM 3 object at a frame; an empty mask means it is absent there. */
export interface Sam3ObjectResult {
	/** Track ID, 1-based and stable until a text prompt re-selects every object. */
	readonly id: number;
	/** Source-sized binary mask (0 or 255). */
	readonly mask: Uint8Array;
	/** Object-presence logit; positive means present. */
	readonly score: number;
	readonly iou: number;
}

export interface Sam3FrameResult {
	readonly width: number;
	readonly height: number;
	/** Every tracked object, ordered by track ID. */
	readonly objects: readonly Sam3ObjectResult[];
}
