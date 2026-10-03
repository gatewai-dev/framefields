import { describe, expect, it } from "vitest";
import { decodeClassifyOutput } from "./classify.js";
import { decodeDetectOutput } from "./detect.js";
import {
	computeLetterbox,
	letterboxToTensor,
	unletterboxPoint,
} from "./letterbox.js";
import { computeIoU, type NmsBox, nms } from "./nms.js";
import { decodeObbOutput } from "./obb.js";
import { decodePoseOutput } from "./pose.js";
import { decodeSegmentOutput } from "./segment.js";

const COCO = [
	"person",
	"bicycle",
	"car",
	"motorcycle",
	"airplane",
	"bus",
	"train",
	"truck",
	"boat",
	"traffic light",
	"fire hydrant",
	"stop sign",
	"parking meter",
	"bench",
	"bird",
	"cat",
	"dog",
	"horse",
	"sheep",
	"cow",
	"elephant",
	"bear",
	"zebra",
	"giraffe",
	"backpack",
];

describe("computeLetterbox", () => {
	it("pads 1920x1080 to 640x640 (width-limited)", () => {
		const p = computeLetterbox(1920, 1080, 640);
		expect(p.scale).toBeCloseTo(640 / 1920, 6);
		expect(p.inputWidth).toBe(640);
		expect(p.inputHeight).toBe(360);
		expect(p.dw).toBe(0);
		expect(p.dh).toBe(140);
	});

	it("pads 640x640 exactly (no padding)", () => {
		const p = computeLetterbox(640, 640, 640);
		expect(p.inputWidth).toBe(640);
		expect(p.inputHeight).toBe(640);
		expect(p.dw).toBe(0);
		expect(p.dh).toBe(0);
	});

	it("unletterboxes points back to source space", () => {
		const p = computeLetterbox(1920, 1080, 640);
		// center of the input square == center of the source
		const { x, y } = unletterboxPoint(320, 320, p);
		expect(x).toBeCloseTo(960, 6);
		expect(y).toBeCloseTo(540, 6);
		// top-left of the content area -> source origin
		const tl = unletterboxPoint(0, 140, p);
		expect(tl.x).toBeCloseTo(0, 6);
		expect(tl.y).toBeCloseTo(0, 6);
	});
});

describe("letterboxToTensor", () => {
	it("writes NCHW planes with /255 values and 114 padding", () => {
		const w = 2;
		const h = 2;
		const data = new Uint8ClampedArray([
			255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
		]);
		const { tensor, params } = letterboxToTensor(
			{ data, width: w, height: h },
			320,
		);
		expect(params.dw).toBe(0);
		expect(params.dh).toBe(0);
		expect(tensor.length).toBe(3 * 320 * 320);
		// channel 0 (R): source pixel (0,0) = 255 -> 1.0
		expect(tensor[0]).toBe(1.0);
		// input x=160 maps exactly onto source x=1 (scale = 160)
		// channel 1 (G) there = 255 -> 1.0
		expect(tensor[1 * 320 * 320 + 160]).toBe(1.0);
		// input y=160 maps onto source y=1 — channel 2 (B) = 255 -> 1.0
		expect(tensor[2 * 320 * 320 + 160 * 320]).toBe(1.0);
		// bottom-right corner samples source (1,1) = white -> 1.0
		expect(tensor[319 * 320 + 319]).toBe(1.0);
	});

	it("fills padding with 114/255 for non-square input", () => {
		const data = new Uint8ClampedArray(4 * 2 * 4).fill(0);
		const { tensor, params } = letterboxToTensor(
			{ data, width: 4, height: 2 },
			8,
		);
		expect(params.dw).toBe(0);
		expect(params.dh).toBe(2);
		// any content row is 0 (black source)
		expect(tensor[2 * 8 + 2]).toBe(0);
		// padded row (y < 2) == 114/255
		expect(tensor[0]).toBeCloseTo(114 / 255, 5);
		expect(tensor[1 * 8 + 0]).toBeCloseTo(114 / 255, 5);
	});
});

describe("nms", () => {
	const box = (
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		score: number,
		classIndex: number,
	): NmsBox => ({
		x0,
		y0,
		x1,
		y1,
		score,
		classIndex,
		anchorIndex: 0,
	});

	it("keeps the highest-scoring overlapping box", () => {
		const boxes = [
			box(0, 0, 100, 100, 0.9, 0),
			box(10, 10, 110, 110, 0.8, 0),
			box(200, 200, 300, 300, 0.95, 0),
		];
		const kept = nms(boxes, 0.45);
		expect(kept).toHaveLength(2);
		expect(kept[0].score).toBe(0.95);
		expect(kept[1].score).toBe(0.9);
	});

	it("does not suppress across classes (class-aware)", () => {
		const boxes = [box(0, 0, 100, 100, 0.9, 0), box(10, 10, 110, 110, 0.8, 1)];
		expect(nms(boxes, 0.45)).toHaveLength(2);
	});

	it("computeIoU", () => {
		expect(
			computeIoU(box(0, 0, 100, 100, 1, 0), box(0, 0, 100, 100, 1, 0)),
		).toBe(1);
		expect(
			computeIoU(box(0, 0, 100, 100, 1, 0), box(200, 200, 300, 300, 1, 0)),
		).toBe(0);
		expect(
			computeIoU(box(0, 0, 100, 100, 1, 0), box(50, 50, 150, 150, 1, 0)),
		).toBeCloseTo(1 / 7, 6);
	});
});

describe("decodeDetectOutput", () => {
	const anchors = 2;
	const nc = 4;
	const params = computeLetterbox(100, 100, 640);
	// anchor 0: box (320, 320, 200, 150), best class 0 (person) @ 0.9
	// anchor 1: box (500, 400, 60, 40), best class 2 (car) @ 0.7 — low IoU w/ anchor 0? no: separate
	const output = new Float32Array((4 + nc) * anchors);
	output[0] = 320;
	output[anchors] = 320;
	output[2 * anchors] = 200;
	output[3 * anchors] = 150;
	output[(4 + 0) * anchors] = 0.9;
	output[(4 + 1) * anchors] = 0.1;
	output[1] = 500;
	output[anchors + 1] = 400;
	output[2 * anchors + 1] = 60;
	output[3 * anchors + 1] = 40;
	output[(4 + 2) * anchors + 1] = 0.7;
	output[(4 + 3) * anchors + 1] = 0.05;

	it("decodes to NMS'd DetectedObjects in source pixel space", () => {
		const res = decodeDetectOutput(output, anchors, nc, {
			confidence: 0.25,
			iouThreshold: 0.45,
			classNames: COCO.slice(0, nc),
			params,
			sourceWidth: 100,
			sourceHeight: 100,
		});
		expect(res).toHaveLength(2);
		const [person, car] = res;
		expect(person.category).toBe("person");
		expect(person.score).toBeCloseTo(0.9, 6);
		// input center (320,320) is the source center (50,50); box 200x150 -> source 31.25x23.4375
		expect(person.boundingBox.originX).toBeCloseTo(
			50 - 200 / 2 / (640 / 100),
			5,
		);
		expect(person.boundingBox.originY).toBeCloseTo(
			50 - 150 / 2 / (640 / 100),
			5,
		);
		expect(person.boundingBox.width).toBeCloseTo(200 / 6.4, 5);
		expect(person.boundingBox.height).toBeCloseTo(150 / 6.4, 5);
		expect(person.boundingBox.normalizedX).toBeCloseTo(
			person.boundingBox.originX / 100,
			5,
		);
		expect(car.category).toBe("car");
	});

	it("applies the class-name filter", () => {
		const res = decodeDetectOutput(output, anchors, nc, {
			confidence: 0.25,
			iouThreshold: 0.45,
			classes: ["car"],
			classNames: COCO.slice(0, nc),
			params,
			sourceWidth: 100,
			sourceHeight: 100,
		});
		expect(res).toHaveLength(1);
		expect(res[0].category).toBe("car");
	});

	it("suppresses a duplicate prediction overlapping the same object", () => {
		const dup = new Float32Array((4 + nc) * anchors);
		dup[0] = 320;
		dup[anchors] = 320;
		dup[2 * anchors] = 200;
		dup[3 * anchors] = 150;
		dup[(4 + 0) * anchors] = 0.9;
		dup[1] = 330;
		dup[anchors + 1] = 330;
		dup[2 * anchors + 1] = 190;
		dup[3 * anchors + 1] = 140;
		dup[(4 + 0) * anchors + 1] = 0.88;
		const res = decodeDetectOutput(dup, anchors, nc, {
			confidence: 0.25,
			iouThreshold: 0.45,
			classNames: COCO.slice(0, nc),
			params,
			sourceWidth: 100,
			sourceHeight: 100,
		});
		expect(res).toHaveLength(1);
		expect(res[0].score).toBeCloseTo(0.9, 6);
	});
});

describe("decodePoseOutput", () => {
	it("decodes a person with 17 keypoints, unletterboxed", () => {
		const anchors = 1;
		const rows = 4 + 1 + 17 * 3;
		const out = new Float32Array(rows * anchors);
		out[0] = 320;
		out[1 * anchors] = 320;
		out[2 * anchors] = 200;
		out[3 * anchors] = 300;
		out[4 * anchors] = 0.85; // confidence
		// nose keypoint at input (320, 300)
		out[(5 + 0 * 3) * anchors] = 320;
		out[(6 + 0 * 3) * anchors] = 300;
		out[(7 + 0 * 3) * anchors] = 0.95;
		// left shoulder at input (280, 360)
		out[(5 + 5 * 3) * anchors] = 280;
		out[(6 + 5 * 3) * anchors] = 360;
		out[(7 + 5 * 3) * anchors] = 0.9;

		const params = computeLetterbox(100, 100, 640);
		const res = decodePoseOutput(out, anchors, {
			confidence: 0.25,
			params,
			sourceWidth: 100,
			sourceHeight: 100,
		});
		expect(res.people).toHaveLength(1);
		const person = res.people[0];
		expect(person.score).toBeCloseTo(0.85, 6);
		expect(person.keypoints).toHaveLength(17);
		// nose: input (320,300) -> source (50, 300/6.4)
		expect(person.keypoints[0].x).toBeCloseTo(50, 5);
		expect(person.keypoints[0].y).toBeCloseTo(300 / 6.4, 5);
		expect(person.keypoints[0].visibility).toBeCloseTo(0.95, 5);
		// left shoulder index 5
		expect(person.keypoints[5].x).toBeCloseTo(280 / 6.4, 5);
		expect(person.keypoints[5].y).toBeCloseTo(360 / 6.4, 5);
	});

	it("drops anchors below the confidence threshold", () => {
		const anchors = 2;
		const rows = 4 + 1 + 17 * 3;
		const out = new Float32Array(rows * anchors);
		out[0] = 320;
		out[1 * anchors] = 320;
		out[2 * anchors] = 100;
		out[3 * anchors] = 100;
		out[4 * anchors] = 0.9;
		out[1] = 200;
		out[anchors + 1] = 200;
		out[2 * anchors + 1] = 50;
		out[3 * anchors + 1] = 50;
		out[4 * anchors + 1] = 0.05; // below threshold
		const res = decodePoseOutput(out, anchors, {
			confidence: 0.25,
			params: computeLetterbox(100, 100, 640),
			sourceWidth: 100,
			sourceHeight: 100,
		});
		expect(res.people).toHaveLength(1);
	});
});

describe("decodeClassifyOutput", () => {
	it("softmaxes and returns top-5", () => {
		const out = new Float32Array(5);
		out[0] = 2;
		out[1] = 1;
		out[2] = 0;
		out[3] = 3;
		out[4] = -1;
		const res = decodeClassifyOutput(out, 5);
		expect(res.top1).toBe(3);
		expect(res.top5).toHaveLength(5);
		expect(res.top5[0].index).toBe(3);
		expect(res.top1Score).toBeGreaterThan(0.5);
		// sum of softmax == 1
		const sum = res.top5.reduce((acc, x) => acc + x.score, 0);
		expect(sum).toBeCloseTo(1, 5);
	});
});

describe("decodeObbOutput", () => {
	it("projects rotated corners and the axis-aligned extent into source space", () => {
		const anchors = 2;
		const nc = 4;
		const angleRow = 4 + nc;
		const out = new Float32Array((5 + nc) * anchors);
		// anchor 0: center (320,320), 100x40, 90°, class 0 @ 0.9
		out[0] = 320;
		out[anchors] = 320;
		out[2 * anchors] = 100;
		out[3 * anchors] = 40;
		out[(4 + 0) * anchors] = 0.9;
		out[angleRow * anchors] = Math.PI / 2;
		// anchor 1: below threshold
		out[1] = 320;
		out[anchors + 1] = 320;
		out[2 * anchors + 1] = 100;
		out[3 * anchors + 1] = 40;
		out[(4 + 0) * anchors + 1] = 0.05;
		out[angleRow * anchors + 1] = 0;

		const params = computeLetterbox(100, 100, 640);
		const res = decodeObbOutput(out, anchors, nc, {
			confidence: 0.25,
			iouThreshold: 0.45,
			classNames: COCO.slice(0, nc),
			params,
			sourceWidth: 100,
			sourceHeight: 100,
		});

		expect(res.detections).toHaveLength(1);
		const det = res.detections[0];
		expect(det.category).toBe("person");
		expect(det.boundingBox.angle).toBeCloseTo(Math.PI / 2, 6);
		expect(det.corners).toHaveLength(4);
		// w=100,h=40 at scale 6.4 -> 15.625 x 6.25; rotated 90° around (50,50)
		expect(det.boundingBox.originX).toBeCloseTo(50 - 6.25 / 2, 4);
		expect(det.boundingBox.originY).toBeCloseTo(50 - 15.625 / 2, 4);
		expect(det.boundingBox.width).toBeCloseTo(6.25, 4);
		expect(det.boundingBox.height).toBeCloseTo(15.625, 4);
	});

	it("honours an overridden angle row for third-party exports", () => {
		const anchors = 1;
		const nc = 2;
		const out = new Float32Array(6 * anchors);
		out[0] = 320;
		out[anchors] = 320;
		out[2 * anchors] = 64;
		out[3 * anchors] = 64;
		out[(4 + 0) * anchors] = 0.9;
		out[4 * anchors] = 0.5; // angle stored at row 4 instead of 4+nc
		const res = decodeObbOutput(out, anchors, nc, {
			confidence: 0.25,
			iouThreshold: 0.45,
			classNames: ["person", "car"],
			params: computeLetterbox(100, 100, 640),
			sourceWidth: 100,
			sourceHeight: 100,
			angleRow: 4,
		});
		expect(res.detections[0].boundingBox.angle).toBeCloseTo(0.5, 6);
	});
});

describe("decodeSegmentOutput", () => {
	it("produces continuous anti-aliased soft alpha values (0..255)", () => {
		const anchors = 1;
		const nc = 1;
		const protoDim = 4;
		const rows = 4 + nc + 32;
		const output = new Float32Array(rows * anchors);
		// Box at center 320, 320, w=200, h=200, class 0 score 0.9
		output[0] = 320;
		output[1 * anchors] = 320;
		output[2 * anchors] = 200;
		output[3 * anchors] = 200;
		output[4 * anchors] = 0.9;
		// Coefficient for channel 0 = 1.0, rest 0
		output[(4 + nc) * anchors] = 1.0;

		// Proto tensor: 32 channels of 4x4.
		// Channel 0 has a gradient so sigmoid outputs values in transition band
		const proto = new Float32Array(32 * protoDim * protoDim);
		// Let logit(0.5) = 0. Center proto values around 0 with gradient -0.5 to +0.5
		for (let y = 0; y < protoDim; y++) {
			for (let x = 0; x < protoDim; x++) {
				proto[y * protoDim + x] = (x - 1.5) * 0.4;
			}
		}

		const params = computeLetterbox(64, 64, 640);
		const res = decodeSegmentOutput(output, proto, anchors, nc, protoDim, {
			confidence: 0.25,
			iouThreshold: 0.45,
			classNames: ["person"],
			params,
			sourceWidth: 64,
			sourceHeight: 64,
			maskThreshold: 0.5,
			featherRadius: 0.1,
		});

		expect(res.masks).toHaveLength(1);
		const mask = res.masks[0].mask;
		// Check that mask has intermediate values between 0 and 255 (anti-aliased soft alpha)
		let hasIntermediate = false;
		for (let i = 0; i < mask.length; i++) {
			if (mask[i] > 0 && mask[i] < 255) {
				hasIntermediate = true;
				break;
			}
		}
		expect(hasIntermediate).toBe(true);
	});
});
