/**
 * Lyric alignment: the words we wrote, timed by the words the transcriber
 * heard. A dynamic program pairs lyric tokens with transcript chunks (fuzzy,
 * and allowing a word split in two or two words run together); unmatched
 * words are interpolated between their matched neighbours, so every word on
 * screen has a time. Heard numerals are spelled out first ("120" sung as
 * "a hundred twenty"), and a guessed time leans late: a word on screen
 * before the voice reads as a mistake, one a beat after reads as an echo.
 */
import type { SongSection } from "../song.js";

export interface HeardWord {
	text: string;
	start: number;
	end: number;
}

export interface LyricWord {
	/** As written, punctuation included: what the screen shows. */
	text: string;
	section: number;
	line: number;
	start: number;
	end: number;
	/** True when the time came from the transcript, false when interpolated. */
	heard: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Words the transcriber writes for the same sound ("a hundred" / "one hundred"). */
const ALIASES: Record<string, string> = { a: "one", an: "one" };
const alias = (w: string) => ALIASES[w] ?? w;

const ONES = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
];
const TENS = [
	"",
	"",
	"twenty",
	"thirty",
	"forty",
	"fifty",
	"sixty",
	"seventy",
	"eighty",
	"ninety",
];

/** A whole number below 10 000 in words: 120 → one hundred twenty. */
export function spell(n: number): string[] {
	if (n < 20) return [ONES[n]];
	if (n < 100)
		return n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]];
	if (n < 1000) {
		const rest = n % 100;
		return [ONES[Math.floor(n / 100)], "hundred", ...(rest ? spell(rest) : [])];
	}
	const rest = n % 1000;
	return [
		...spell(Math.floor(n / 1000)),
		"thousand",
		...(rest ? spell(rest) : []),
	];
}

/** Heard numerals become the words that were sung, splitting the numeral's time evenly. */
function spellNumerals(heard: HeardWord[]): HeardWord[] {
	return heard.flatMap((h) => {
		const digits = h.text.replace(/[^\w]/g, "");
		if (!/^\d+$/.test(digits) || Number(digits) >= 10_000) return [h];
		const words = spell(Number(digits));
		const step = (h.end - h.start) / words.length;
		return words.map((text, k) => ({
			text,
			start: h.start + k * step,
			end: h.start + (k + 1) * step,
		}));
	});
}

function similarity(a: string, b: string): number {
	a = alias(a);
	b = alias(b);
	if (a === b) return 1;
	if (!a.length || !b.length) return 0;
	const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0];
		prev[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const up = prev[j];
			prev[j] = Math.min(
				prev[j] + 1,
				prev[j - 1] + 1,
				diag + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			diag = up;
		}
	}
	return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const MATCH = 0.6;

interface Span {
	start: number;
	end: number;
}

/**
 * One way to consume tokens: lyric words `di` and heard words `dj`, timed
 * from the heard words. Transcribers split and merge words ("Get framed" for
 * "Gitframes", "byFrame" for "by frame"), so 2:1 and 1:2 pairings count too.
 */
interface Move {
	di: number;
	dj: number;
	/** Similarity a pairing needs; two lyric words scored as one must match closely. */
	min: number;
	sim: (i: number, j: number) => number;
	spans: (i: number, j: number) => Span[];
}

function moves(lyric: string[], heard: HeardWord[], keys: string[]): Move[] {
	const at = (j: number): Span => ({
		start: heard[j].start,
		end: heard[j].end,
	});
	return [
		{
			di: 1,
			dj: 1,
			min: MATCH,
			sim: (i, j) => similarity(lyric[i], keys[j]),
			spans: (_, j) => [at(j)],
		},
		{
			di: 1,
			dj: 2,
			min: MATCH,
			sim: (i, j) => similarity(lyric[i], keys[j] + keys[j + 1]),
			spans: (_, j) => [{ start: heard[j].start, end: heard[j + 1].end }],
		},
		{
			di: 2,
			dj: 1,
			min: 0.8,
			sim: (i, j) => similarity(lyric[i] + lyric[i + 1], keys[j]),
			spans: (i, j) => {
				const { start, end } = at(j);
				const cut =
					start +
					((end - start) * lyric[i].length) /
						(lyric[i].length + lyric[i + 1].length);
				return [
					{ start, end: cut },
					{ start: cut, end },
				];
			},
		},
	];
}

/** Times for the lyric words the transcript heard, maximising total similarity in order. */
function match(lyric: string[], heard: HeardWord[]): Map<number, Span> {
	const keys = heard.map((h) => norm(h.text));
	const n = lyric.length;
	const m = heard.length;
	const options = moves(lyric, heard, keys);
	const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
	const best = (i: number, j: number) => {
		let s = Math.max(i < n ? score[i + 1][j] : 0, j < m ? score[i][j + 1] : 0);
		let pick: Move | null = null;
		for (const mv of options) {
			if (i + mv.di > n || j + mv.dj > m) continue;
			const sim = mv.sim(i, j);
			if (sim >= mv.min && sim * mv.di + score[i + mv.di][j + mv.dj] > s) {
				s = sim * mv.di + score[i + mv.di][j + mv.dj];
				pick = mv;
			}
		}
		return { s, pick };
	};
	for (let i = n; i >= 0; i--)
		for (let j = m; j >= 0; j--) if (i < n || j < m) score[i][j] = best(i, j).s;

	const out = new Map<number, Span>();
	for (let i = 0, j = 0; i < n && j < m; ) {
		const { pick } = best(i, j);
		if (pick) {
			for (const [k, span] of pick.spans(i, j).entries()) out.set(i + k, span);
			i += pick.di;
			j += pick.dj;
		} else if (score[i + 1][j] >= score[i][j + 1]) i++;
		else j++;
	}
	return out;
}

interface Token {
	text: string;
	section: number;
	line: number;
}

function tokenize(sections: SongSection[]): Token[] {
	const out: Token[] = [];
	let line = 0;
	sections.forEach((s, section) => {
		for (const text of s.lines) {
			for (const w of text.split(/\s+/).filter(Boolean))
				out.push({ text: w, section, line });
			line++;
		}
	});
	return out;
}

/** Average sung word length, for gaps with no timed word after them. */
const WORD_SEC = 0.3;

/** Spreads each run of unmatched words evenly between its timed neighbours. */
function interpolate(
	words: (LyricWord | null)[],
	tokens: Token[],
): LyricWord[] {
	const out = [...words];
	for (let i = 0; i < out.length; ) {
		if (out[i]) {
			i++;
			continue;
		}
		let j = i;
		while (j < out.length && !out[j]) j++;
		const prev = out[i - 1];
		const next = out[j];
		// The run is sung at the usual pace, packed against the word after it
		// (never before the word before it); with one neighbour, beside it.
		const pace = WORD_SEC * (j - i);
		const t1 = next ? next.start : (prev?.end ?? 0) + pace;
		const t0 = prev ? Math.max(prev.end, t1 - pace) : t1 - pace;
		const step = Math.max(0, t1 - t0) / (j - i);
		for (let k = i; k < j; k++) {
			const start = t0 + step * (k - i);
			out[k] = {
				...tokens[k],
				start,
				end: start + Math.max(step, 0.08),
				heard: false,
			};
		}
		i = j;
	}
	return out as LyricWord[];
}

export function alignLyrics(
	sections: SongSection[],
	heard: HeardWord[],
): LyricWord[] {
	const tokens = tokenize(sections);
	const spans = match(
		tokens.map((t) => norm(t.text)),
		spellNumerals(heard),
	);
	const words: (LyricWord | null)[] = tokens.map((t, i) => {
		const span = spans.get(i);
		return span ? { ...t, ...span, heard: true } : null;
	});
	return interpolate(words, tokens);
}
