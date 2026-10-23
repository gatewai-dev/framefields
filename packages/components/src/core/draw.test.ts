import { describe, expect, it } from "vitest";
import {
	arrowPaths,
	boilKeys,
	boxPath,
	drawOnKeys,
	ellipsePath,
	linePath,
	squigglePath,
	wobblePoints,
} from "./draw.js";

const rect = { x: 100, y: 100, width: 200, height: 60 };

describe("draw", () => {
	it("keys a draw-on", () => {
		expect(drawOnKeys(10, 12)).toEqual([
			[10, 0],
			[22, 1, "power2.inOut"],
		]);
	});

	it("is clean without wobble and seeded with it", () => {
		expect(linePath([0, 0], [100, 0])).toBe("M0 0 L100 0");
		const a = ellipsePath(rect, { wobble: 3, seed: 4 });
		expect(ellipsePath(rect, { wobble: 3, seed: 4 })).toBe(a);
		expect(ellipsePath(rect, { wobble: 3, seed: 5 })).not.toBe(a);
		expect(ellipsePath(rect, { wobble: 3, seed: 4 }, 1)).not.toBe(a);
	});

	it("wobbles smoothly within the amount", () => {
		const pts = Array.from(
			{ length: 40 },
			(_, i) => [i * 10, 0] as [number, number],
		);
		const w = wobblePoints(pts, { wobble: 4, seed: 2 });
		for (let i = 0; i < pts.length; i++) {
			expect(Math.abs(w[i]![1])).toBeLessThanOrEqual(4);
			if (i > 0) expect(Math.abs(w[i]![1] - w[i - 1]![1])).toBeLessThan(2);
		}
	});

	it("frames rects with padding", () => {
		expect(boxPath(rect, { padding: 10 })).toBe(
			"M90 90 L310 90 L310 170 L90 170 Z",
		);
		expect(ellipsePath(rect)).toMatch(/^M300 130/);
	});

	it("builds arrows whose head meets the tip", () => {
		const { shaft, head } = arrowPaths([0, 0], [200, 100], { curve: "arc" });
		expect(shaft.startsWith("M0 0")).toBe(true);
		expect(shaft.endsWith("L200 100")).toBe(true);
		expect(head).toContain("200 100");
		expect(squigglePath([0, 0], [120, 0], { amplitude: 5 })).toMatch(/^M0 0/);
	});

	it("boils between poses with hold keys", () => {
		const keys = boilKeys((v) => `pose-${v}`, {
			start: 0,
			end: 12,
			every: 4,
			variants: 3,
		});
		expect(keys).toEqual([
			[0, "pose-0", "hold"],
			[4, "pose-1", "hold"],
			[8, "pose-2", "hold"],
			[12, "pose-0", "hold"],
		]);
		expect(boilKeys((v) => `p${v}`, { start: 5, end: 50, every: 0 })).toEqual([
			[5, "p0"],
		]);
	});
});
