import { describe, expect, it } from "vitest";
import { ease, evaluateEase } from "./ease.js";

describe("ease", () => {
	it("hits the endpoints for every base and direction", () => {
		for (const base of [
			"none",
			"power1",
			"power2",
			"power3",
			"sine",
			"circ",
			"expo",
			"back",
			"elastic",
			"bounce",
			"cubic",
		]) {
			for (const dir of ["in", "out", "inOut"]) {
				const f = ease(`${base}.${dir}`);
				expect(f(0)).toBeCloseTo(0, 5);
				expect(f(1)).toBeCloseTo(1, 5);
			}
		}
	});

	it("matches known values", () => {
		expect(evaluateEase("power2.out", 0.5)).toBeCloseTo(0.875, 6);
		expect(evaluateEase("power2.in", 0.5)).toBeCloseTo(0.125, 6);
		expect(evaluateEase("linear", 0.3)).toBeCloseTo(0.3, 6);
		expect(evaluateEase(undefined, 0.3)).toBeCloseTo(0.3, 6);
	});

	it("overshoots for back.out and holds for hold", () => {
		const back = ease("back.out(1.7)");
		const peak = Math.max(
			...Array.from({ length: 101 }, (_, i) => back(i / 100)),
		);
		expect(peak).toBeGreaterThan(1.05);
		expect(evaluateEase("hold", 0.99)).toBe(0);
		expect(evaluateEase("hold", 1)).toBe(1);
	});

	it("rejects names the keyframe schema doesn't accept", () => {
		expect(() => ease("power4.out")).toThrow(/Unknown ease/);
		expect(() => ease("power2.sideways")).toThrow(/direction/);
	});
});
