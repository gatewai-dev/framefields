import { describe, expect, it } from "vitest";
import { Track } from "../core/keys.js";
import { diffLines, expandTabs, focusSet } from "./plan.js";

describe("CodeBlock plan", () => {
	it("keeps the longest common run of lines, ignoring indentation", () => {
		const d = diffLines(["a", "b", "c", "d"], ["a", "  c", "x", "d"]);
		expect(d.kept).toEqual([
			[0, 0],
			[2, 1],
			[3, 3],
		]);
		expect(d.removed).toEqual([1]);
		expect(d.added).toEqual([2]);
	});

	it("reads focus lines as a list or a range, 1-based, inside the code", () => {
		expect([...focusSet([1, 3], 5)]).toEqual([0, 2]);
		expect([...focusSet({ from: 2, to: 4 }, 5)]).toEqual([1, 2, 3]);
		expect([...focusSet([9], 5)]).toEqual([]);
		expect(expandTabs("\tx", 2)).toBe("  x");
	});

	it("builds ascending tracks from transitions", () => {
		const keys = new Track(1).to(10, 16, 0.3).to(30, 30, 1).keys();
		expect(keys).toEqual([
			[0, 1],
			[10, 1],
			[16, 0.3, "power2.out"],
			[30, 1, "hold"],
		]);
	});
});
