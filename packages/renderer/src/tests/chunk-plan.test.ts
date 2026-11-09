import { describe, expect, it } from "vitest";
import {
	type ChunkPlan,
	planChunks,
	planChunksByBudget,
} from "../chunk-plan.js";

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

describe("planChunksByBudget", () => {
	const covers = (plan: ChunkPlan, total: number) => {
		expect(plan.chunks[0].start).toBe(0);
		expect(plan.chunks.at(-1)?.end).toBe(total);
		for (let i = 1; i < plan.chunks.length; i++)
			expect(plan.chunks[i].start).toBe(plan.chunks[i - 1].end);
	};

	it("keeps each chunk within the render-time budget", () => {
		// A minute at 100 ms a frame: 180 s of work, 20 s chunks.
		const total = 60 * FPS;
		const plan = planChunksByBudget({
			totalFrames: total,
			samples: [{ frame: 0, ms: 100 }],
			chunkSec: 20,
		});
		covers(plan, total);
		expect(plan.chunks).toHaveLength(9);
		for (const c of plan.chunks) expect(c.workSec).toBeLessThanOrEqual(20.01);
		// One device renders them in turn: no overhead, no parallel speed-up.
		expect(plan.workers).toBe(1);
		expect(plan.etaSec).toBeCloseTo(180, 6);
	});

	it("gives a heavy stretch shorter chunks", () => {
		const total = 600;
		const plan = planChunksByBudget({
			totalFrames: total,
			// Cheap first half, ten times the cost in the second.
			samples: [
				{ frame: 0, ms: 10 },
				{ frame: 299, ms: 10 },
				{ frame: 300, ms: 100 },
				{ frame: 599, ms: 100 },
			],
			chunkSec: 6,
		});
		covers(plan, total);
		const first = plan.chunks[0];
		const last = plan.chunks.at(-1) as (typeof plan.chunks)[number];
		expect(first.end - first.start).toBeGreaterThan(last.end - last.start);
	});

	it("splits a chunk over maxChunkFrames evenly", () => {
		// A cheap film fits one chunk by time; the frame cap cuts it.
		const plan = planChunksByBudget({
			totalFrames: 1000,
			samples: [{ frame: 0, ms: 1 }],
			chunkSec: 60,
			maxChunkFrames: 300,
		});
		covers(plan, 1000);
		expect(plan.chunks.map((c) => c.end - c.start)).toEqual([
			250, 250, 250, 250,
		]);
	});

	it("never makes a chunk shorter than minChunkFrames", () => {
		const plan = planChunksByBudget({
			totalFrames: 100,
			samples: [{ frame: 0, ms: 1000 }],
			chunkSec: 1,
			minChunkFrames: 30,
		});
		covers(plan, 100);
		expect(plan.chunks).toHaveLength(3);
		for (const c of plan.chunks)
			expect(c.end - c.start).toBeGreaterThanOrEqual(30);
	});

	it("rejects bad input", () => {
		const samples = [{ frame: 0, ms: 10 }];
		expect(() =>
			planChunksByBudget({ totalFrames: 0, samples, chunkSec: 1 }),
		).toThrow(/totalFrames/);
		expect(() =>
			planChunksByBudget({ totalFrames: 10, samples, chunkSec: 0 }),
		).toThrow(/chunkSec/);
		expect(() =>
			planChunksByBudget({
				totalFrames: 10,
				samples,
				chunkSec: 1,
				maxChunkFrames: 0,
			}),
		).toThrow(/maxChunkFrames/);
	});
});
