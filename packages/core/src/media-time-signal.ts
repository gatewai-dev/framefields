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
	if (map.mode === "source-time") return a + (b - a) * t;
	return map.positions[i] + (a * t + ((b - a) * t * t) / 2) / map.fps;
}

/** Range includes direction changes inside a speed-signal interval. */
export function sampledMediaSourceRange(
	map: SampledMediaSignal,
	from: number,
	to: number,
): { min: number; max: number } {
	if (!Number.isFinite(from) || !Number.isFinite(to))
		throw new Error("Invalid media signal range");
	const endFrame = map.values.length - 1;
	const start = Math.max(0, Math.min(endFrame, Math.min(from, to)));
	const end = Math.max(0, Math.min(endFrame, Math.max(from, to)));
	let min = sampledMediaSourceTime(map, start);
	let max = min;
	const add = (frame: number) => {
		const value = sampledMediaSourceTime(map, frame);
		min = Math.min(min, value);
		max = Math.max(max, value);
	};
	add(end);
	for (let i = Math.floor(start); i < end; i++) {
		if (i > start) add(i);
		if (map.mode === "speed") {
			const a = map.values[i],
				b = map.values[i + 1];
			if (a * b < 0) {
				const turn = i - a / (b - a);
				if (turn > start && turn < end) add(turn);
			}
		}
	}
	return { min, max };
}
