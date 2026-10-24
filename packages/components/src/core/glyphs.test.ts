import { describe, expect, it } from "vitest";
import { evaluateEase } from "./ease.js";
import {
	constantExpression,
	evaluateGlyphExpression,
	scheduleExpression,
} from "./glyphs.js";

const at = (expression: string, frame: number, textIndex = 0) =>
	evaluateGlyphExpression(expression, {
		frame,
		textIndex,
		wordIndex: textIndex,
	});

describe("glyph schedules", () => {
	const schedule = { starts: [0, 10, 20], duration: 10, ease: "power2.out" };

	it("holds each unit pushed until its start, then eases it to rest", () => {
		const e = scheduleExpression("char", schedule, "enter");
		expect(at(e, 0, 1)).toBe(1);
		expect(at(e, 10, 1)).toBe(1);
		expect(at(e, 15, 1)).toBeCloseTo(1 - evaluateEase("power2.out", 0.5), 4);
		expect(at(e, 20, 1)).toBe(0);
		expect(at(e, 400, 2)).toBe(0);
	});

	it("interpolates between frames (motion-blur sub-samples)", () => {
		const e = scheduleExpression(
			"char",
			{ ...schedule, ease: "none" },
			"enter",
		);
		expect(at(e, 12.5, 1)).toBeCloseTo(0.75, 4);
	});

	it("exits the other way, and scales by per-unit factors", () => {
		const out = scheduleExpression("word", schedule, "exit");
		expect(at(out, 0, 0)).toBe(0);
		expect(at(out, 10, 0)).toBe(1);
		const f = scheduleExpression("word", schedule, "enter", [0.5, -1, 0.25]);
		expect(at(f, 0, 1)).toBe(-1);
		expect(at(f, 0, 2)).toBe(0.25);
	});

	it("never leaves an index without a schedule (renderer counts may differ)", () => {
		const e = scheduleExpression("char", schedule, "enter");
		// Past the table it takes the last unit's schedule.
		expect(at(e, 25, 9)).toBe(at(e, 25, 2));
	});

	it("keeps back-eased overshoot (negative weights)", () => {
		const e = scheduleExpression(
			"char",
			{ starts: [0], duration: 20, ease: "back.out(1.7)" },
			"enter",
		);
		const min = Math.min(...Array.from({ length: 21 }, (_, f) => at(e, f)));
		expect(min).toBeLessThan(0);
	});

	it("constant weights for emphasis", () => {
		const e = constantExpression("char", [0, 1, 1, 0]);
		expect([0, 1, 2, 3, 7].map((i) => at(e, 0, i))).toEqual([0, 1, 1, 0, 0]);
	});
});
