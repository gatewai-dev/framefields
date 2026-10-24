import {
	gradientStopsToOklab,
	limitGradientStops,
	type ParsedGradient,
	type ParsedGradientStop,
	parseCssGradient,
} from "@framefields/core";
import { GRADIENT_UNIFORM_FLOATS } from "../shaders/gradient.js";

export interface GradientBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

const GRADIENT_TYPE_CODE = { linear: 1, radial: 2, conic: 3 } as const;

/** The parsed gradient when `value` is a CSS gradient string. */
export function asGradient(value: unknown): ParsedGradient | null {
	return typeof value === "string" && value.includes("gradient(")
		? parseCssGradient(value)
		: null;
}

/**
 * Packs a gradient laid over `box` (local px) into `out` at `offset`
 * (`GRADIENT_UNIFORM_FLOATS` floats). Pass `null` to clear (solid fill).
 */
export function packGradientUniforms(
	gradient: ParsedGradient | null,
	box: GradientBox,
	out: Float32Array,
	offset: number,
): void {
	out.fill(0, offset, offset + GRADIENT_UNIFORM_FLOATS);
	if (!gradient) return;
	const stops: ParsedGradientStop[] = limitGradientStops(gradient.stops);
	const w = Math.max(box.width, 1e-3);
	const h = Math.max(box.height, 1e-3);
	const cx = box.x + gradient.center[0] * w;
	const cy = box.y + gradient.center[1] * h;
	out[offset] = GRADIENT_TYPE_CODE[gradient.type];
	out[offset + 1] = stops.length;
	out[offset + 4] = gradient.type === "linear" ? box.x + w / 2 : cx;
	out[offset + 5] = gradient.type === "linear" ? box.y + h / 2 : cy;
	if (gradient.type === "linear") {
		// CSS: 0deg points up, 90deg right; the line spans corner to corner.
		const r = (gradient.angle * Math.PI) / 180;
		const dx = Math.sin(r);
		const dy = -Math.cos(r);
		const len = Math.abs(w * dx) + Math.abs(h * dy);
		out[offset + 6] = dx / len;
		out[offset + 7] = dy / len;
	} else if (gradient.type === "radial") {
		let rx: number;
		let ry: number;
		if (gradient.radius) {
			[rx, ry] = gradient.radius;
		} else {
			[rx, ry] = radialExtent(
				gradient,
				cx - box.x,
				box.x + w - cx,
				cy - box.y,
				box.y + h - cy,
			);
		}
		out[offset + 6] = rx;
		out[offset + 7] = ry;
	} else {
		out[offset + 6] = (gradient.from * Math.PI) / 180;
	}
	stops.forEach((s, i) => {
		out[offset + 8 + i] = s.offset;
	});
	gradientStopsToOklab(stops).forEach((lab, i) => {
		out.set(lab, offset + 16 + i * 4);
	});
}

/**
 * Radii of a radial gradient from its size keyword, as CSS sizes them: the
 * centre's distances to the box's left, right, top and bottom edges in.
 * Default (no keyword) is farthest-corner.
 */
export function radialExtent(
	gradient: Pick<ParsedGradient, "shape" | "extent">,
	left: number,
	right: number,
	top: number,
	bottom: number,
): [number, number] {
	const extent = gradient.extent ?? "farthest-corner";
	const farthest = extent.startsWith("farthest");
	const sx = farthest ? Math.max(left, right) : Math.min(left, right);
	const sy = farthest ? Math.max(top, bottom) : Math.min(top, bottom);
	const circle = gradient.shape === "circle";
	if (extent.endsWith("side")) {
		if (!circle) return [sx, sy];
		const r = farthest ? Math.max(sx, sy) : Math.min(sx, sy);
		return [r, r];
	}
	// Corners: a circle through the corner; an ellipse with the sides' aspect
	// ratio scaled until it passes through it (√2 × the side radii).
	if (circle) {
		const r = Math.hypot(sx, sy);
		return [r, r];
	}
	return [sx * Math.SQRT2, sy * Math.SQRT2];
}
