/**
 * The sung words on the film's clock (assets/lyrics.json): every lyric word
 * with the frame it is sung on, grouped into the lines the song was written in.
 */
import fs from "node:fs";
import { FPS } from "./grid.js";
import type { LyricWord } from "./music/align.js";
import { asset } from "./paths.js";

export interface SungWord {
	text: string;
	/** Frame the word is sung on, and the frame it ends. */
	at: number;
	end: number;
	line: number;
}

const WORDS: SungWord[] = (
	JSON.parse(fs.readFileSync(asset("lyrics.json"), "utf8")) as LyricWord[]
).map((w) => ({
	text: w.text,
	at: Math.round(w.start * FPS),
	end: Math.round(w.end * FPS),
	line: w.line,
}));

/** The words of one lyric line, in order. */
export const lineWords = (line: number): SungWord[] =>
	WORDS.filter((w) => w.line === line);

/** First and last sung frame of a line. */
export function lineSpan(line: number): { at: number; end: number } {
	const ws = lineWords(line);
	return { at: ws[0].at, end: ws[ws.length - 1].end };
}

/** The word sung at or after `frame` whose text (sans punctuation, any case) is `text`. */
export function sung(text: string, after = 0): SungWord {
	const key = text.toLowerCase();
	const w = WORDS.find(
		(x) =>
			x.at >= after && x.text.toLowerCase().replace(/[^a-z0-9']/g, "") === key,
	);
	if (!w) throw new Error(`"${text}" is not sung after frame ${after}`);
	return w;
}

/** Display form: the word without trailing punctuation. */
export const bare = (w: SungWord) => w.text.replace(/[.,!?]+$/, "");
