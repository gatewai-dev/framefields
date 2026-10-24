/**
 * Words to on-screen phrases: what is shown together, broken into lines.
 * A phrase never splits a word, prefers to end at punctuation or a pause,
 * and every line fits the safe area as measured (not just by characters).
 */
import type { Word } from "./parse.js";

export interface GroupOptions {
	maxChars: number;
	maxWords: number;
	maxLines: number;
	breakOnPunctuation: boolean;
	/** A silence this long (seconds) always starts a new phrase. */
	minGap: number;
}

export interface Phrase {
	/** Indices into the words, per line. */
	lines: number[][];
	/** First and last word index (inclusive). */
	first: number;
	last: number;
	/** Seconds. */
	start: number;
	end: number;
}

const STRONG = /[.!?…]["')\]]*$/;
const SOFT = /[,;:—–]["')\]]*$/;

/** Group words into phrases. `fits(line)` says whether a line of text fits the width. */
export function buildPhrases(
	words: readonly Word[],
	o: GroupOptions,
	fits: (line: string) => boolean = () => true,
	/** Seconds a phrase lingers after its last word, if nothing follows sooner. */
	linger = 0.6,
): Phrase[] {
	const phrases: Phrase[] = [];
	let lines: number[][] = [];
	const lineText = (line: number[]) =>
		line.map((i) => words[i]?.text ?? "").join(" ");
	const count = () => lines.reduce((a, l) => a + l.length, 0);
	const chars = () => lines.map(lineText).join(" ").length;

	const close = () => {
		if (lines.length === 0) return;
		const flat = lines.flat();
		const first = flat[0] as number;
		const last = flat[flat.length - 1] as number;
		phrases.push({
			lines,
			first,
			last,
			start: (words[first] as Word).start,
			end: (words[last] as Word).end,
		});
		lines = [];
	};

	words.forEach((word, i) => {
		const prev = words[i - 1];
		if (prev && lines.length > 0) {
			const pause = word.start - prev.end >= o.minGap;
			const strong = o.breakOnPunctuation && STRONG.test(prev.text);
			const soft =
				o.breakOnPunctuation &&
				SOFT.test(prev.text) &&
				chars() >= o.maxChars * 0.6;
			if (pause || strong || soft || count() >= o.maxWords) close();
		}
		const line = lines[lines.length - 1];
		if (line) {
			const candidate = `${lineText(line)} ${word.text}`;
			if (candidate.length <= o.maxChars && fits(candidate)) {
				line.push(i);
				return;
			}
			if (lines.length >= o.maxLines) close();
		}
		lines.push([i]);
	});
	close();

	// On screen until the next phrase starts, lingering a little after the last word.
	phrases.forEach((p, k) => {
		const next = phrases[k + 1];
		p.end = next ? Math.min(next.start, p.end + linger) : p.end + linger;
	});
	return phrases;
}

/** The text a phrase shows, lines joined with newlines. */
export function phraseText(p: Phrase, words: readonly Word[]): string {
	return p.lines
		.map((l) => l.map((i) => words[i]?.text ?? "").join(" "))
		.join("\n");
}
