/**
 * Where the song ends: the last bar line the low end still hits. The words
 * place every other chapter (chapters.ts); the final hit has none.
 */
import { BEAT_SEC, BEATS_PER_BAR } from "../grid.js";
import { SR, type Stereo, Svf } from "./dsp.js";

/** Low-band (< 150 Hz) level of every beat, in dB. */
function beatLows(mix: Stereo): number[] {
	const per = Math.round(BEAT_SEC * SR);
	const lp = new Svf();
	const out: number[] = [];
	for (let at = 0; at + per <= mix[0].length; at += per) {
		let e = 0;
		for (let i = at; i < at + per; i++) {
			const y = lp.run((mix[0][i] + mix[1][i]) * 0.5, 150, 0.2).lp;
			e += y * y;
		}
		out.push(10 * Math.log10(e / per + 1e-10));
	}
	return out;
}

/**
 * The last hit: the final downbeat that still sounds (its low end within
 * `rangeDb` of a typical beat). Past it is only the ring-out.
 */
export function findFinalHit(mix: Stereo, rangeDb = 20): number {
	const lows = beatLows(mix);
	const typical = [...lows].sort((a, b) => a - b)[
		Math.floor(lows.length * 0.6)
	];
	let last = 0;
	for (let b = 0; b * BEATS_PER_BAR < lows.length; b++)
		if (lows[b * BEATS_PER_BAR] > typical - rangeDb) last = b;
	return last;
}
