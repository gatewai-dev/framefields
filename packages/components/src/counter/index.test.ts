import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { counter } from "./index.js";

const make = () => bind(fakeHost(), counter);

describe("Counter", () => {
	it("settles after the count and the place stagger, then stays", () => {
		const c = make()({ to: 999, countDuration: 30, digitStagger: 2 });
		expect(c.cues.settled[0]?.frame).toBe(34);
		expect(c.span.end).toBe(Number.POSITIVE_INFINITY);
	});

	it("is as wide as its widest value, so nothing overflows mid-count", () => {
		// Fake measure: 0.5 em per glyph at 120 px → 60 px digits and separators.
		const c = make()({ to: 1_000_000, fontSize: 120 });
		expect(c.width).toBe(9 * 60);
	});

	it("lays out affixes, separators and decimals", () => {
		const c = make()({ id: "c", to: 1234.5, format: "$,.2f", fontSize: 20 });
		// "$" + 6 digits + "," + "." → 9 glyphs of 10 px.
		expect(c.width).toBe(90);
		expect(c.part("prefix")).toBeDefined();
	});

	it("needs a target value and ascending steps", () => {
		expect(() => make()({})).toThrow(/give `to`/);
		expect(() =>
			make()({
				values: [
					[10, 1],
					[5, 2],
				],
			}),
		).toThrow(/must ascend/);
	});

	it("reports milestones in the parent's timeline", () => {
		const c = make()({
			at: 100,
			to: 30,
			countDuration: 30,
			milestoneEvery: 10,
			ease: "none",
		});
		expect(c.cues.milestones.map((m) => m.value)).toEqual([10, 20, 30]);
		expect(c.cues.milestones[0]?.frame).toBeGreaterThan(100);
	});

	it("lays a formatter function out per character", () => {
		const c = make()({ to: 42, format: (n) => `${Math.round(n)} pts` });
		expect(c.cues.settled).toHaveLength(1);
	});
});
