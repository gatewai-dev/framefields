import { describe, expect, it } from "vitest";
import { VisionRunner } from "../runner/vision-runner.js";
import type {
	SessionProvider,
	VisionSession,
	VisionTensorOutputs,
} from "../runtime/session-provider.js";
import {
	fakeStore,
	rtmdetInsOutput,
	rtmoOutput,
	ScriptedProvider,
} from "../test-support.js";
import type { VisionImageInput } from "../types.js";
import { analyzeSequence } from "./analyze-sequence.js";

/** RTMDet-Ins session whose single person moves right by 10px on every call. */
class MovingProvider implements SessionProvider {
	public readonly kind = "node" as const;
	async createSession(): Promise<VisionSession> {
		let step = 0;
		return {
			run: async (): Promise<VisionTensorOutputs> => {
				const out = rtmdetInsOutput();
				const dets = out.dets.data as Float32Array;
				dets[0] += step * 10;
				dets[2] += step * 10;
				step++;
				return out;
			},
			release: () => {},
		};
	}
}

async function* frames(count: number): AsyncIterable<VisionImageInput> {
	for (let i = 0; i < count; i++) {
		yield {
			data: new Uint8ClampedArray(640 * 640 * 4).fill(128),
			width: 640,
			height: 640,
		};
	}
}

describe("analyzeSequence", () => {
	it("produces a deterministic, zod-valid report for a moving object", async () => {
		const { store } = fakeStore();
		const runner = VisionRunner.create({
			store,
			provider: new MovingProvider(),
		});
		const report = await analyzeSequence(frames(12), {
			runner,
			source: "clip.mp4",
			fps: 24,
			tasks: ["detect"],
		});

		expect(report.source).toBe("clip.mp4");
		expect(report.totalFrames).toBe(12);
		expect(report.durationSec).toBeCloseTo(0.5, 6);
		expect(report.tasks).toEqual(["detect"]);
		expect(Object.keys(report.modelDownloads)).toEqual(["rtmdet-ins-s"]);
		expect(report.modelDownloads["rtmdet-ins-s"].bytes).toBeGreaterThan(0);
		expect(report.inferenceMs).toBeGreaterThanOrEqual(0);

		expect(report.trackCount).toBe(1);
		expect(report.classes.person).toMatchObject({
			framesPresent: 12,
			totalFrames: 12,
			tracks: 1,
		});
		expect(report.classes.person.maxConfidence).toBeCloseTo(0.9, 5);

		const track = report.tracks[0];
		expect(track.category).toBe("person");
		expect(track.frames).toEqual([0, 11]);
		expect(track.centerPath.length).toBeGreaterThan(0);
		expect(track.speedMeanPxS).toBeGreaterThan(0);

		// zod round-trip
		const { VisionAnalysisReportSchema } = await import("../schemas.js");
		expect(VisionAnalysisReportSchema.safeParse(report).success).toBe(true);
		runner.close();
	});

	it("runs only the requested tasks' models", async () => {
		const { store, fetches } = fakeStore();
		const runner = VisionRunner.create({
			store,
			provider: new ScriptedProvider([rtmoOutput()]),
		});
		const report = await analyzeSequence(frames(3), {
			runner,
			tasks: ["pose"],
		});
		expect(report.tasks).toEqual(["pose"]);
		expect(Object.keys(report.modelDownloads)).toEqual(["rtmo-s"]);
		expect(fetches).toHaveLength(1);
		expect(report.trackCount).toBe(0);
		runner.close();
	});

	it("aggregates mask coverage from the shared segmentation pass", async () => {
		const { store } = fakeStore();
		const provider = new ScriptedProvider([rtmdetInsOutput()]);
		const runner = VisionRunner.create({ store, provider });
		const report = await analyzeSequence(frames(2), {
			runner,
			tasks: ["detect", "segment"],
			includeMasks: true,
		});
		expect(provider.created).toHaveLength(1);
		expect(provider.created[0].inputs).toHaveLength(2); // one pass per frame
		expect(report.masks.person.meanCoverage).toBeGreaterThan(0);
		expect(report.trackCount).toBe(1);
		runner.close();
	});

	it("respects the category filter", async () => {
		const { store } = fakeStore();
		const runner = VisionRunner.create({
			store,
			provider: new MovingProvider(),
		});
		const report = await analyzeSequence(frames(4), {
			runner,
			tasks: ["detect"],
			categories: ["car"],
		});
		expect(report.trackCount).toBe(0);
		expect(report.classes).toEqual({});
		runner.close();
	});
});
