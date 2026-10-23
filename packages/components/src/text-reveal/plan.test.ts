import { describe, expect, it } from "vitest";
import { rng } from "../core/rng.js";
import { fakeMeasure } from "../test/fake-host.js";
import {
	burstStarts,
	indexedStarts,
	scrambleSet,
	typingFrames,
	unitsOf,
} from "./plan.js";

const m = (text: string, width?: number) =>
	fakeMeasure(text, { fontFamily: "Inter", fontSize: 20, width });

describe("TextReveal units", () => {
	it("splits by character (skipping spaces), word and measured line", () => {
		const text = "ab cd ef";
		expect(
			unitsOf(text, "char", m(text))
				.map((u) => u.text)
				.join(""),
		).toBe("abcdef");
		expect(unitsOf(text, "word", m(text)).map((u) => u.text)).toEqual([
			"ab",
			"cd",
			"ef",
		]);
		// 10 px per glyph: 50 px fits "ab cd", then wraps.
		expect(unitsOf(text, "line", m(text, 50)).map((u) => u.text)).toEqual([
			"ab cd",
			"ef",
		]);
	});

	it("indexes a character schedule by string position; spaces take the next unit's start", () => {
		const text = "ab cd";
		const units = unitsOf(text, "char", m(text));
		expect(indexedStarts(text, "char", units, [0, 1, 2, 3])).toEqual([
			0, 1, 2, 2, 3,
		]);
		expect(
			indexedStarts(text, "word", unitsOf(text, "word", m(text)), [0, 5]),
		).toEqual([0, 5]);
	});
});

describe("typing rhythm", () => {
	it("is seeded, strictly increasing, and pauses after punctuation", () => {
		const text = "Hi. Go now";
		const a = typingFrames(text, 20, 30, rng(3));
		expect(typingFrames(text, 20, 30, rng(3))).toEqual(a);
		expect(typingFrames(text, 20, 30, rng(4))).not.toEqual(a);
		for (let i = 1; i < a.length; i++)
			expect(a[i]).toBeGreaterThan(a[i - 1] as number);
		const gap = (i: number) => (a[i] as number) - (a[i - 1] as number);
		// The keystroke after "." waits much longer than one inside a word.
		expect(gap(3)).toBeGreaterThan(gap(1) * 2);
	});
});

describe("streaming bursts", () => {
	it("gives every word a start, ascending, with uneven gaps", () => {
		const starts = burstStarts(12, 6, 1, rng(1));
		expect(starts).toHaveLength(12);
		for (let i = 1; i < starts.length; i++)
			expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1] as number);
		const gaps = new Set(
			starts.slice(1).map((s, i) => s - (starts[i] as number)),
		);
		expect(gaps.size).toBeGreaterThan(2);
	});
});

describe("scramble glyphs", () => {
	it("keep the character's case or class", () => {
		expect(scrambleSet("A")).toMatch(/^ABC/);
		expect(scrambleSet("q")).toMatch(/^abc/);
		expect(scrambleSet("7")).toMatch(/^0123/);
	});
});
