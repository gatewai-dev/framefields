import { z } from "zod";
import {
	type MediaSignalRecorder,
	type SampledMediaSignal,
	sampledMediaSourceRange,
	sampledMediaSourceTime,
} from "./media-time-signal.js";

/** Maps layer-local frames to absolute source seconds. */
export const MediaTimeRemapSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("rate"),
			sourceStartSec: z.number().finite().nonnegative(),
			rate: z
				.number()
				.finite()
				.refine((v) => v !== 0, "rate must not be zero"),
		})
		.strict(),
	z
		.object({
			kind: z.literal("keyframes"),
			keyframes: z
				.array(
					z
						.object({
							frame: z.number().int().nonnegative(),
							sourceSec: z.number().finite().nonnegative(),
							interpolation: z
								.enum(["linear", "ease-in", "ease-out", "smooth"])
								.optional(),
						})
						.strict(),
				)
				.min(2),
		})
		.strict(),
]);

export type MediaTimeRemap = z.infer<typeof MediaTimeRemapSchema>;

/** A per-render signal history resolved by the media timing scheduler. */
export type ResolvedMediaTimeRemap =
	| MediaTimeRemap
	| { readonly kind: "sampled"; readonly history: SampledMediaSignal }
	| { readonly kind: "recorded"; readonly recorder: MediaSignalRecorder };

function assertSampledFps(history: SampledMediaSignal, fps: number): void {
	if (history.fps !== fps)
		throw new Error(
			`Media signal history fps ${history.fps} does not match composition fps ${fps}`,
		);
}

/** Validate the map against its explicit, exclusive layer duration. */
export function validateMediaTimeRemap(
	map: MediaTimeRemap,
	durationFrames: number,
): string | undefined {
	if (!Number.isInteger(durationFrames) || durationFrames <= 0)
		return "durationFrames must be a positive integer";
	if (map.kind === "rate") return;
	const keys = map.keyframes;
	if (
		keys.length < 2 ||
		keys[0].frame !== 0 ||
		keys[keys.length - 1].frame !== durationFrames
	) {
		return "time remap keyframes must start at frame 0 and end at durationFrames";
	}
	for (let i = 1; i < keys.length; i++) {
		if (keys[i].frame <= keys[i - 1].frame)
			return "time remap keyframes must have strictly increasing frames";
	}
}

/** Find the segment containing a layer-local frame. */
function segmentIndex(
	map: Extract<MediaTimeRemap, { kind: "keyframes" }>,
	frame: number,
): number {
	let lo = 0;
	let hi = map.keyframes.length - 1;
	while (hi - lo > 1) {
		const mid = Math.floor((lo + hi) / 2);
		if (map.keyframes[mid].frame <= frame) lo = mid;
		else hi = mid;
	}
	return lo;
}

/** Evaluate the monotonic easing assigned to the starting keyframe. */
function shapeTime(
	t: number,
	interpolation: "linear" | "ease-in" | "ease-out" | "smooth",
): number {
	switch (interpolation) {
		case "ease-in":
			return t * t;
		case "ease-out":
			return 1 - (1 - t) * (1 - t);
		case "smooth":
			return t * t * (3 - 2 * t);
		default:
			return t;
	}
}

/** Absolute source seconds at a fractional layer-local frame. */
export function mediaSourceTime(
	map: ResolvedMediaTimeRemap,
	localFrame: number,
	fps: number,
): number {
	if (!Number.isFinite(localFrame) || !Number.isFinite(fps) || fps <= 0)
		throw new Error("Invalid media time or fps");
	if (map.kind === "recorded") {
		if (map.recorder.fps !== fps)
			throw new Error(
				"Media signal recorder fps does not match composition fps",
			);
		return map.recorder.sourceTime(localFrame);
	}
	if (map.kind === "sampled") {
		assertSampledFps(map.history, fps);
		return sampledMediaSourceTime(map.history, localFrame);
	}
	if (map.kind === "rate")
		return map.sourceStartSec + (localFrame / fps) * map.rate;
	const keys = map.keyframes;
	if (keys.length < 2)
		throw new Error("Time remap needs at least two keyframes");
	if (localFrame <= keys[0].frame) return keys[0].sourceSec;
	if (localFrame >= keys[keys.length - 1].frame)
		return keys[keys.length - 1].sourceSec;
	const i = segmentIndex(map, localFrame);
	const a = keys[i];
	const b = keys[i + 1];
	const t = (localFrame - a.frame) / (b.frame - a.frame);
	return (
		a.sourceSec +
		(b.sourceSec - a.sourceSec) * shapeTime(t, a.interpolation ?? "linear")
	);
}

/** True only for a constant source-time interval, not a ramp with zero instantaneous velocity. */
export function mediaSourceIsHold(
	map: ResolvedMediaTimeRemap,
	frame: number,
): boolean {
	if (map.kind === "rate") return false;
	if (map.kind === "recorded") return map.recorder.isHold(frame);
	if (map.kind === "sampled") {
		const values = map.history.values;
		const i = Math.max(0, Math.min(values.length - 2, Math.floor(frame)));
		return map.history.mode === "speed"
			? values[i] === 0 && values[i + 1] === 0
			: values[i] === values[i + 1];
	}
	const i = segmentIndex(map, frame);
	return map.keyframes[i].sourceSec === map.keyframes[i + 1].sourceSec;
}

/** Source seconds per output second at a layer-local frame. */
export function mediaSourceRate(
	map: ResolvedMediaTimeRemap,
	frame: number,
	fps: number,
): number {
	if (map.kind === "rate") return map.rate;
	if (map.kind === "recorded") {
		if (map.recorder.fps !== fps)
			throw new Error(
				"Media signal recorder fps does not match composition fps",
			);
		return map.recorder.rate(frame);
	}
	if (map.kind === "sampled") {
		assertSampledFps(map.history, fps);
		const values = map.history.values;
		const i = Math.max(0, Math.min(values.length - 2, Math.floor(frame)));
		const t = Math.max(0, Math.min(1, frame - i));
		return map.history.mode === "speed"
			? values[i] * (1 - t) + values[i + 1] * t
			: (values[i + 1] - values[i]) * map.history.fps;
	}
	const i = segmentIndex(map, frame);
	const a = map.keyframes[i];
	const b = map.keyframes[i + 1];
	const t = Math.max(0, Math.min(1, (frame - a.frame) / (b.frame - a.frame)));
	const derivative =
		a.interpolation === "ease-in"
			? 2 * t
			: a.interpolation === "ease-out"
				? 2 * (1 - t)
				: a.interpolation === "smooth"
					? 6 * t * (1 - t)
					: 1;
	return ((b.sourceSec - a.sourceSec) / (b.frame - a.frame)) * fps * derivative;
}

/** Bounds over a local-frame interval, including intermediate turns. */
export function mediaSourceRange(
	map: ResolvedMediaTimeRemap,
	fromFrame: number,
	toFrame: number,
	fps: number,
): { min: number; max: number; maxIncluded: boolean } {
	if (map.kind === "recorded") {
		if (map.recorder.fps !== fps)
			throw new Error(
				"Media signal recorder fps does not match composition fps",
			);
		return map.recorder.range(fromFrame, toFrame);
	}
	if (map.kind === "sampled") {
		assertSampledFps(map.history, fps);
		return sampledMediaSourceRange(map.history, fromFrame, toFrame);
	}
	const start = Math.min(fromFrame, toFrame),
		end = Math.max(fromFrame, toFrame);
	const first = mediaSourceTime(map, start, fps);
	const last = mediaSourceTime(map, end, fps);
	let min = Math.min(first, last);
	let max = Math.max(first, last);
	let maxIncluded = start < end && first === max;
	if (map.kind === "keyframes") {
		for (const key of map.keyframes) {
			if (key.frame <= start || key.frame >= end) continue;
			min = Math.min(min, key.sourceSec);
			if (key.sourceSec > max) {
				max = key.sourceSec;
				maxIncluded = true;
			} else if (key.sourceSec === max) maxIncluded = true;
		}
	}
	return { min, max, maxIncluded };
}
