import { describe, expect, it } from "vitest";
import {
	contrastRatio,
	inkOn,
	isLight,
	mix,
	parseColor,
	transparent,
	withAlpha,
} from "./color.js";

describe("color", () => {
	it("parses hex, rgb() and names", () => {
		expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
		expect(parseColor("#11223380")).toEqual([17, 34, 51, 128 / 255]);
		expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30, 1]);
		expect(parseColor("rgba(10,20,30,0.5)")).toEqual([10, 20, 30, 0.5]);
		expect(parseColor("rgb(10 20 30 / 50%)")).toEqual([10, 20, 30, 0.5]);
		expect(parseColor("white")).toEqual([255, 255, 255, 1]);
		expect(parseColor("oklch(0.7 0.1 200)")).toBeNull();
	});

	it("fades and mixes, passing unknown formats through", () => {
		expect(withAlpha("#5b8cff", 0.2)).toBe("rgba(91,140,255,0.2)");
		expect(withAlpha("var(--x)", 0.2)).toBe("var(--x)");
		expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
		expect(mix("oklch(1 0 0)", "#fff", 0.5)).toBe("oklch(1 0 0)");
	});

	it("keeps the hue when fading rgb() to transparent", () => {
		expect(transparent("rgb(255, 0, 0)")).toBe("rgba(255,0,0,0)");
		expect(transparent("#00f")).toBe("rgba(0,0,255,0)");
		expect(transparent("oklch(1 0 0)")).toBe("rgba(0,0,0,0)");
	});

	it("judges lightness and picks readable ink", () => {
		expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
		expect(isLight("#f4f1ea")).toBe(true);
		expect(isLight("#0d0e11")).toBe(false);
		expect(inkOn("#ffd23f")).toBe("#0b0c0e");
		expect(inkOn("#1f5fe0")).toBe("#ffffff");
	});
});
