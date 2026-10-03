import { describe, expect, it } from "vitest";
import {
	VisionAnalysisReportSchema,
	YoloConfigSchema,
	YoloOBBResultSchema,
	YoloPoseResultSchema,
	YoloSummarySchema,
} from "./schemas.js";

describe("yolo schemas", () => {
	it("validates a frame summary", () => {
		const summary = {
			frame: 12,
			objects: [
				{
					trackId: 1,
					category: "person",
					score: 0.91,
					center: [540, 312] as [number, number],
					speed: 128,
					active: true,
				},
			],
			classes: ["person"],
			masks: { person: 1 },
		};
		expect(YoloSummarySchema.safeParse(summary).success).toBe(true);
		expect(YoloSummarySchema.safeParse({ ...summary, frame: -1 }).success).toBe(
			false,
		);
	});

	it("validates the runtime config surface", () => {
		expect(
			YoloConfigSchema.safeParse({
				enableObb: true,
				variant: "s",
				confidence: 0.4,
			}).success,
		).toBe(true);
		expect(YoloConfigSchema.safeParse({ confidence: 1.5 }).success).toBe(false);
		expect(YoloConfigSchema.safeParse({ variant: "z" }).success).toBe(false);
	});

	it("validates OBB detections with 4 corners and an angle", () => {
		const ok = {
			detections: [
				{
					category: "plane",
					classIndex: 4,
					score: 0.8,
					boundingBox: {
						originX: 1,
						originY: 2,
						width: 3,
						height: 4,
						normalizedX: 0.1,
						normalizedY: 0.2,
						normalizedWidth: 0.3,
						normalizedHeight: 0.4,
						angle: 0.5,
					},
					corners: [
						[0, 0],
						[1, 0],
						[1, 1],
						[0, 1],
					],
				},
			],
		};
		expect(YoloOBBResultSchema.safeParse(ok).success).toBe(true);
		expect(
			YoloOBBResultSchema.safeParse({
				detections: [{ ...ok.detections[0], corners: [[0, 0]] }],
			}).success,
		).toBe(false);
	});

	it("validates a pose result", () => {
		const keypoints = Array.from({ length: 17 }, (_, i) => ({
			x: i,
			y: i,
			visibility: 0.9,
		}));
		expect(
			YoloPoseResultSchema.safeParse({
				people: [
					{
						score: 0.9,
						boundingBox: {
							originX: 0,
							originY: 0,
							width: 10,
							height: 10,
							normalizedX: 0,
							normalizedY: 0,
							normalizedWidth: 0.1,
							normalizedHeight: 0.1,
						},
						keypoints,
					},
				],
			}).success,
		).toBe(true);
		expect(
			YoloPoseResultSchema.safeParse({ people: [{ score: 1, keypoints: [] }] })
				.success,
		).toBe(false);
	});

	it("validates an analysis report", () => {
		expect(
			VisionAnalysisReportSchema.safeParse({
				source: "clip.mp4",
				totalFrames: 120,
				fps: 24,
				durationSec: 5,
				tasks: ["detect"],
				modelDownloads: { yolo11n: { bytes: 10_723_904, ms: 812 } },
				inferenceMs: 4120,
				trackCount: 1,
				classes: {
					person: {
						framesPresent: 120,
						totalFrames: 120,
						maxConfidence: 0.94,
						tracks: 1,
					},
				},
				tracks: [
					{
						trackId: 1,
						category: "person",
						frames: [0, 119],
						speedMeanPxS: 132,
						centerPath: [[1, 2]],
					},
				],
				masks: { person: { meanCoverage: 0.18 } },
			}).success,
		).toBe(true);
	});
});
