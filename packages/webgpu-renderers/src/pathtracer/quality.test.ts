import { describe, expect, it } from "vitest";
import { buildEnvImportance, proceduralSkyImage } from "./env-importance.js";
import {
	dispatchTiles,
	MAX_PIXELS_PER_DISPATCH,
	PreviewBudget,
	resolvePathTrace,
} from "./quality.js";

describe("path trace quality", () => {
	it("resolves presets and lets options override them", () => {
		expect(resolvePathTrace(true)).toMatchObject({
			samples: 128,
			bounces: 8,
			denoise: true,
		});
		expect(resolvePathTrace({ quality: "reference" })).toMatchObject({
			samples: 1024,
			denoise: false,
			clamp: 0,
		});
		expect(resolvePathTrace({ quality: "draft" }).transmissionBounces).toBe(8);
		expect(
			resolvePathTrace({ transmissionBounces: 4 }).transmissionBounces,
		).toBe(4);
		expect(() => resolvePathTrace({ transmissionBounces: 0 })).toThrow(
			/transmissionBounces/,
		);
		const custom = resolvePathTrace({
			quality: "draft",
			samples: 3,
			bounces: 1,
		});
		expect(custom).toMatchObject({ samples: 3, bounces: 1, rouletteDepth: 1 });
		expect(() => resolvePathTrace({ samples: 0 })).toThrow(/samples/);
		expect(() => resolvePathTrace({ bounces: -1 })).toThrow(/bounces/);
	});

	it("cuts a frame into dispatches no larger than the cap, covering every pixel once", () => {
		for (const [w, h] of [
			[1920, 1080],
			[3840, 2160],
			[7, 3],
			[600_000, 1],
		]) {
			const tiles = dispatchTiles(w, h);
			let covered = 0;
			for (const t of tiles) {
				expect(t.w * t.h).toBeLessThanOrEqual(MAX_PIXELS_PER_DISPATCH);
				covered += t.w * t.h;
			}
			expect(covered).toBe(w * h);
		}
	});

	it("fits interactive frames to the measured GPU cost", () => {
		const budget = new PreviewBudget();
		const settings = resolvePathTrace({ quality: "high", previewBudgetMs: 30 });
		// Unmeasured: one cheap sample at half resolution.
		expect(budget.plan(1920, 1080, settings)).toEqual({
			samples: 1,
			scale: 0.5,
		});
		// A fast GPU: 1 ms per sample per megapixel -> ~14 samples fit at 1080p.
		budget.record(2.07, 0, 1, 1920 * 1080);
		expect(budget.plan(1920, 1080, settings)).toEqual({
			samples: 14,
			scale: 1,
		});
		// A slow GPU: 120 ms per sample at 1080p -> one sample at half scale.
		const slow = new PreviewBudget();
		slow.record(100, 20, 1, 1920 * 1080);
		const plan = slow.plan(1920, 1080, settings);
		expect(plan.samples).toBe(1);
		expect(plan.scale).toBeCloseTo(0.5, 2);
	});
});

describe("environment importance", () => {
	it("is a normalized distribution that favours the softboxes", () => {
		const image = proceduralSkyImage({
			top: [0.2, 0.2, 0.2],
			horizon: [0.1, 0.1, 0.1],
			bottom: [0.02, 0.02, 0.02],
			softboxes: 4,
		});
		const table = buildEnvImportance(image);
		const [w, h] = [table[0], table[1]];
		const marginal = table.subarray(4, 4 + h + 1);
		expect(marginal[0]).toBe(0);
		expect(marginal[h]).toBeCloseTo(1, 5);
		for (let y = 0; y < h; y++) {
			const row = table.subarray(
				4 + h + 1 + y * (w + 1),
				4 + h + 1 + (y + 1) * (w + 1),
			);
			expect(row[w]).toBeCloseTo(1, 5);
		}
		// The key softbox sits above the horizon: the upper half holds most of the light.
		expect(marginal[h / 2]).toBeGreaterThan(0.5);
	});
});
