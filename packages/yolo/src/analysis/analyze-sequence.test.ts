import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { YoloVisionRunner } from "../runner/yolo-runner.js";
import type {
	SessionProvider,
	YoloSession,
	YoloTensorInput,
} from "../runtime/session-provider.js";
import type { YoloImageInput } from "../types.js";
import { analyzeSequence } from "./analyze-sequence.js";

/** Session that shifts a single person detection right by 10px on every call. */
class MovingSession implements YoloSession {
	private step = 0;
	async run(
		_input: YoloTensorInput,
	): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>> {
		const out = new Float32Array(5);
		out[0] = 300 + this.step * 10;
		out[1] = 320;
		out[2] = 100;
		out[3] = 200;
		out[4] = 0.9;
		this.step++;
		return { output0: { data: out, dims: [1, 5, 1] } };
	}
	async release(): Promise<void> {}
}

class MovingProvider implements SessionProvider {
	public readonly kind = "node" as const;
	public created = 0;
	private session?: MovingSession;
	async createSession(): Promise<YoloSession> {
		this.created++;
		this.session ??= new MovingSession();
		return this.session;
	}
}

/** OBB-only session: one rotated detection at a fixed spot. */
class ObbSession implements YoloSession {
	async run(
		_input: YoloTensorInput,
	): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>> {
		const nc = 80;
		const rows = 4 + nc + 1;
		const out = new Float32Array(rows);
		out[0] = 320;
		out[1] = 320;
		out[2] = 100;
		out[3] = 100;
		out[4] = 0.8;
		out[4 + nc] = Math.PI / 8;
		return { output0: { data: out, dims: [1, rows, 1] } };
	}
	async release(): Promise<void> {}
}

class ObbProvider implements SessionProvider {
	public readonly kind = "node" as const;
	async createSession(): Promise<YoloSession> {
		return new ObbSession();
	}
}

async function* frames(count: number): AsyncIterable<YoloImageInput> {
	for (let i = 0; i < count; i++) {
		yield {
			data: new Uint8ClampedArray(640 * 640 * 4).fill(128),
			width: 640,
			height: 640,
		};
	}
}

function withFetch<T>(fn: () => Promise<T>): Promise<T> {
	const orig = globalThis.fetch;
	globalThis.fetch = (async () =>
		new Response(new Uint8Array([1, 2, 3, 4]))) as typeof fetch;
	return fn().finally(() => {
		globalThis.fetch = orig;
	});
}

const MODELS_DIR = (): string => mkdtempSync(join(tmpdir(), "yolo-analysis-"));

describe("analyzeSequence", () => {
	it("produces a deterministic, zod-valid report for a moving object", async () => {
		await withFetch(async () => {
			const runner = YoloVisionRunner.create({
				provider: new MovingProvider(),
				modelsDir: MODELS_DIR(),
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
			expect(report.modelDownloads.yolo11n.bytes).toBeGreaterThan(0);
			expect(report.modelDownloads.yolo11n.ms).toBeGreaterThanOrEqual(0);
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
			expect(Number.isFinite(track.speedMeanPxS)).toBe(true);

			// zod round-trip
			const { VisionAnalysisReportSchema } = await import("../schemas.js");
			expect(VisionAnalysisReportSchema.safeParse(report).success).toBe(true);
			runner.close();
		});
	});

	it("runs only the requested task's model (I2)", async () => {
		await withFetch(async () => {
			const runner = YoloVisionRunner.create({
				provider: new ObbProvider(),
				modelsDir: MODELS_DIR(),
			});
			const report = await analyzeSequence(frames(3), {
				runner,
				tasks: ["obb"],
			});
			expect(report.tasks).toEqual(["obb"]);
			expect(Object.keys(report.modelDownloads)).toEqual(["yolo11n-obb"]);
			expect(runner.downloadStatus.get("yolo11n")).toBe("pending");
			runner.close();
		});
	});

	it("respects the category filter", async () => {
		await withFetch(async () => {
			const runner = YoloVisionRunner.create({
				provider: new MovingProvider(),
				modelsDir: MODELS_DIR(),
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
});
