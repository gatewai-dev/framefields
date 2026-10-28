import {
	type MediaSignalResolver,
	mediaSignalSampler,
	sampleMediaTimeSignal,
} from "@framefields/compositions/program";
import {
	type FrameContext,
	MediaSignalRecorder,
	type MediaTimeSignalRemap,
	type ResolvedMediaTimeRemap,
} from "@framefields/core";

interface Entry {
	binding: MediaTimeSignalRemap;
	live: boolean;
	compositionFrames: number;
	resolved: ResolvedMediaTimeRemap;
}

/**
 * The timing histories behind a composition's signal `timeRemap`s. Each layer
 * resolves to one history shared by every compile, so video, audio, vision and
 * preview read the same source clock. Without frame hooks nothing can change
 * a signal mid-render, so it is sampled up front. With hooks the signal is
 * live: each boundary is recorded once, after its frame's hooks, in frame
 * order, and replayed for seeks and audio.
 */
export class MediaSignalTimeline {
	private readonly entries = new Map<string, Entry>();
	private reached = -1;

	constructor(private readonly fps: number) {}

	resolver(options: {
		live: boolean;
		compositionDurationFrames: number;
		signals: Record<string, unknown>;
	}): MediaSignalResolver {
		const { live, compositionDurationFrames } = options;
		const clock = {
			fps: this.fps,
			compositionDurationFrames,
			signals: options.signals,
		};
		return (binding, layer) => {
			const key = `${layer.id}\u0000${layer.startFrame}\u0000${layer.durationFrames}`;
			const cached = this.entries.get(key);
			if (
				cached &&
				cached.live === live &&
				cached.compositionFrames === compositionDurationFrames &&
				sameBinding(cached.binding, binding)
			)
				return cached.resolved;
			const resolved: ResolvedMediaTimeRemap = live
				? {
						kind: "recorded",
						recorder: new MediaSignalRecorder({
							mode: binding.mode,
							fps: this.fps,
							startFrame: layer.startFrame,
							durationFrames: layer.durationFrames,
							sourceStartSec: binding.sourceStartSec,
							sample: mediaSignalSampler(binding, clock),
						}),
					}
				: sampleMediaTimeSignal(binding, layer, clock);
			this.entries.set(key, {
				binding,
				live,
				compositionFrames: compositionDurationFrames,
				resolved,
			});
			return resolved;
		};
	}

	/**
	 * Frames to run, in order, before `frame` so live histories have no gaps:
	 * a seek forward replays the frames it skipped. A seek back replays
	 * nothing; recorded history is reused.
	 */
	framesBefore(frame: number): number[] {
		const needs = this.recorders().some(
			(r) => !r.complete && r.nextFrame < frame,
		);
		if (!needs) return [];
		const frames: number[] = [];
		for (let f = this.reached + 1; f < frame; f++) frames.push(f);
		return frames;
	}

	/** Let live signals be read through `frame` (no look-ahead past the clock). */
	advance(frame: number): void {
		for (const r of this.recorders()) r.advance(frame);
	}

	/**
	 * Record each live boundary at `frame` once its hooks have run. At the
	 * composition's last frame, layers that outlive it hold their last value.
	 */
	reach(frame: number): void {
		if (frame > this.reached) this.reached = frame;
		for (const [, entry] of this.entries) {
			if (entry.resolved.kind !== "recorded") continue;
			const recorder = entry.resolved.recorder;
			recorder.ensure(frame);
			if (
				frame >= entry.compositionFrames - 1 &&
				!recorder.complete &&
				recorder.nextFrame > recorder.startFrame
			)
				recorder.close();
		}
	}

	/** True while a live history still has boundaries to record. */
	get pending(): boolean {
		return this.recorders().some((r) => !r.complete);
	}

	private recorders(): MediaSignalRecorder[] {
		const out: MediaSignalRecorder[] = [];
		for (const { resolved } of this.entries.values())
			if (resolved.kind === "recorded") out.push(resolved.recorder);
		return out;
	}
}

function sameBinding(
	a: MediaTimeSignalRemap,
	b: MediaTimeSignalRemap,
): boolean {
	return (
		a.signal === b.signal &&
		a.mode === b.mode &&
		a.sourceStartSec === b.sourceStartSec
	);
}

/** The frame context of another frame on the same clock. */
export function contextAtFrame(ctx: FrameContext, frame: number): FrameContext {
	const time = ctx.fps > 0 ? frame / ctx.fps : 0;
	return {
		...ctx,
		frame,
		time,
		progress:
			ctx.duration > 0 ? Math.max(0, Math.min(1, time / ctx.duration)) : 0,
	};
}

const remapIds = new WeakMap<object, number>();
let nextRemapId = 0;

/**
 * A key equal for the same source clock: by value for a fixed map, by
 * identity for a resolved signal history.
 */
export function remapKey(map: ResolvedMediaTimeRemap | undefined): string {
	if (!map) return "";
	if (map.kind === "rate" || map.kind === "keyframes")
		return JSON.stringify(map);
	const target = map.kind === "sampled" ? map.history : map.recorder;
	let id = remapIds.get(target);
	if (id === undefined) {
		id = ++nextRemapId;
		remapIds.set(target, id);
	}
	return `${map.kind}:${id}`;
}
