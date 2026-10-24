import { parseCssGradient } from "@framefields/core";
import { describe, expect, it } from "vitest";
import { radialExtent } from "./gradient-uniforms.js";

const g = (css: string) => {
	const parsed = parseCssGradient(css);
	if (!parsed) throw new Error(`not a gradient: ${css}`);
	return parsed;
};

describe("radialExtent", () => {
	// Centre 30 px from the left, 70 from the right, 10 from the top, 40 from the bottom.
	const at = [30, 70, 10, 40] as const;

	it("closest-side reaches the nearest edge on each axis", () => {
		expect(
			radialExtent(g("radial-gradient(closest-side, red, blue)"), ...at),
		).toEqual([30, 10]);
		expect(
			radialExtent(g("radial-gradient(circle closest-side, red, blue)"), ...at),
		).toEqual([10, 10]);
	});

	it("farthest-side reaches the far edge on each axis", () => {
		expect(
			radialExtent(g("radial-gradient(farthest-side, red, blue)"), ...at),
		).toEqual([70, 40]);
		expect(
			radialExtent(
				g("radial-gradient(circle farthest-side, red, blue)"),
				...at,
			),
		).toEqual([70, 70]);
	});

	it("corners pass through the corner; farthest-corner is the default", () => {
		const [cx, cy] = radialExtent(
			g("radial-gradient(closest-corner, red, blue)"),
			...at,
		);
		expect(cx).toBeCloseTo(30 * Math.SQRT2);
		expect(cy).toBeCloseTo(10 * Math.SQRT2);
		expect(
			radialExtent(
				g("radial-gradient(circle farthest-corner, red, blue)"),
				...at,
			)[0],
		).toBeCloseTo(Math.hypot(70, 40));
		expect(radialExtent(g("radial-gradient(red, blue)"), ...at)).toEqual(
			radialExtent(g("radial-gradient(farthest-corner, red, blue)"), ...at),
		);
	});
});
