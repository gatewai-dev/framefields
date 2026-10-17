import { describe, expect, it } from "vitest";
import { logitToAlpha, probabilityToAlpha } from "./rtmdet-ins.js";
import {
	anchorPrior,
	maskLogits,
	type RtmdetInsHeadOutputs,
	selectInstances,
} from "./rtmdet-ins-head.js";

const ANCHORS = 8400;
const CLASSES = 3;

function head(
	entries: { anchor: number; box: number[]; scores: number[] }[],
): RtmdetInsHeadOutputs {
	const scores = new Float32Array(ANCHORS * CLASSES);
	const boxes = new Float32Array(ANCHORS * 4);
	for (const { anchor, box, scores: s } of entries) {
		boxes.set(box, anchor * 4);
		scores.set(s, anchor * CLASSES);
	}
	return {
		scores,
		boxes,
		kernels: new Float32Array(ANCHORS * 169),
		maskFeatures: new Float32Array(8 * 80 * 80),
		anchors: ANCHORS,
		classes: CLASSES,
		maskWidth: 80,
		maskHeight: 80,
		inputWidth: 640,
		inputHeight: 640,
	};
}

describe("selectInstances", () => {
	it("suppresses overlaps per class, keeps other classes, best first", () => {
		const selected = selectInstances(
			head([
				{ anchor: 10, box: [0, 0, 100, 100], scores: [0.9, 0, 0] },
				// IoU 0.81 with anchor 10: suppressed for class 0…
				{ anchor: 11, box: [0, 0, 100, 90], scores: [0.8, 0, 0.7] },
				// …IoU 0.5: kept.
				{ anchor: 12, box: [50, 0, 150, 100], scores: [0.6, 0, 0] },
				// Below the score floor in every class: never selected.
				{ anchor: 13, box: [300, 300, 400, 400], scores: [0.05, 0.04, 0] },
			]),
		);
		expect(selected).toEqual([
			{ anchor: 10, classIndex: 0, score: expect.closeTo(0.9, 5) },
			{ anchor: 11, classIndex: 2, score: expect.closeTo(0.7, 5) },
			{ anchor: 12, classIndex: 0, score: expect.closeTo(0.6, 5) },
		]);
	});

	it("returns at most 100 detections", () => {
		const entries = Array.from({ length: 150 }, (_, i) => ({
			anchor: i,
			box: [
				(i % 15) * 40,
				Math.floor(i / 15) * 40,
				(i % 15) * 40 + 30,
				Math.floor(i / 15) * 40 + 30,
			],
			scores: [0.5 + i / 1000, 0, 0],
		}));
		const selected = selectInstances(head(entries));
		expect(selected).toHaveLength(100);
		expect(selected[0]?.anchor).toBe(149);
	});
});

describe("anchorPrior", () => {
	it("walks the stride-8, -16 and -32 grids row by row", () => {
		expect(anchorPrior(0, 640, 640)).toEqual({ x: 0, y: 0, stride: 8 });
		expect(anchorPrior(81, 640, 640)).toEqual({ x: 8, y: 8, stride: 8 });
		expect(anchorPrior(6400, 640, 640)).toEqual({ x: 0, y: 0, stride: 16 });
		expect(anchorPrior(8399, 640, 640)).toEqual({ x: 608, y: 608, stride: 32 });
		expect(() => anchorPrior(8400, 640, 640)).toThrow(RangeError);
	});
});

describe("maskLogits", () => {
	it("runs the three dynamic layers over offsets and features", () => {
		const h = head([]);
		const anchor = 81; // prior (8, 8), stride 8
		const k = h.kernels.subarray(anchor * 169, (anchor + 1) * 169);
		// Layer 1: hidden0 = relu(-x offset), hidden1 = relu(feature 0).
		k[0] = -1; // w1[0][relX]
		k[12] = 1; // w1[1][feature 0]
		// Layer 2: pass both through. Layer 3: out = hidden0 + 2·hidden1 + 0.5.
		k[80] = 1;
		k[80 + 8 + 1] = 1;
		k[144] = 1;
		k[145] = 2;
		k[168] = 0.5;
		h.maskFeatures[3 * 80 + 4] = 0.25; // feature 0 at (x 4, y 3)
		const logits = maskLogits(h, anchor);
		// relX = (8 - 8x) / 64; hidden0 = relu(-(relX)) = max(0, (8x - 8) / 64).
		expect(logits[0]).toBeCloseTo(0.5, 6); // x 0: relX > 0
		expect(logits[3 * 80 + 4]).toBeCloseTo(0.5 + 24 / 64 + 0.5, 6);
	});
});

describe("logitToAlpha", () => {
	it("matches probabilityToAlpha after a sigmoid", () => {
		const fromLogit = logitToAlpha(0.5, 0.05);
		const fromProbability = probabilityToAlpha(0.5, 0.05);
		for (const l of [-8, -0.3, -0.1, 0, 0.05, 0.15, 0.3, 8]) {
			expect(fromLogit(l)).toBeCloseTo(
				fromProbability(1 / (1 + Math.exp(-l))),
				6,
			);
		}
		const hard = logitToAlpha(0.5, 0);
		expect([hard(-0.01), hard(0.01)]).toEqual([0, 255]);
	});
});
