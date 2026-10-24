import { describe, expect, it } from "vitest";
import { parseTimestamp, parseTranscript, splitCue } from "./parse.js";

const srt = `1
00:00:01,000 --> 00:00:02,000
Ship it

2
00:00:02,500 --> 00:00:03,000
<i>faster</i>
`;
const vtt = `WEBVTT

00:01.000 --> 00:02.000
Ship it

00:02.500 --> 00:03.000
faster
`;
const json = JSON.stringify([
	{ word: "Ship", start: 1, end: 1.4 },
	{ text: "it", start: 1.4, end: 2 },
	{ word: "faster", start: 2.5, end: 3 },
]);

describe("transcripts", () => {
	it("reads timestamps in any common form", () => {
		expect(parseTimestamp("01:02:03,456")).toBeCloseTo(3723.456, 6);
		expect(parseTimestamp("02:03.5")).toBeCloseTo(123.5, 6);
		expect(() => parseTimestamp("x")).toThrow(/bad timestamp/);
	});

	it("splits a cue's time by word length", () => {
		const words = splitCue("a bbb", 0, 6);
		expect(words.map((w) => w.text)).toEqual(["a", "bbb"]);
		expect(words[0]?.end).toBeCloseTo(2, 6);
		expect(words[1]?.end).toBeCloseTo(6, 6);
	});

	it("SRT, WebVTT and word JSON give the same words", () => {
		const texts = (s: string) => parseTranscript(s).map((w) => w.text);
		expect(texts(srt)).toEqual(["Ship", "it", "faster"]);
		expect(texts(vtt)).toEqual(texts(srt));
		expect(texts(json)).toEqual(texts(srt));
		expect(parseTranscript(srt)[2]).toMatchObject({ start: 2.5, end: 3 });
	});

	it("names the problem in bad JSON", () => {
		expect(() => parseTranscript('[{"word":"x"}]')).toThrow(/needs `word`/);
		expect(() => parseTranscript("nothing here")).toThrow(/no words/);
	});
});
