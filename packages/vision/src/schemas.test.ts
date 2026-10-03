import { describe, expect, it } from "vitest";
import {
	PoseResultSchema,
	VisionConfigSchema,
	VisionSummarySchema,
} from "./schemas.js";

describe("vision schemas", () => {
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
		expect(VisionSummarySchema.safeParse(summary).success).toBe(true);
		expect(
			VisionSummarySchema.safeParse({ ...summary, frame: -1 }).success,
		).toBe(false);
	});

	it("validates the runtime config surface and rejects removed options", () => {
		expect(
			VisionConfigSchema.safeParse({
				enableMatte: true,
				variant: "s",
				confidence: 0.4,
			}).success,
		).toBe(true);
		expect(VisionConfigSchema.safeParse({ confidence: 1.5 }).success).toBe(
			false,
		);
		expect(VisionConfigSchema.safeParse({ variant: "n" }).success).toBe(false);
		expect(VisionConfigSchema.safeParse({ enableObb: true }).success).toBe(
			false,
		);
	});

	it("requires exactly 17 COCO keypoints per person", () => {
		const box = {
			originX: 0,
			originY: 0,
			width: 1,
			height: 1,
			normalizedX: 0,
			normalizedY: 0,
			normalizedWidth: 1,
			normalizedHeight: 1,
		};
		const kp = { x: 0, y: 0, visibility: 1 };
		const person = {
			score: 0.9,
			boundingBox: box,
			keypoints: Array(17).fill(kp),
		};
		expect(PoseResultSchema.safeParse({ people: [person] }).success).toBe(true);
		expect(
			PoseResultSchema.safeParse({
				people: [{ ...person, keypoints: Array(16).fill(kp) }],
			}).success,
		).toBe(false);
	});
});
