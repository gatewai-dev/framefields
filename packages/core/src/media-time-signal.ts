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
		sample: (frame) =>
			signal.get(
				compositionFrameContext(frame, fps, compositionDurationFrames),
			),
	});
}

/** The frame context a composition-clock signal sees at a composition frame. */
export function compositionFrameContext(
	frame: number,
	fps: number,
	compositionDurationFrames: number,
): FrameContext {
	return {
		frame,
		fps,
		time: frame / fps,
		duration: compositionDurationFrames / fps,
		durationMs: (compositionDurationFrames / fps) * 1000,
		progress: Math.min(1, frame / compositionDurationFrames),
		deltaTime: 1 / fps,
	};
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

/** Source-time bounds over a layer interval; `max` is exclusive unless included. */
export interface MediaSourceRange {
	min: number;
	max: number;
	maxIncluded: boolean;
}

/** Range includes direction changes inside a speed-signal interval. */
export function sampledMediaSourceRange(
	map: SampledMediaSignal,
	from: number,
	to: number,
): MediaSourceRange {
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
 * Records a live signal at each composition-frame boundary, so its history can
 * be replayed for audio, seeks and vision without evaluating it a second time.
 * With a sampler, boundaries are evaluated on demand, but never past the
 * frame the composition has reached ({@link advance}): no look-ahead.
 */
export class MediaSignalRecorder {
	private readonly values: Float64Array;
	private readonly positions: Float64Array | undefined;
	private recorded = 0;
	private evaluating = false;
	private horizon = -1;
	private sampler: ((frame: number) => number) | undefined;
	private check: ((range: MediaSourceRange) => void) | undefined;
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
		sample?: (compositionFrame: number) => number;
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
		this.sampler = options.sample;
		this.values = new Float64Array(options.durationFrames + 1);
		if (options.mode === "speed") {
			this.positions = new Float64Array(options.durationFrames + 1);
			this.positions[0] = start;
		}
	}

	/** The first composition frame whose boundary is not yet recorded. */
	get nextFrame(): number {
		return this.startFrame + this.recorded;
	}

	get complete(): boolean {
		return this.recorded === this.values.length;
	}

	/** Allow on-demand sampling through a composition frame the clock has reached. */
	advance(frame: number): void {
		if (frame > this.horizon) this.horizon = frame;
	}

	/**
	 * Validate source bounds as history arrives: the recorded part now, each
	 * further interval as it is recorded.
	 */
	checkRange(check: (range: MediaSourceRange) => void): void {
		this.check = check;
		if (this.recorded > 1) check(this.range(0, this.recorded - 1));
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
		if (this.check && index > 0) this.check(this.interval(index - 1));
		this.recorded++;
	}

	/**
	 * Evaluate a boundary once, reporting recursive time dependencies. A
	 * boundary already recorded is kept, and `sample` is not called again.
	 */
	recordFrom(frame: number, sample: () => number): void {
		if (this.evaluating)
			throw new Error(
				`Circular media signal dependency at composition frame ${frame}`,
			);
		if (frame - this.startFrame < this.recorded) return;
		this.evaluating = true;
		try {
			this.record(frame, sample());
		} finally {
			this.evaluating = false;
		}
	}

	/** Sample every boundary through `frame` that the clock has reached. */
	ensure(frame: number): void {
		const sampler = this.sampler;
		if (!sampler) return;
		const last = Math.min(
			frame,
			this.horizon,
			this.startFrame + this.durationFrames,
		);
		if (this.evaluating && frame >= this.nextFrame)
			throw new Error(
				`Circular media signal dependency at composition frame ${this.nextFrame}`,
			);
		for (let f = this.nextFrame; f <= last; f++)
			this.recordFrom(f, () => sampler(f));
	}

	/**
	 * Close a layer that outlives the clock: the boundaries past the last
	 * rendered frame hold the last recorded value.
	 */
	close(): void {
		if (this.recorded === 0)
			throw new Error("Media signal history has no recorded frames");
		const last = this.values[this.recorded - 1];
		while (!this.complete) this.record(this.nextFrame, last);
	}

	/** The known source position at an already-recorded frame boundary. */
	at(frame: number): number {
		this.ensure(frame);
		const index = frame - this.startFrame;
		if (!Number.isInteger(frame) || index < 0 || index >= this.recorded)
			throw new Error(`Media signal frame ${frame} has not been recorded`);
		return this.positions ? this.positions[index] : this.values[index];
	}

	/** Read a recorded local frame, including fractional audio sample positions. */
	sourceTime(localFrame: number): number {
		if (Number.isFinite(localFrame))
			this.ensure(this.startFrame + Math.ceil(localFrame));
		if (
			!Number.isFinite(localFrame) ||
			localFrame < 0 ||
			localFrame > this.recorded - 1
		)
			throw new Error(
				`Media signal local frame ${localFrame} has not been recorded`,
			);
		if (Number.isInteger(localFrame))
			return this.at(this.startFrame + localFrame);
		const i = Math.floor(localFrame);
		const t = localFrame - i;
		const a = this.values[i];
		const b = this.values[i + 1];
		return this.positions
			? this.positions[i] +
					(a * (t - (t * t) / 2) + b * ((t * t) / 2)) / this.fps
			: a * (1 - t) + b * t;
	}

	/** Read the instantaneous speed for an interval whose endpoints are known. */
	rate(localFrame: number): number {
		const i = this.knownInterval(localFrame);
		const a = this.values[i];
		const b = this.values[i + 1];
		const t = localFrame - i;
		return this.positions ? a * (1 - t) + b * t : (b - a) * this.fps;
	}

	isHold(localFrame: number): boolean {
		const i = this.knownInterval(localFrame);
		return this.positions
			? this.values[i] === 0 && this.values[i + 1] === 0
			: this.values[i] === this.values[i + 1];
	}

	range(from: number, to: number): MediaSourceRange {
		if (Number.isFinite(from) && Number.isFinite(to))
			this.ensure(this.startFrame + Math.ceil(Math.max(from, to)));
		if (
			!Number.isFinite(from) ||
			!Number.isFinite(to) ||
			from < 0 ||
			to < 0 ||
			Math.max(from, to) > this.recorded - 1
		)
			throw new Error("Media signal range has not been recorded");
		if (this.recorded === 1) {
			const value = this.sourceTime(0);
			return { min: value, max: value, maxIncluded: false };
		}
		return sampledMediaSourceRange(this.history(0, this.recorded), from, to);
	}

	/** A self-contained snapshot, available only when every boundary was recorded. */
	finish(): SampledMediaSignal {
		if (!this.complete) throw new Error("Media signal history is incomplete");
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

	private knownInterval(localFrame: number): number {
		const i = Math.floor(localFrame);
		if (Number.isFinite(localFrame)) this.ensure(this.startFrame + i + 1);
		if (!Number.isFinite(localFrame) || i < 0 || i + 1 >= this.recorded)
			throw new Error(
				`Media signal interval ${localFrame} has not been recorded`,
			);
		return i;
	}

	/** Bounds of the interval starting at boundary `i`, its end exclusive. */
	private interval(i: number): MediaSourceRange {
		return sampledMediaSourceRange(this.history(i, i + 2), 0, 1);
	}

	private history(from: number, to: number): SampledMediaSignal {
		const values = this.values.subarray(from, to);
		return this.positions
			? {
					mode: "speed",
					fps: this.fps,
					values,
					positions: this.positions.subarray(from, to),
				}
			: { mode: "source-time", fps: this.fps, values };
	}
}
