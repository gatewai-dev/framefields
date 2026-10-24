import { describe, expect, it } from "vitest";
import {
	MAX_TURNS,
	milestones,
	numberLayout,
	placesOf,
	reelPositions,
	valueAt,
} from "./plan.js";

describe("number layouts", () => {
	it("reads d3-style strings", () => {
		expect(numberLayout(",d")).toMatchObject({
			decimals: 0,
			group: ",",
			prefix: "",
			suffix: "",
			scale: 1,
		});
		expect(numberLayout("$,.2f")).toMatchObject({
			decimals: 2,
			group: ",",
			prefix: "$",
		});
		expect(numberLayout(".1%")).toMatchObject({
			decimals: 1,
			group: null,
			suffix: "%",
			scale: 100,
		});
		expect(() => numberLayout("x")).toThrow(/unsupported format/);
	});

	it("reads Intl options, locale separators and affixes included", () => {
		const eur = numberLayout({ style: "currency", currency: "EUR" }, "de-DE");
		expect(eur).toMatchObject({ decimals: 2, group: ".", decimalMark: "," });
		expect(eur?.suffix.trim()).toBe("€");
		expect(numberLayout((n) => String(n))).toBeNull();
	});
});

describe("value trajectory", () => {
	it("eases between keys and holds the ends", () => {
		const keys = [
			[10, 0],
			[20, 100, "none"],
		] as const;
		expect(valueAt(keys, 0, "none")).toBe(0);
		expect(valueAt(keys, 15, "none")).toBe(50);
		expect(valueAt(keys, 99, "none")).toBe(100);
		expect(placesOf(1_000_000, 0)).toBe(7);
		expect(placesOf(5, 2)).toBe(3);
	});
});

describe("digit reels", () => {
	const o = { scale: 1, stagger: 0, ease: "none", length: 30 };

	it("land every place on its final digit", () => {
		const keys = [
			[0, 120],
			[30, 87],
		] as const;
		const units = reelPositions(keys, 0, o);
		const tens = reelPositions(keys, 1, o);
		expect((((units[30] as number) % 10) + 10) % 10).toBe(7);
		expect((((tens[30] as number) % 10) + 10) % 10).toBe(8);
	});

	it("spin downward when the value falls", () => {
		const units = reelPositions(
			[
				[0, 120],
				[30, 87],
			],
			0,
			o,
		);
		for (let f = 1; f <= 30; f++)
			expect(units[f]).toBeLessThanOrEqual(units[f - 1] as number);
	});

	it("cap long spins without changing where they land", () => {
		const units = reelPositions(
			[
				[0, 0],
				[30, 1_000_007],
			],
			0,
			o,
		);
		expect(units[30]).toBe(MAX_TURNS * 10 + 7);
	});

	it("settle higher places later", () => {
		const late = reelPositions(
			[
				[0, 0],
				[30, 99],
			],
			1,
			{ ...o, stagger: 4, length: 40 },
		);
		expect(late[30]).toBeLessThan(9);
		expect(late[34]).toBe(9);
	});
});

describe("milestones", () => {
	it("fire once per multiple crossed, both ways", () => {
		expect(milestones([0, 5, 12, 25], 10)).toEqual([
			{ frame: 2, value: 10 },
			{ frame: 3, value: 20 },
		]);
		expect(milestones([25, 15], 10)).toEqual([{ frame: 1, value: 20 }]);
	});
});
