import type { TrackedObject } from "@framefields/core";
import type { InstanceMask } from "../types.js";

/** Tracked-object geometry of one selected mask (bounds, center, velocity), with no detector involved. */
export function maskObject(
	mask: InstanceMask,
	frame: number,
	fps: number,
	score: number,
	previous?: TrackedObject,
): TrackedObject {
	let left = mask.width,
		top = mask.height,
		right = -1,
		bottom = -1;
	for (let y = 0; y < mask.height; y++)
		for (let x = 0; x < mask.width; x++) {
			if ((mask.mask[y * mask.width + x] ?? 0) < 128) continue;
			left = Math.min(left, x);
			top = Math.min(top, y);
			right = Math.max(right, x);
			bottom = Math.max(bottom, y);
		}
	const active = right >= 0;
	const x = active ? left : 0,
		y = active ? top : 0;
	const width = active ? right - left + 1 : 0,
		height = active ? bottom - top + 1 : 0;
	const centerX = x + width / 2,
		centerY = y + height / 2;
	const vx =
		active && previous?.active ? (centerX - previous.centerX) * fps : 0;
	const vy =
		active && previous?.active ? (centerY - previous.centerY) * fps : 0;
	return {
		trackId: 1,
		category: mask.category,
		score,
		boundingBox: {
			originX: x,
			originY: y,
			width,
			height,
			normalizedX: x / mask.width,
			normalizedY: y / mask.height,
			normalizedWidth: width / mask.width,
			normalizedHeight: height / mask.height,
		},
		centerX,
		centerY,
		normalizedCenterX: centerX / mask.width,
		normalizedCenterY: centerY / mask.height,
		velocity: { vx, vy },
		speed: Math.hypot(vx, vy),
		age: frame + 1,
		hits: frame + 1,
		active,
		isCoasting: false,
	};
}
