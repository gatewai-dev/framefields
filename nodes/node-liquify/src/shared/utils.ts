import type { LiquifyDeformOperation, LiquifyDeformType } from "./config.js";

/**
 * Calculates deformed sampling coordinate in normalized space (0..1)
 * for a given output coordinate UV and list of liquify operations.
 */
export function mapUVThroughLiquify(
	uv: { x: number; y: number },
	operations: LiquifyDeformOperation[],
	aspectRatio = 1.0,
): { x: number; y: number } {
	let currentX = uv.x;
	let currentY = uv.y;

	for (const op of operations) {
		const dx = (currentX - op.x) * aspectRatio;
		const dy = currentY - op.y;
		const dist = Math.sqrt(dx * dx + dy * dy);

		if (dist >= op.radius || op.radius <= 0) {
			continue;
		}

		const t = dist / op.radius;
		const falloff = (1.0 - t * t) ** 2;

		switch (op.type) {
			case "Bloat": {
				// Sampling moves inward to magnify
				const factor = 1.0 - op.strength * falloff * 0.45;
				currentX = op.x + (currentX - op.x) * factor;
				currentY = op.y + (currentY - op.y) * factor;
				break;
			}
			case "Pucker": {
				// Sampling moves outward to pinch
				const factor = 1.0 + op.strength * falloff * 0.45;
				currentX = op.x + (currentX - op.x) * factor;
				currentY = op.y + (currentY - op.y) * factor;
				break;
			}
			case "TwirlCW": {
				// Rotate clockwise
				const angle = -op.strength * Math.PI * falloff;
				const cosA = Math.cos(angle);
				const sinA = Math.sin(angle);
				const relX = currentX - op.x;
				const relY = currentY - op.y;
				currentX = op.x + (relX * cosA - relY * sinA);
				currentY = op.y + (relX * sinA + relY * cosA);
				break;
			}
			case "TwirlCCW": {
				// Rotate counter-clockwise
				const angle = op.strength * Math.PI * falloff;
				const cosA = Math.cos(angle);
				const sinA = Math.sin(angle);
				const relX = currentX - op.x;
				const relY = currentY - op.y;
				currentX = op.x + (relX * cosA - relY * sinA);
				currentY = op.y + (relX * sinA + relY * cosA);
				break;
			}
			case "Push": {
				// Offset sampling in direction of push
				const shiftX = (op.dx ?? 0) * op.strength * falloff;
				const shiftY = (op.dy ?? 0) * op.strength * falloff;
				currentX -= shiftX;
				currentY -= shiftY;
				break;
			}
			case "Pull": {
				// Inverted push offset
				const shiftX = (op.dx ?? 0) * op.strength * falloff;
				const shiftY = (op.dy ?? 0) * op.strength * falloff;
				currentX += shiftX;
				currentY += shiftY;
				break;
			}
		}
	}

	return {
		x: Math.max(0, Math.min(1, currentX)),
		y: Math.max(0, Math.min(1, currentY)),
	};
}

export const TOOL_DESCRIPTIONS: Record<LiquifyDeformType, string> = {
	Bloat: "Expands pixels outward radially (magnify/enlarge).",
	Pucker: "Pinches pixels inward towards center (shrink/compress).",
	TwirlCW: "Rotates pixels clockwise with smooth radial falloff.",
	TwirlCCW: "Rotates pixels counter-clockwise with smooth radial falloff.",
	Push: "Displaces pixels along drag trajectory.",
	Pull: "Displaces pixels toward drag trajectory.",
};
