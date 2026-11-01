import { describe, expect, it } from "vitest";
import { type ChunkPlan, planChunks } from "../chunk-plan.js";

const FPS = 30;
/** Renders as fast as it plays: 33.3 ms per frame. */
const realtime = [{ frame: 0, ms: 1000 / FPS }];

function expectCovers(plan: ChunkPlan, total: number) {
	expect(plan.chunks[0].start).toBe(0);
	expect(plan.chunks.at(-1)?.end).toBe(total);
	for (let i = 1; i < plan.chunks.length; i++)
		expect(plan.chunks[i].start).toBe(plan.chunks[i - 1].end);
	expect(plan.chunks).toHaveLength(plan.workers);
}

describe("planChunks", () => {
	it("keeps one worker by default", () => {
		const total = 3 * 3600 * FPS;
		const plan = planChunks({ totalFrames: total, samples: realtime });
		expect(plan.workers).toBe(1);
		expectCovers(plan, total);
		expect(plan.workSec).toBeCloseTo(3 * 3600, 0);
	});

	it("auto: a five-minute film stays on one worker", () => {
		const plan = planChunks({
			totalFrames: 5 * 60 * FPS,
			samples: realtime,
			workers: "auto",
		});
		expect(plan.workers).toBe(1);
	});

	it("auto: a three-hour film spreads to maxWorkers", () => {
		const total = 3 * 3600 * FPS;
		const plan = planChunks({
			totalFrames: total,
			samples: realtime,
			workers: "auto",
		});
		// 10 800 s of work over chunks of at least 510 s would be 21; capped at 10.
		expect(plan.workers).toBe(10);
		expectCovers(plan, total);
		expect(plan.etaSec).toBeCloseTo(90 + 1080, 0);
	});

	it("auto: adds workers only while each chunk stays efficient", () => {
		// 30 min of work; 510 s minimum per chunk at 85% → 3 workers.
		const plan = planChunks({
			totalFrames: 30 * 60 * FPS,
			samples: realtime,
			workers: "auto",
			maxWorkers: 50,
		});
		expect(plan.workers).toBe(3);
		for (const chunk of plan.chunks)
			expect(90 / (90 + chunk.workSec)).toBeLessThanOrEqual(0.15 + 1e-9);
	});

	it("cuts at equal cost, so a heavy stretch gets a shorter chunk", () => {
		const total = 1000;
		const plan = planChunks({
			totalFrames: total,
			samples: [
				{ frame: 0, ms: 10 },
				{ frame: 499, ms: 10 },
				{ frame: 500, ms: 30 },
				{ frame: 999, ms: 30 },
			],
			workers: 2,
			minChunkFrames: 1,
		});
		expectCovers(plan, total);
		// Half the cost (10 s of 20 s) is reached at frame ~667.
		expect(plan.chunks[0].end).toBeGreaterThan(650);
		expect(plan.chunks[0].end).toBeLessThan(680);
		expect(plan.chunks[0].workSec).toBeCloseTo(plan.chunks[1].workSec, 0);
	});

	it("never makes a chunk shorter than minChunkFrames", () => {
		const plan = planChunks({
			totalFrames: 250,
			samples: [
				{ frame: 0, ms: 1000 },
				{ frame: 10, ms: 1 },
			],
			workers: 4,
			minChunkFrames: 60,
		});
		expect(plan.workers).toBe(4);
		expectCovers(plan, 250);
		for (const chunk of plan.chunks)
			expect(chunk.end - chunk.start).toBeGreaterThanOrEqual(60);
	});

	it("never plans more chunks than frames allow", () => {
		const plan = planChunks({ totalFrames: 90, samples: realtime, workers: 8 });
		expect(plan.workers).toBe(1);
	});

	it("rejects bad input", () => {
		expect(() => planChunks({ totalFrames: 0, samples: realtime })).toThrow(
			/totalFrames/,
		);
		expect(() => planChunks({ totalFrames: 100, samples: [] })).toThrow(
			/sample/,
		);
		expect(() =>
			planChunks({ totalFrames: 100, samples: realtime, workers: 0 }),
		).toThrow(/workers/);
		expect(() =>
			planChunks({
				totalFrames: 100,
				samples: realtime,
				workers: "auto",
				efficiency: 1,
			}),
		).toThrow(/efficiency/);
	});
});
