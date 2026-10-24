import { describe, expect, it } from "vitest";
import type { Word } from "./parse.js";
import { buildPhrases, phraseText } from "./phrases.js";

const timed = (text: string, gapAfter: Record<number, number> = {}): Word[] => {
	let t = 0;
	return text.split(" ").map((w, i) => {
		const word = { text: w, start: t, end: t + 0.3 };
		t += 0.3 + (gapAfter[i] ?? 0.05);
		return word;
	});
};
const base = {
	maxChars: 20,
	maxWords: 12,
	maxLines: 2,
	breakOnPunctuation: true,
	minGap: 0.6,
};

describe("phrases", () => {
	it("fill lines up to maxChars without splitting words", () => {
		const words = timed("one two three four five six seven eight");
		const [p] = buildPhrases(words, base);
		expect(phraseText(p as never, words)).toBe(
			"one two three four\nfive six seven eight",
		);
	});

	it("end at sentence ends and long pauses", () => {
		const words = timed("Hello there. Next one comes after pause", { 4: 1 });
		const texts = buildPhrases(words, base).map((p) => phraseText(p, words));
		expect(texts).toEqual(["Hello there.", "Next one comes", "after pause"]);
	});

	it("respect measured width, not just characters", () => {
		const words = timed("wide wide wide wide");
		const [p] = buildPhrases(words, base, (line) => line.length <= 9);
		expect(p?.lines.map((l) => l.length)).toEqual([2, 2]);
	});

	it("stay until the next phrase, never overlapping it", () => {
		const words = timed("a. b", { 0: 0.1 });
		const [first, second] = buildPhrases(words, base);
		expect(first?.end).toBeLessThanOrEqual(second?.start ?? 0);
		expect(second?.end).toBeCloseTo((words[1]?.end ?? 0) + 0.6, 6);
	});
});
