import { describe, expect, it } from "vitest";
import { computeInputTransform } from "./preprocess.js";
import { decodeRtmo } from "./rtmo.js";

const transform = computeInputTransform(640, 640, {
	width: 640,
	height: 640,
	fit: "center",
});

/** People as [x0, y0, x1, y1, score, visibleKeypoints]. */
function outputs(people: number[][]) {
	const dets = new Float32Array(people.length * 5);
	const keypoints = new Float32Array(people.length * 17 * 3);
	people.forEach(([x0, y0, x1, y1, score, visible], i) => {
		dets.set([x0, y0, x1, y1, score], i * 5);
		for (let k = 0; k < 17; k++) {
			const o = (i * 17 + k) * 3;
			keypoints.set([x0 + 1, y0 + k, k < visible ? 0.9 : 0.05], o);
		}
	});
	return { dets, keypoints, count: people.length, keypointStride: 3 };
}

const opts = {
	confidence: 0.3,
	transform,
	sourceWidth: 640,
	sourceHeight: 640,
};

describe("decodeRtmo", () => {
	it("suppresses near-duplicate people, keeping the higher score", () => {
		const res = decodeRtmo(
			outputs([
				[100, 100, 200, 400, 0.42, 17],
				[102, 101, 201, 398, 0.67, 17],
				[400, 100, 500, 400, 0.5, 17],
			]),
			opts,
		);
		expect(res.people.map((p) => p.score)).toEqual([
			expect.closeTo(0.67, 5),
			expect.closeTo(0.5, 5),
		]);
	});

	it("suppresses duplicates whose boxes differ but whose joints coincide", () => {
		const res = decodeRtmo(
			outputs([
				[100, 100, 200, 400, 0.67, 17],
				[100, 100, 340, 420, 0.42, 17], // wider box, same joints
			]),
			opts,
		);
		expect(res.people).toHaveLength(1);
		expect(res.people[0].score).toBeCloseTo(0.67);
	});

	it("drops detections with too few visible keypoints", () => {
		const res = decodeRtmo(
			outputs([
				[100, 100, 200, 400, 0.9, 1],
				[400, 100, 500, 400, 0.9, 5],
			]),
			opts,
		);
		expect(res.people).toHaveLength(1);
		expect(res.people[0].boundingBox.originX).toBeCloseTo(400);
	});
});
