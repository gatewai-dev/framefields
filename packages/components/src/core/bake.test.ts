import { describe, expect, it } from "vitest";
import {
	bakeFunction,
	bakeSamples,
	springAt,
	springSettleFrames,
} from "./bake.js";

const lerpKeys = (keys: [number, number][], f: number) => {
	for (let i = 0; i < keys.length - 1; i++) {
		const [f0, v0] = keys[i]!;
		const [f1, v1] = keys[i + 1]!;
		if (f >= f0 && f <= f1) return v0 + ((v1 - v0) * (f - f0)) / (f1 - f0);
	}
	return keys[keys.length - 1]![1];
};

describe("bake", () => {
	it("collapses lines to their endpoints", () => {
		expect(bakeSamples([0, 1, 2, 3, 4], 10)).toEqual([
			[10, 0],
			[14, 4],
		]);
	});

	it("keeps every sample within tolerance", () => {
		const fn = (f: number) => Math.sin(f / 30) * 20;
		const keys = bakeFunction(fn, 0, 120, { tolerance: 0.5 });
		expect(keys.length).toBeLessThan(30);
		for (let f = 0; f <= 120; f++) {
			expect(Math.abs(lerpKeys(keys, f) - fn(f))).toBeLessThanOrEqual(
				0.5 + 1e-9,
			);
		}
		for (const [frame] of keys) expect(Number.isInteger(frame)).toBe(true);
	});

	it("evaluates springs in closed form", () => {
		expect(springAt(0)).toBe(0);
		expect(springAt(5)).toBeCloseTo(1, 4);
		const bouncy = Array.from({ length: 60 }, (_, f) =>
			springAt(f / 30, { stiffness: 200, damping: 8 }),
		);
		expect(Math.max(...bouncy)).toBeGreaterThan(1.2);
		expect(springAt(0.3, { damping: 28.28 })).toBeLessThan(1); // ~critical: no overshoot
		const over = Array.from({ length: 90 }, (_, f) =>
			springAt(f / 30, { damping: 80 }),
		);
		expect(Math.max(...over)).toBeLessThanOrEqual(1);
		expect(springSettleFrames(30)).toBeGreaterThan(10);
		expect(springSettleFrames(30)).toBeLessThan(60);
	});
});
