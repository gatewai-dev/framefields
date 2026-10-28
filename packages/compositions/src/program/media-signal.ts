import {
	compositionFrameContext,
	isSignal,
	type MediaTimeSignalRemap,
	type ResolvedMediaTimeRemap,
	sampleMediaSignal,
} from "@framefields/core";
import { extractRawSignalSample } from "./evaluator.js";

/** Where a signal-driven media layer sits on the composition clock. */
export interface MediaSignalLayer {
	id?: string;
	startFrame: number;
	durationFrames: number;
}

export interface MediaSignalClock {
	fps: number;
	compositionDurationFrames: number;
	/** Named composition and engine signals. */
	signals?: Record<string, unknown>;
}

/**
 * Read a `timeRemap` signal at a composition frame: a signal instance, a named
 * signal, or a named engine signal (sample arrays, analysis channels).
 */
export function mediaSignalSampler(
	binding: MediaTimeSignalRemap,
	clock: MediaSignalClock,
): (frame: number) => number {
	const { fps, compositionDurationFrames } = clock;
	if (
		!Number.isInteger(compositionDurationFrames) ||
		compositionDurationFrames <= 0
	)
		throw new Error(
			"A signal timeRemap needs the composition duration (durationFrames or durationMs)",
		);
	const source =
		typeof binding.signal === "string"
			? clock.signals?.[binding.signal]
			: binding.signal;
	if (source === undefined)
		throw new Error(
			`timeRemap signal '${String(binding.signal)}' is not a composition signal`,
		);
	if (isSignal(source))
		return (frame) =>
			Number(
				source.get(
					compositionFrameContext(frame, fps, compositionDurationFrames),
				),
			);
	return (frame) => extractRawSignalSample(source, frame, fps);
}

/**
 * Sample a signal binding up front. Valid when nothing changes the signal
 * while the composition renders; live signals are recorded per frame instead.
 */
export function sampleMediaTimeSignal(
	binding: MediaTimeSignalRemap,
	layer: MediaSignalLayer,
	clock: MediaSignalClock,
): ResolvedMediaTimeRemap {
	const sample = mediaSignalSampler(binding, clock);
	return {
		kind: "sampled",
		history: sampleMediaSignal({
			mode: binding.mode,
			fps: clock.fps,
			startFrame: layer.startFrame,
			durationFrames: layer.durationFrames,
			sourceStartSec: binding.sourceStartSec,
			sample,
		}),
	};
}
