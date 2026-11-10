/**
 * The cut, planned from the voice: one scene per line, each as long as its
 * line plus a breath before and after. Scenes cue their pictures off words
 * heard in them, so the picture follows the narration as the genre asks.
 */
import type { AudioManifest, Word } from "./assets.js";
import { sec } from "./direction.js";
import { LINE_IDS, type LineId } from "./script.js";

/** Silence before a line starts in its scene, and after it ends. */
export const LEAD = 0.5;
export const TAIL = 0.7;
/** The last scene holds longer: the recap lands, then the source. */
export const END_HOLD = 1.8;

export interface SceneTiming {
	id: LineId;
	start: number;
	duration: number;
	/** Where the line's audio starts, composition frames. */
	voiceAt: number;
	words: Word[];
}

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The scene-local frame a word is spoken at (its first occurrence from `after`). */
export function cue(t: SceneTiming, word: string, after = 0): number {
	const want = normal(word);
	const found = t.words.find(
		(w) => w.start >= after && normal(w.text) === want,
	);
	if (!found) throw new Error(`"${word}" is not spoken in the ${t.id} line.`);
	return sec(LEAD + found.start);
}

export function planTimeline(audio: AudioManifest): {
	scenes: SceneTiming[];
	total: number;
} {
	let start = 0;
	const scenes = LINE_IDS.map((id) => {
		const line = audio.lines[id];
		if (!line) throw new Error(`No voice for ${id}: run \`pnpm generate\`.`);
		const hold = id === LINE_IDS.at(-1) ? END_HOLD : TAIL;
		const duration = sec(LEAD + line.duration + hold);
		const scene = {
			id,
			start,
			duration,
			voiceAt: start + sec(LEAD),
			words: line.words,
		};
		start += duration;
		return scene;
	});
	return { scenes, total: start };
}
