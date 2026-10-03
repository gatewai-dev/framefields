import { describe, expect, it } from "vitest";
import type { TrackedObject, YoloInstanceMask } from "../types.js";
import { letterboxResizeWgsl } from "./letterbox-resize.wgsl.js";
import { maskUpscaleWgsl } from "./mask-upscale.wgsl.js";
import {
	type FlowField,
	warpBoundingBox,
	warpDetectedObjects,
	warpInstanceMask,
	warpTrackedObjects,
} from "./optical-flow-warper.js";

describe("Phase 5: GPU Compute Acceleration & Optical Flow Warping", () => {
	it("letterboxResizeWgsl declares valid compute entry point and NCHW bindings", () => {
		expect(letterboxResizeWgsl).toContain("fn computeLetterbox(");
		expect(letterboxResizeWgsl).toContain("@workgroup_size(16, 16)");
		expect(letterboxResizeWgsl).toContain("outputBuffer: array<f32>");
		expect(letterboxResizeWgsl).toContain("params.padValue");
	});

	it("maskUpscaleWgsl evaluates 32-proto bilinear interpolation with sigmoid and feathering", () => {
		expect(maskUpscaleWgsl).toContain("fn computeMaskUpscale(");
		expect(maskUpscaleWgsl).toContain("protoBuffer: array<f32>");
		expect(maskUpscaleWgsl).toContain("coeffsBuffer: array<f32>");
		expect(maskUpscaleWgsl).toContain(
			"outputMask: texture_storage_2d<rgba8unorm, write>",
		);
		expect(maskUpscaleWgsl).toContain("1.0 / (1.0 + exp(-acc))");
	});

	it("warpBoundingBox shifts box along motion vectors", () => {
		const originalBox = {
			originX: 100,
			originY: 100,
			width: 50,
			height: 80,
			normalizedX: 0.1,
			normalizedY: 0.1,
			normalizedWidth: 0.05,
			normalizedHeight: 0.08,
		};

		const warped = warpBoundingBox(
			originalBox,
			{ dx: 20, dy: -10 },
			1000,
			1000,
		);

		expect(warped.originX).toBeCloseTo(120, 1);
		expect(warped.originY).toBeCloseTo(90, 1);
		expect(warped.normalizedX).toBeCloseTo(0.12, 4);
		expect(warped.normalizedY).toBeCloseTo(0.09, 4);
		expect(warped.width).toBe(50);
		expect(warped.height).toBe(80);
	});

	it("warpDetectedObjects shifts raw detections along motion vectors", () => {
		const detection = {
			category: "car",
			score: 0.88,
			boundingBox: {
				originX: 500,
				originY: 400,
				width: 120,
				height: 80,
				normalizedX: 0.5,
				normalizedY: 0.4,
				normalizedWidth: 0.12,
				normalizedHeight: 0.08,
			},
		};

		const flowField: FlowField = {
			width: 1000,
			height: 1000,
			getVector: () => ({ dx: -25, dy: 10 }),
		};

		const warped = warpDetectedObjects([detection], flowField, 1000, 1000);
		expect(warped).toHaveLength(1);
		expect(warped[0].boundingBox.originX).toBeCloseTo(475, 1);
		expect(warped[0].boundingBox.originY).toBeCloseTo(410, 1);
	});

	it("warpTrackedObjects forward-warps active tracks and marks them coasting", () => {
		const tracked: TrackedObject[] = [
			{
				trackId: 1,
				category: "person",
				score: 0.95,
				boundingBox: {
					originX: 200,
					originY: 200,
					width: 100,
					height: 200,
					normalizedX: 0.2,
					normalizedY: 0.2,
					normalizedWidth: 0.1,
					normalizedHeight: 0.2,
				},
				firstSeenFrame: 0,
				lastSeenFrame: 10,
				consecutiveMisses: 0,
				velocity: { x: 5, y: 0, vx: 5, vy: 0 },
				isCoasting: false,
			},
		];

		const flowField: FlowField = {
			width: 1000,
			height: 1000,
			getVector: () => ({ dx: 15, dy: 5 }),
		};

		const warped = warpTrackedObjects(tracked, flowField, 1000, 1000);
		expect(warped).toHaveLength(1);
		expect(warped[0].trackId).toBe(1);
		expect(warped[0].isCoasting).toBe(true);
		expect(warped[0].boundingBox.originX).toBeCloseTo(215, 1);
		expect(warped[0].boundingBox.originY).toBeCloseTo(205, 1);
	});

	it("warpInstanceMask moves soft alpha pixel values along flow vectors", () => {
		const width = 10;
		const height = 10;
		const mask = new Uint8Array(width * height).fill(0);
		// Put an active 2x2 soft-alpha blob at (2, 2)
		mask[2 * width + 2] = 200;
		mask[2 * width + 3] = 200;
		mask[3 * width + 2] = 200;
		mask[3 * width + 3] = 200;

		const instanceMask: YoloInstanceMask = {
			trackId: 1,
			category: "person",
			score: 0.9,
			width,
			height,
			mask,
			area: 4,
			boundingBox: {
				originX: 2,
				originY: 2,
				width: 2,
				height: 2,
				normalizedX: 0.2,
				normalizedY: 0.2,
				normalizedWidth: 0.2,
				normalizedHeight: 0.2,
			},
		};

		// Motion vector: dx = 3, dy = 2
		const flowField: FlowField = {
			width,
			height,
			getVector: () => ({ dx: 3, dy: 2 }),
		};

		const warped = warpInstanceMask(instanceMask, flowField);
		expect(warped.area).toBe(4);
		// Pixels that were at (2, 2) should now appear at (5, 4)
		expect(warped.mask[4 * width + 5]).toBe(200);
		expect(warped.mask[4 * width + 6]).toBe(200);
		expect(warped.mask[5 * width + 5]).toBe(200);
		expect(warped.mask[5 * width + 6]).toBe(200);
		// Original position (2, 2) should now be 0
		expect(warped.mask[2 * width + 2]).toBe(0);
	});
});
