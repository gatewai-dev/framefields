import { describe, expect, it } from "vitest";
import { parseColor, premultiplyColor } from "./color.js";

describe("parseColor", () => {
	it("returns transparent black for null/undefined", () => {
		expect(parseColor(null)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
		expect(parseColor(undefined)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
	});

	it("passes through Color objects unchanged", () => {
		const c = { r: 0.5, g: 0.3, b: 0.1, a: 0.8 };
		expect(parseColor(c)).toBe(c);
	});

	// ─── Hex ───────────────────────────────────────────────────────────

	it("parses 3-char hex", () => {
		expect(parseColor("#f00")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
	});

	it("parses 4-char hex (with alpha)", () => {
		const c = parseColor("#f008");
		expect(c.r).toBe(1);
		expect(c.g).toBe(0);
		expect(c.b).toBe(0);
		expect(c.a).toBeCloseTo(0x88 / 255, 5);
	});

	it("parses 6-char hex", () => {
		expect(parseColor("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
		expect(parseColor("#ffffff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
	});

	it("parses 8-char hex (with alpha)", () => {
		expect(parseColor("#000000ff")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
		expect(parseColor("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
		const half = parseColor("#ffffff80");
		expect(half.r).toBe(1);
		expect(half.a).toBeCloseTo(0x80 / 255, 5);
	});

	// ─── rgb(a) ────────────────────────────────────────────────────────

	it("parses rgb()", () => {
		expect(parseColor("rgb(255, 0, 128)")).toEqual({
			r: 1,
			g: 0,
			b: 128 / 255,
			a: 1,
		});
	});

	it("parses rgba()", () => {
		expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual({
			r: 0,
			g: 0,
			b: 0,
			a: 0.5,
		});
	});

	// ─── Named ─────────────────────────────────────────────────────────

	it("parses named colors", () => {
		expect(parseColor("black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
		expect(parseColor("white")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
		expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
	});

	it("is case-insensitive for named colors", () => {
		expect(parseColor("BLACK")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
		expect(parseColor("White")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
	});

	// ─── Edge cases ────────────────────────────────────────────────────

	it("returns transparent black for unrecognised strings", () => {
		expect(parseColor("not-a-color")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
	});

	it("handles whitespace around hex", () => {
		expect(parseColor("  #ff0000  ")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
	});
});

describe("premultiplyColor", () => {
	it("multiplies RGB components by alpha", () => {
		expect(premultiplyColor({ r: 1, g: 0.5, b: 0.2, a: 0.5 })).toEqual({
			r: 0.5,
			g: 0.25,
			b: 0.1,
			a: 0.5,
		});
	});

	it("zeroes RGB components when alpha is 0", () => {
		const parsed = parseColor("#32323200");
		expect(premultiplyColor(parsed)).toEqual({
			r: 0,
			g: 0,
			b: 0,
			a: 0,
		});
	});
});
