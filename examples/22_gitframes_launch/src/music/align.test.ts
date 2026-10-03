import { describe, expect, it } from "vitest";
import type { SongSection } from "../song.js";
import { alignLyrics } from "./align.js";

const section = (lines: string[]): SongSection => ({
	name: "s",
	fromBar: 0,
	toBar: 4,
	styles: [],
	avoid: [],
	lines,
});

describe("alignLyrics", () => {
	it("times a word the transcriber split in two", () => {
		const words = alignLyrics(
			[section(["Gitframes! No browser"])],
			[
				{ text: "Get", start: 1, end: 1.2 },
				{ text: "framed!", start: 1.2, end: 1.6 },
				{ text: "No", start: 2, end: 2.1 },
				{ text: "browser", start: 2.1, end: 2.5 },
			],
		);
		expect(words[0]).toMatchObject({
			text: "Gitframes!",
			start: 1,
			end: 1.6,
			heard: true,
		});
		expect(words[2]).toMatchObject({
			text: "browser",
			start: 2.1,
			heard: true,
		});
	});

	it("splits two words the transcriber ran together", () => {
		const words = alignLyrics(
			[section(["frame by frame!"])],
			[
				{ text: "frame", start: 1, end: 1.3 },
				{ text: "byFrame.", start: 1.3, end: 2.3 },
			],
		);
		expect(words.map((w) => w.heard)).toEqual([true, true, true]);
		expect(words[1].start).toBeCloseTo(1.3);
		expect(words[2].start).toBeCloseTo(1.3 + (1 * 2) / 7);
		expect(words[2].end).toBeCloseTo(2.3);
	});
});

describe("alignLyrics numerals and guesses", () => {
	it("times a sung number the transcriber wrote as digits", () => {
		const words = alignLyrics(
			[section(["A hundred twenty frames"])],
			[
				{ text: "120", start: 9.48, end: 9.96 },
				{ text: "frames", start: 10.02, end: 10.2 },
			],
		);
		expect(words.map((w) => w.heard)).toEqual([true, true, true, true]);
		expect(words[0].start).toBeCloseTo(9.48);
		expect(words[2].end).toBeCloseTo(9.96);
	});

	it("never times an unheard word before it could be sung", () => {
		const words = alignLyrics(
			[section(["one two three"])],
			[
				{ text: "one", start: 0, end: 1 },
				{ text: "three", start: 5, end: 5.3 },
			],
		);
		// Sung at the usual pace just before "three", not right after "one".
		expect(words[1].start).toBeGreaterThan(4.5);
		expect(words[1].end).toBeLessThanOrEqual(5);
	});
});
