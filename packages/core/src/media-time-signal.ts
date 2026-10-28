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
	const recorder = new MediaSignalRecorder(options);
	for (let i = 0; i <= options.durationFrames; i++) {
		const frame = options.startFrame + i;
		recorder.record(frame, options.sample(frame));
	}
	return recorder.finish();
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

/**
 * Records values after frame preparation, so live signal history can be replayed
 * for audio and seeks without evaluating the signal a second time.
 */
export class MediaSignalRecorder {
	private readonly values: Float64Array;
	private readonly positions: Float64Array | undefined;
	private recorded = 0;
	private evaluating = false;
	readonly startFrame: number;
	readonly durationFrames: number;
	readonly fps: number;
	readonly mode: "source-time" | "speed";

	constructor(options: {
		mode: "source-time" | "speed";
		fps: number;
		startFrame: number;
		durationFrames: number;
		sourceStartSec?: number;
	}) {
		if (
			!Number.isFinite(options.fps) ||
			options.fps <= 0 ||
			!Number.isInteger(options.startFrame) ||
			options.startFrame < 0 ||
			!Number.isInteger(options.durationFrames) ||
			options.durationFrames <= 0
		)
			throw new Error("Invalid media signal timing");
		const start = options.sourceStartSec ?? 0;
		if (!Number.isFinite(start) || start < 0)
			throw new Error("Invalid media signal source start");
		this.mode = options.mode;
		this.fps = options.fps;
		this.startFrame = options.startFrame;
		this.durationFrames = options.durationFrames;
		this.values = new Float64Array(options.durationFrames + 1);
		if (options.mode === "speed") {
			this.positions = new Float64Array(options.durationFrames + 1);
			this.positions[0] = start;
		}
	}

	/** Each boundary is recorded once in composition-frame order. */
	record(frame: number, value: number): void {
		const index = frame - this.startFrame;
		if (!Number.isInteger(frame) || index < 0 || index > this.durationFrames)
			throw new Error(`Media signal frame ${frame} is outside the layer`);
		if (!Number.isFinite(value))
			throw new Error(`Non-finite media signal at composition frame ${frame}`);
		if (index < this.recorded) {
			if (this.values[index] !== value)
				throw new Error(
					`Media signal frame ${frame} was already recorded with a different value`,
				);
			return;
		}
		if (index !== this.recorded)
			throw new Error(`Media signal frame ${frame} was recorded out of order`);
		this.values[index] = value;
		if (this.positions && index > 0) {
			const position =
				this.positions[index - 1] +
				(this.values[index - 1] / 2 + value / 2) / this.fps;
			if (!Number.isFinite(position))
				throw new Error(
					`Media signal integration overflow at composition frame ${frame}`,
				);
			this.positions[index] = position;
		}
		this.recorded++;
	}

	/** Evaluate after frame preparation, reporting recursive time dependencies. */
	recordFrom(frame: number, sample: () => number): void {
		if (this.evaluating)
			throw new Error(
				`Circular media signal dependency at composition frame ${frame}`,
			);
		this.evaluating = true;
		try {
			this.record(frame, sample());
		} finally {
			this.evaluating = false;
		}
	}

	/** The known source position at an already-recorded frame boundary. */
	at(frame: number): number {
		const index = frame - this.startFrame;
		if (!Number.isInteger(frame) || index < 0 || index >= this.recorded)
			throw new Error(`Media signal frame ${frame} has not been recorded`);
		return this.positions ? this.positions[index] : this.values[index];
	}

	/** A self-contained snapshot, available only when every boundary was recorded. */
	finish(): SampledMediaSignal {
		if (this.recorded !== this.values.length)
			throw new Error("Media signal history is incomplete");
		const values = this.values.slice();
		return this.positions
			? {
					mode: "speed",
					fps: this.fps,
					values,
					positions: this.positions.slice(),
				}
			: { mode: "source-time", fps: this.fps, values };
	}
}
