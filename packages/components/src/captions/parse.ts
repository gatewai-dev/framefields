/**
 * Transcripts to timed words. Word-level JSON keeps its times; cue-level
 * formats (SRT, WebVTT) split each cue into words and share the cue's time
 * between them by length, so longer words are on screen longer.
 */

/** A spoken word, times in seconds. */
export interface Word {
	text: string;
	start: number;
	end: number;
}

/** `01:02:03,456`, `02:03.456` or `3.456` → seconds. */
export function parseTimestamp(value: string): number {
	const parts = value.trim().replace(",", ".").split(":");
	let seconds = 0;
	for (const p of parts) {
		const n = Number(p);
		if (!Number.isFinite(n))
			throw new Error(`Captions: bad timestamp "${value}".`);
		seconds = seconds * 60 + n;
	}
	return seconds;
}

/** Spread a cue's [start, end) over its words, weighted by length. */
export function splitCue(text: string, start: number, end: number): Word[] {
	const tokens = text.split(/\s+/).filter(Boolean);
	const weights = tokens.map((t) => t.length + 1);
	const total = weights.reduce((a, b) => a + b, 0) || 1;
	let t = start;
	return tokens.map((token, i) => {
		const span = ((end - start) * (weights[i] as number)) / total;
		const word = { text: token, start: t, end: t + span };
		t += span;
		return word;
	});
}

const ARROW = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/;

/** SRT or WebVTT cues → words. Markup tags (`<i>`, `<c.x>`, `{\an8}`) are dropped. */
function parseCues(source: string): Word[] {
	const words: Word[] = [];
	const blocks = source.replace(/\r/g, "").split(/\n\s*\n/);
	for (const block of blocks) {
		const lines = block.split("\n");
		const at = lines.findIndex((l) => ARROW.test(l));
		if (at < 0) continue;
		const m = (lines[at] as string).match(ARROW) as RegExpMatchArray;
		const text = lines
			.slice(at + 1)
			.join(" ")
			.replace(/<[^>]+>|\{[^}]*\}/g, "")
			.trim();
		if (text)
			words.push(
				...splitCue(
					text,
					parseTimestamp(m[1] as string),
					parseTimestamp(m[2] as string),
				),
			);
	}
	return words;
}

/** `[{ word | text, start, end }]` (seconds). */
function parseWordJson(source: string): Word[] {
	const data = JSON.parse(source) as unknown;
	const list = Array.isArray(data)
		? data
		: ((data as { words?: unknown[] })?.words ?? []);
	return (list as Array<Record<string, unknown>>).map((w, i) => {
		const text = (w.word ?? w.text) as unknown;
		if (
			typeof text !== "string" ||
			typeof w.start !== "number" ||
			typeof w.end !== "number"
		)
			throw new Error(
				`Captions: word ${i} needs \`word\` (or \`text\`), \`start\` and \`end\`.`,
			);
		return { text: text.trim(), start: w.start, end: w.end };
	});
}

/** Any supported transcript (word JSON, WebVTT or SRT), detected from its content. */
export function parseTranscript(source: string): Word[] {
	const trimmed = source.trim();
	const words =
		trimmed.startsWith("[") || trimmed.startsWith("{")
			? parseWordJson(trimmed)
			: parseCues(trimmed.replace(/^WEBVTT[^\n]*\n/, ""));
	if (words.length === 0)
		throw new Error("Captions: the transcript has no words.");
	return words.filter((w) => w.text.length > 0);
}
