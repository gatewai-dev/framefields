/**
 * @file optical-flow-warper.ts
 * Temporal forward-warper for YOLO detections and instance masks using optical flow motion vectors.
 * Enables 4x inference throughput by synthesizing intermediate frames via motion vector advection.
 */

import type { DetectedObject, NormalizedBoundingBox } from "@gitframes/core";
import type { TrackedObject, YoloInstanceMask } from "../types.js";

export interface MotionVector {
	readonly dx: number;
	readonly dy: number;
}

export interface FlowField {
	readonly width: number;
	readonly height: number;
	/** Interleaved or planar velocity components [dx, dy] */
	getVector(x: number, y: number): MotionVector;
}

/**
 * Forward-warps a normalized or absolute bounding box along motion vectors.
 */
export function warpBoundingBox(
	box: NormalizedBoundingBox,
	motion: MotionVector,
	sourceWidth: number,
	sourceHeight: number,
): NormalizedBoundingBox {
	const normDx = sourceWidth > 0 ? motion.dx / sourceWidth : 0;
	const normDy = sourceHeight > 0 ? motion.dy / sourceHeight : 0;

	const newNormX = Math.max(
		0,
		Math.min(1 - box.normalizedWidth, box.normalizedX + normDx),
	);
	const newNormY = Math.max(
		0,
		Math.min(1 - box.normalizedHeight, box.normalizedY + normDy),
	);

	const newOriginX = newNormX * sourceWidth;
	const newOriginY = newNormY * sourceHeight;

	return {
		originX: newOriginX,
		originY: newOriginY,
		width: box.width,
		height: box.height,
		normalizedX: newNormX,
		normalizedY: newNormY,
		normalizedWidth: box.normalizedWidth,
		normalizedHeight: box.normalizedHeight,
		angle: box.angle,
	};
}

/**
 * Forward-warps an array of tracked objects across an un-inferred frame.
 */
export function warpTrackedObjects(
	objects: readonly TrackedObject[],
	flow: FlowField,
	sourceWidth: number,
	sourceHeight: number,
): TrackedObject[] {
	return objects.map((obj) => {
		const centerX = obj.boundingBox.originX + obj.boundingBox.width / 2;
		const centerY = obj.boundingBox.originY + obj.boundingBox.height / 2;
		const motion = flow.getVector(centerX, centerY);

		const warpedBox = warpBoundingBox(
			obj.boundingBox,
			motion,
			sourceWidth,
			sourceHeight,
		);

		return {
			...obj,
			boundingBox: warpedBox,
			isCoasting: true,
		};
	});
}

/**
 * Forward-warps an array of detected objects.
 */
export function warpDetectedObjects(
	detections: readonly DetectedObject[],
	flow: FlowField,
	sourceWidth: number,
	sourceHeight: number,
): DetectedObject[] {
	return detections.map((det) => {
		const centerX = det.boundingBox.originX + det.boundingBox.width / 2;
		const centerY = det.boundingBox.originY + det.boundingBox.height / 2;
		const motion = flow.getVector(centerX, centerY);

		return {
			...det,
			boundingBox: warpBoundingBox(
				det.boundingBox,
				motion,
				sourceWidth,
				sourceHeight,
			),
		};
	});
}

/**
 * Forward-warps a continuous sigmoid instance mask using a dense motion flow field.
 */
export function warpInstanceMask(
	instanceMask: YoloInstanceMask,
	flow: FlowField,
): YoloInstanceMask {
	const { width, height, mask } = instanceMask;
	const warped = new Uint8Array(mask.length);
	let area = 0;

	for (let y = 0; y < height; y++) {
		const rowOffset = y * width;
		for (let x = 0; x < width; x++) {
			const motion = flow.getVector(x, y);
			// Inverse warp lookup: where did this pixel come from?
			const srcX = Math.round(x - motion.dx);
			const srcY = Math.round(y - motion.dy);

			if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
				const val = mask[srcY * width + srcX];
				warped[rowOffset + x] = val;
				if (val > 0) area++;
			}
		}
	}

	return {
		...instanceMask,
		mask: warped,
		area,
	};
}
