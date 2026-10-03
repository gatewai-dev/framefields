/**
 * The film's one clock. The song is generated at 180 BPM and used untouched,
 * so its clock is the film's (generate-song.ts checks the take holds the
 * tempo). The picture runs at 60 fps: a beat is exactly 20 frames and a bar
 * 80, so every cut, lyric and pulse is an integer frame on the music's grid.
 * Where the chapters fall is measured from the song (timeline.ts).
 */

export const FPS = 60;
export const BPM = 180;
export const SAMPLE_RATE = 48_000;
export const BEATS_PER_BAR = 4;

export const BEAT_SEC = 60 / BPM;
export const BAR_SEC = BEAT_SEC * BEATS_PER_BAR;
/** Frames per beat (20) and per bar (80). */
export const BEAT = Math.round(BEAT_SEC * FPS);
export const BAR = BEAT * BEATS_PER_BAR;

/** Frame where bar `n` starts (fractions are beats: 0.25 = one beat). */
export const bar = (n: number) => Math.round(n * BAR);
/** Frame of beat `n` counted from bar 0. */
export const beat = (n: number) => Math.round(n * BEAT);

/**
 * The arrangement requested from the music model, in bars: one section per
 * chapter. The model treats it as guidance, so the film is cut to what the
 * take actually does (chapters.ts), not to this.
 */
export const PLAN = {
	intro: 0,
	drop: 4,
	tools: 10,
	type: 16,
	world: 22,
	warp: 28,
	comp: 32,
	chorus: 36,
	outro: 42,
	end: 45,
} as const;

export const PLAN_SEC = PLAN.end * BAR_SEC;
