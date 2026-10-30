/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * All rights reserved.
 *
 * This source code is licensed under the SAM License found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { VisionImageInput } from "@framefields/vision";
import type { SamLicenseOptions } from "../license.js";

/** Normalized source-image coordinates. Labels 2/3 form a box's opposite corners. */
export interface Sam2Point {
	readonly x: number;
	readonly y: number;
	readonly label: 0 | 1 | 2 | 3;
}

/** Frame is on the source analysis clock, before trim or time remapping. */
export interface Sam2Prompt {
	readonly frame: number;
	readonly points: readonly Sam2Point[];
}

export interface Sam2Options extends SamLicenseOptions {
	readonly prompts: readonly Sam2Prompt[];
	/** Metadata for object and class signals; SAM does not classify objects. */
	readonly category?: string;
}

export interface Sam2FrameResult {
	readonly mask: Uint8Array;
	readonly width: number;
	readonly height: number;
	readonly score: number;
	readonly iou: number;
}

export interface Sam2FrameTracker {
	process(
		image: VisionImageInput,
		frame: number,
		points?: readonly Sam2Point[],
	): Promise<Sam2FrameResult>;
	release(): void;
}

export function validateSam2Prompts(prompts: readonly Sam2Prompt[]): void {
	if (prompts.length === 0)
		throw new Error("SAM 2 requires at least one prompt.");
	let previous = -1;
	for (const prompt of prompts) {
		if (!Number.isSafeInteger(prompt.frame) || prompt.frame <= previous) {
			throw new Error(
				"SAM 2 prompt frames must be nonnegative, unique and increasing.",
			);
		}
		previous = prompt.frame;
		if (prompt.points.length === 0)
			throw new Error("SAM 2 prompts need points or a box.");
		for (const point of prompt.points) validatePoint(point);
		const corners = prompt.points.filter((point) => point.label >= 2);
		if (
			corners.length &&
			(corners.length !== 2 ||
				corners[0]?.label !== 2 ||
				corners[1]?.label !== 3 ||
				corners[0].x >= corners[1].x ||
				corners[0].y >= corners[1].y)
		) {
			throw new Error(
				"SAM 2 boxes need top-left (2) and bottom-right (3) corners.",
			);
		}
	}
}

function validatePoint(point: Sam2Point): void {
	if (
		![0, 1, 2, 3].includes(point.label) ||
		!Number.isFinite(point.x) ||
		!Number.isFinite(point.y) ||
		point.x < 0 ||
		point.x > 1 ||
		point.y < 0 ||
		point.y > 1
	) {
		throw new Error(
			"SAM 2 points require normalized coordinates and labels 0, 1, 2 or 3.",
		);
	}
}
