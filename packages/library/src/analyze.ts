/**
 * Measuring library audio once, at publish time, with the engine's own
 * analysis (`analyzeAudio`, the one `Waveform` and `Captions` use): beats,
 * tempo, the moment the sound starts, a waveform for the card, and where an
 * audition should start.
 */
import { levelAmplitude } from "@framefields/components/toolkit";
import type { LibraryAnalysis } from "framefields/library";

/** What `analyzeAudio` gives (the fields used here). */
export interface Levels {
	fps: number;
	frames: number;
	level: number[];
	beats: number[];
}

export interface AudioReport {
	analysis: LibraryAnalysis;
	/** About 96 values in 0–1 for the card's waveform. */
	peaks: number[];
	/** Seconds into the file an audition starts. */
	start: number;
}

/** Analysis at this rate: 10 ms steps, fine enough to place a hit on a frame. */
export const ANALYSIS_FPS = 100;

const round = (v: number, digits = 3) => Number(v.toFixed(digits));

/**
 * The waveform: the loudest moment of each of `bins` stretches, as linear
 * amplitude (a drawn waveform reads in amplitude, not dB) scaled to the peak.
 */
export function peaks(level: readonly number[], bins = 96): number[] {
	if (level.length === 0) return [];
	const out: number[] = [];
	for (let b = 0; b < bins; b++) {
		const from = Math.floor((b * level.length) / bins);
		const to = Math.max(from + 1, Math.floor(((b + 1) * level.length) / bins));
		let max = 0;
		for (let i = from; i < to && i < level.length; i++)
			max = Math.max(max, levelAmplitude(level[i] ?? 0));
		out.push(max);
	}
	const top = Math.max(...out);
	return out.map((v) => (top > 0 ? round(v / top, 2) : 0));
}

/**
 * Tempo from the onsets: the median gap between neighbouring beats, folded
 * into 70–180 bpm (half- and double-time read as the same song). Undefined
 * when there are too few beats to say.
 */
export function estimateBpm(
	beatSeconds: readonly number[],
): number | undefined {
	if (beatSeconds.length < 8) return undefined;
	const gaps = beatSeconds
		.slice(1)
		.map((t, i) => t - (beatSeconds[i] ?? 0))
		.filter((g) => g > 0.2 && g < 2)
		.sort((a, b) => a - b);
	const median = gaps[Math.floor(gaps.length / 2)];
	if (median === undefined) return undefined;
	let bpm = 60 / median;
	while (bpm < 70) bpm *= 2;
	while (bpm > 180) bpm /= 2;
	return round(bpm, 1);
}

/** First moment the envelope passes a tenth of its peak: where the sound starts. */
export function onsetSeconds(level: readonly number[], fps: number): number {
	const top = Math.max(0, ...level);
	const at = level.findIndex((v) => v >= top * 0.1);
	return round(Math.max(0, at) / fps);
}

/** Start of the loudest `window`-second stretch: what an audition plays first. */
export function strongestStart(
	level: readonly number[],
	fps: number,
	window = 12,
): number {
	const span = Math.round(window * fps);
	if (level.length <= span) return 0;
	let sum = 0;
	for (let i = 0; i < span; i++) sum += level[i] ?? 0;
	let best = sum;
	let at = 0;
	for (let i = span; i < level.length; i++) {
		sum += (level[i] ?? 0) - (level[i - span] ?? 0);
		if (sum > best) {
			best = sum;
			at = i - span + 1;
		}
	}
	// Start on a whole second: auditions read better from a clean spot.
	return Math.floor(at / fps);
}

/** Everything a card and the generated module need, from one analysis pass. */
export function reportAudio(levels: Levels, music: boolean): AudioReport {
	const beats = levels.beats.map((f) => round(f / levels.fps));
	const bpm = music ? estimateBpm(beats) : undefined;
	return {
		analysis: {
			duration: round(levels.frames / levels.fps, 2),
			beats,
			...(bpm !== undefined && { bpm }),
			onset: onsetSeconds(levels.level, levels.fps),
		},
		peaks: peaks(levels.level),
		start: music ? strongestStart(levels.level, levels.fps) : 0,
	};
}
