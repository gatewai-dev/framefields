import type { FrameContext, Signal } from "./signals/index.js";

/** A sampled source-time curve or the integral of a sampled playback rate. */
export type SampledMediaSignal =
	| {
			readonly mode: "source-time";
			readonly values: Float64Array;
			readonly fps: number;
	  }
	| {
			readonly mode: "speed";
			readonly values: Float64Array;
			readonly positions: Float64Array;
			readonly fps: number;
	  };

/**
 * Sample a signal at every composition-frame boundary in layer order.
 * Values between boundaries are linearly interpolated; speeds are integrated
 * analytically, so picture and audio can query the same fractional frame.
 */
export function sampleMediaSignal(options: {
	mode: "source-time" | "speed";
	fps: number;
	startFrame: number;
	durationFrames: number;
	sourceStartSec?: number;
	sample: (compositionFrame: number) => number;
}): SampledMediaSignal {
	const { mode, fps, startFrame, durationFrames, sample } = options;
	if (
		!Number.isFinite(fps) ||
		fps <= 0 ||
		!Number.isInteger(startFrame) ||
		startFrame < 0 ||
		!Number.isInteger(durationFrames) ||
		durationFrames <= 0
	)
		throw new Error("Invalid media signal timing");
	const values = new Float64Array(durationFrames + 1);
	for (let i = 0; i <= durationFrames; i++) {
		const value = sample(startFrame + i);
		if (!Number.isFinite(value))
			throw new Error(
				`Non-finite media signal at composition frame ${startFrame + i}`,
			);
		values[i] = value;
	}
	if (mode === "source-time") return { mode, values, fps };
	const sourceStartSec = options.sourceStartSec ?? 0;
	if (!Number.isFinite(sourceStartSec) || sourceStartSec < 0)
		throw new Error("Invalid media signal source start");
	const positions = new Float64Array(values.length);
	positions[0] = sourceStartSec;
	for (let i = 0; i < durationFrames; i++) {
		positions[i + 1] = positions[i] + (values[i] / 2 + values[i + 1] / 2) / fps;
		if (!Number.isFinite(positions[i + 1]))
			throw new Error(
				`Media signal integration overflow at composition frame ${startFrame + i + 1}`,
			);
	}
	return { mode, values, positions, fps };
}

/** Sample an engine signal with its composition clock and full frame context. */
export function sampleFrameMediaSignal(options: {
	mode: "source-time" | "speed";
	fps: number;
	startFrame: number;
	durationFrames: number;
	compositionDurationFrames: number;
	sourceStartSec?: number;
	signal: Signal<number>;
}): SampledMediaSignal {
	const { fps, compositionDurationFrames, signal } = options;
	if (
		!Number.isInteger(compositionDurationFrames) ||
		compositionDurationFrames <= 0
	)
		throw new Error("Invalid composition duration");
	return sampleMediaSignal({
		...options,
		sample(frame) {
			const context: FrameContext = {
				frame,
				fps,
				time: frame / fps,
				duration: compositionDurationFrames / fps,
				durationMs: (compositionDurationFrames / fps) * 1000,
				progress: frame / compositionDurationFrames,
				deltaTime: 1 / fps,
			};
			return signal.get(context);
		},
	});
}

/** Evaluate at any fractional local frame, independent of query order. */
export function sampledMediaSourceTime(
	map: SampledMediaSignal,
	frame: number,
): number {
	if (!Number.isFinite(frame)) throw new Error("Invalid media signal frame");
	const max = map.values.length - 1;
	const f = Math.max(0, Math.min(max, frame));
	const i = Math.min(Math.floor(f), max - 1);
	const t = f - i;
	const a = map.values[i];
	const b = map.values[i + 1];
	if (map.mode === "source-time") return a * (1 - t) + b * t;
	return (
		map.positions[i] + (a * (t - (t * t) / 2) + b * ((t * t) / 2)) / map.fps
	);
}

/** Range includes direction changes inside a speed-signal interval. */
export function sampledMediaSourceRange(
	map: SampledMediaSignal,
	from: number,
	to: number,
): { min: number; max: number; maxIncluded: boolean } {
	if (!Number.isFinite(from) || !Number.isFinite(to))
		throw new Error("Invalid media signal range");
	const endFrame = map.values.length - 1;
	const start = Math.max(0, Math.min(endFrame, Math.min(from, to)));
	const end = Math.max(0, Math.min(endFrame, Math.max(from, to)));
	let min = sampledMediaSourceTime(map, start);
	let max = min;
	let maxIncluded = start < end;
	const add = (frame: number) => {
		const value = sampledMediaSourceTime(map, frame);
		min = Math.min(min, value);
		if (value > max) {
			max = value;
			maxIncluded = frame < end;
		} else if (value === max && frame < end) {
			maxIncluded = true;
		}
	};
	add(end);
	for (let i = Math.floor(start); i < end; i++) {
		if (i > start) add(i);
		if (map.mode === "speed") {
			const a = map.values[i],
				b = map.values[i + 1];
			if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
				const halfA = Math.abs(a) / 2;
				const turn = i + halfA / (halfA + Math.abs(b) / 2);
				if (turn > start && turn < end) add(turn);
			}
		}
	}
	return { min, max, maxIncluded };
}
