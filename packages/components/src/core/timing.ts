/**
 * Frame math. Component times are integer frames (the SDK convention);
 * real-world inputs (seconds, beats, chars/sec) are rounded once, here.
 */
import { rng } from "./rng.js";

/** Seconds → whole frames. */
export function toFrames(seconds: number, fps: number): number {
	assertFps(fps);
	return Math.round(seconds * fps);
}

/** Whole frames → seconds. */
export function toSeconds(frames: number, fps: number): number {
	assertFps(fps);
	return frames / fps;
}

/** `n` beats of `beatFrames` each, as whole frames. */
export function beats(n: number, beatFrames: number): number {
	return Math.round(n * beatFrames);
}

/** Snap a frame to the nearest multiple of `grid` (no-op when grid ≤ 0). */
export function quantize(frame: number, grid: number | undefined): number {
	if (!grid || grid <= 0) return Math.round(frame);
	return Math.round(Math.round(frame / grid) * grid);
}

/**
 * Speeds in themes are authored at 30 fps; this rescales them so motion
 * lasts the same time at any frame rate.
 */
export function scaleFrames(framesAt30: number, fps: number): number {
	assertFps(fps);
	return Math.max(1, Math.round((framesAt30 * fps) / 30));
}

export type StaggerOrder =
	| "forward"
	| "reverse"
	| "center"
	| "edges"
	| "random";

/**
 * Start offset (frames) for each of `count` units, `stagger` frames apart,
 * in the given order. `random` is a seeded shuffle of the forward offsets.
 */
export function staggerOffsets(
	count: number,
	stagger: number,
	order: StaggerOrder = "forward",
	seed = 1,
): number[] {
	if (count <= 0) return [];
	const rank = staggerRanks(count, order, seed);
	return rank.map((r) => Math.round(r * stagger));
}

/** The position (0 = first) at which each unit starts, by order. */
export function staggerRanks(
	count: number,
	order: StaggerOrder,
	seed = 1,
): number[] {
	const idx = Array.from({ length: count }, (_, i) => i);
	const center = (count - 1) / 2;
	switch (order) {
		case "forward":
			return idx;
		case "reverse":
			return idx.map((i) => count - 1 - i);
		case "center":
			return idx.map((i) => Math.abs(i - center));
		case "edges":
			return idx.map((i) => center - Math.abs(i - center));
		case "random": {
			const r = rng(seed);
			const shuffled = [...idx];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = Math.floor(r.next() * (i + 1));
				[shuffled[i], shuffled[j]] = [
					shuffled[j] as number,
					shuffled[i] as number,
				];
			}
			const ranks = new Array<number>(count);
			shuffled.forEach((unit, position) => {
				ranks[unit] = position;
			});
			return ranks;
		}
	}
}

/** A closed frame range. */
export interface FrameWindow {
	start: number;
	end: number;
}

export const frameSpan = (start: number, duration: number): FrameWindow => ({
	start,
	end: start + Math.max(0, duration),
});

export const within = (frame: number, w: FrameWindow): boolean =>
	frame >= w.start && frame <= w.end;

/** The smallest window that covers all of `windows`. */
export function cover(windows: readonly FrameWindow[]): FrameWindow {
	if (windows.length === 0) return { start: 0, end: 0 };
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const w of windows) {
		start = Math.min(start, w.start);
		end = Math.max(end, w.end);
	}
	return { start, end };
}

/** Lay out durations back to back from `start`, with `gap` frames between. */
export function chain(
	durations: readonly number[],
	start = 0,
	gap = 0,
): FrameWindow[] {
	const out: FrameWindow[] = [];
	let cursor = start;
	for (const d of durations) {
		out.push(frameSpan(cursor, d));
		cursor += d + gap;
	}
	return out;
}

function assertFps(fps: number): void {
	if (!(fps > 0) || !Number.isFinite(fps)) {
		throw new Error(`fps must be a positive number, got ${fps}`);
	}
}
