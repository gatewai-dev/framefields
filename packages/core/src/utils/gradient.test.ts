import { describe, expect, it } from "vitest";
import {
	Gradient,
	isCssGradient,
	limitGradientStops,
	parseCssGradient,
} from "./gradient.js";

const offsets = (s: string) =>
	parseCssGradient(s)?.stops.map((x) => +x.offset.toFixed(3));

describe("parseCssGradient", () => {
	it("parses linear angles, sides and stop positions", () => {
		expect(parseCssGradient("linear-gradient(#000, #fff)")?.angle).toBe(180);
		expect(
			parseCssGradient("linear-gradient(to right, #000, #fff)")?.angle,
		).toBe(90);
		expect(
			parseCssGradient("linear-gradient(to top left, red, blue)")?.angle,
		).toBe(315);
		expect(
			parseCssGradient("linear-gradient(0.25turn, red, blue)")?.angle,
		).toBe(90);
		expect(offsets("linear-gradient(45deg, red, lime 30%, blue)")).toEqual([
			0, 0.3, 1,
		]);
		expect(offsets("linear-gradient(red, lime, blue, white)")).toEqual([
			0, 0.333, 0.667, 1,
		]);
		// Two-position stops make a hard band; later stops never go backwards.
		expect(offsets("linear-gradient(red 20%, blue 10% 40%)")).toEqual([
			0.2, 0.2, 0.4,
		]);
		// Unitless 0 is a valid position: hard-edged bands.
		expect(offsets("linear-gradient(red 0 50%, blue 0)")).toEqual([
			0, 0.5, 0.5,
		]);
	});

	it("parses colors with functional syntax inside stops", () => {
		const g = parseCssGradient(
			"linear-gradient(90deg, rgb(255 0 0 / 50%), hsl(240 100% 50%) 80%)",
		);
		expect(g?.stops).toHaveLength(2);
		expect(g?.stops[0].color[3]).toBeCloseTo(0.5, 2);
		expect(g?.stops[1].color[2]).toBeCloseTo(1, 2);
	});

	it("parses radial and conic configuration", () => {
		const r = parseCssGradient(
			"radial-gradient(circle at 25% 75%, #fff, transparent)",
		);
		expect(r?.type).toBe("radial");
		expect(r?.shape).toBe("circle");
		expect(r?.center).toEqual([0.25, 0.75]);
		expect(
			parseCssGradient("radial-gradient(120px at center, red, blue)")?.radius,
		).toEqual([120, 120]);
		const c = parseCssGradient(
			"conic-gradient(from 90deg at left top, red, blue 0.5turn)",
		);
		expect(c?.from).toBe(90);
		expect(c?.center).toEqual([0, 0]);
		expect(c?.stops[1].offset).toBeCloseTo(0.5);
		// The size keyword is kept: closest-side lands the last stop on the box's edge.
		expect(
			parseCssGradient("radial-gradient(closest-side, #fff 40%, transparent)")
				?.extent,
		).toBe("closest-side");
		expect(
			parseCssGradient(
				"radial-gradient(circle farthest-side at 10% 10%, red, blue)",
			),
		).toMatchObject({ shape: "circle", extent: "farthest-side" });
		// No config: the first part is a stop.
		expect(parseCssGradient("radial-gradient(red, blue)")?.stops).toHaveLength(
			2,
		);
	});

	it("rejects non-gradients and bad colors", () => {
		expect(parseCssGradient("#ff0000")).toBeNull();
		expect(
			parseCssGradient("linear-gradient(to right, nope, #fff)"),
		).toBeNull();
		expect(isCssGradient("conic-gradient(red, blue)")).toBe(true);
		expect(isCssGradient("red")).toBe(false);
	});

	it("resamples long stop lists to the GPU limit", () => {
		const g = parseCssGradient(
			`linear-gradient(${Array.from({ length: 12 }, (_, i) => (i % 2 ? "#000" : "#fff")).join(", ")})`,
		)!;
		const lim = limitGradientStops(g.stops);
		expect(lim).toHaveLength(8);
		expect(lim[0].offset).toBe(0);
		expect(lim[7].offset).toBe(1);
	});
});

describe("Gradient helpers", () => {
	it("write strings the parser reads back", () => {
		const lin = parseCssGradient(
			Gradient.linear(["#f00", { color: "#00f", offset: 0.6 }], 135),
		)!;
		expect(lin.angle).toBe(135);
		expect(lin.stops[1].offset).toBeCloseTo(0.6);
		const rad = parseCssGradient(
			Gradient.radial(["#fff", "#000"], { at: [0.2, 0.3], circle: true }),
		)!;
		expect(rad.center[0]).toBeCloseTo(0.2);
		expect(rad.shape).toBe("circle");
		const con = parseCssGradient(
			Gradient.conic(["red", "blue"], { from: 45 }),
		)!;
		expect(con.type).toBe("conic");
		expect(con.from).toBe(45);
	});
});
