/**
 * The film's chapters, read off the take. The lyric leads: a chapter starts
 * on the beat its first line is sung on, so regenerating the song re-cuts the
 * film. The last chapters come from the sound: the outro starts the beat
 * after the final sung "frame", the lock-up on the final hit.
 */
import { BEAT_SEC, BEATS_PER_BAR } from "../grid.js";
import type { LyricWord } from "./align.js";

export interface Chapters {
	intro: number;
	/** "Gitframes!": the name. */
	logo: number;
	/** "No browser, …": what it is not. */
	not: number;
	/** "A hundred twenty frames a second": speed. */
	speed: number;
	/** "After Effects, Photoshop, …": the tools it folds into one import. */
	tools: number;
	type: number;
	world: number;
	/** "Drop a mesh and make it bend": 3D distortion. */
	warp: number;
	/** "It's just code": the source, typed. */
	code: number;
	/** "key it, mask it, blend the light": compositing. */
	comp: number;
	vfx: number;
	/** After the last sung chorus word: the recap. */
	outro: number;
	/** The final hit: logo lock-up. */
	final: number;
	end: number;
}

const toBar = (sec: number) => Math.floor(sec / BEAT_SEC) / BEATS_PER_BAR;

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, "");

/** The first lyric line that starts with `opening` (case and punctuation ignored). */
export function lineStarting(words: LyricWord[], opening: string): LyricWord[] {
	const lines = [...new Set(words.map((w) => w.line))];
	for (const n of lines) {
		const ws = words.filter((w) => w.line === n);
		if (normal(ws.map((w) => w.text).join(" ")).startsWith(normal(opening)))
			return ws;
	}
	throw new Error(`no lyric line starts "${opening}"`);
}

/** The beat the line's first word is sung on, in bars. */
const lineBar = (words: LyricWord[], opening: string) =>
	toBar(lineStarting(words, opening)[0].start);

export function chaptersOf(
	finalHit: number,
	words: LyricWord[],
	bars: number,
): Chapters {
	const chorus = lineStarting(words, "Frame by");
	const last = words.filter((w) => w.section === chorus[0].section).pop();
	if (!last) throw new Error("the chorus is missing");
	return {
		intro: 0,
		logo: lineBar(words, "Gitframes"),
		not: lineBar(words, "No browser"),
		speed: lineBar(words, "A hundred"),
		tools: lineBar(words, "After Effects"),
		type: lineBar(words, "Every letter"),
		world: lineBar(words, "Step inside"),
		warp: lineBar(words, "Drop a mesh"),
		code: lineBar(words, "It's just code"),
		comp: lineBar(words, "key it"),
		vfx: toBar(chorus[0].start),
		outro: toBar(last.end) + 1 / BEATS_PER_BAR,
		final: finalHit,
		end: bars,
	};
}
