/**
 * Frame-level layout: the canvas a component covers and the safe area inside
 * it that text and plates keep to.
 */
import type { Rect } from "./draw.js";

/** The composition size a full-frame component covers. */
export interface CanvasSize {
	width: number;
	height: number;
}

/** Margins as shares of the frame: left / right `x`, `top`, `bottom`. */
export interface SafeInsets {
	x: number;
	top: number;
	bottom: number;
}

/**
 * Safe-area margins by use. Portrait leaves room for the captions, buttons
 * and handles that short-form platforms draw over the bottom and right.
 */
export const SAFE_INSETS = {
	/** Titles, plates, lower thirds. */
	titles: {
		landscape: { x: 0.06, top: 0.08, bottom: 0.1 },
		portrait: { x: 0.08, top: 0.1, bottom: 0.24 },
	},
	/** Subtitles: narrower lines, the same bottom clearance. */
	captions: {
		landscape: { x: 0.1, top: 0.08, bottom: 0.1 },
		portrait: { x: 0.08, top: 0.12, bottom: 0.22 },
	},
} as const satisfies Record<
	string,
	{ landscape: SafeInsets; portrait: SafeInsets }
>;

/**
 * The rect inside `canvas` that content keeps to. `area` forces an
 * orientation or gives the rect itself; by default a frame taller than it is
 * wide counts as portrait.
 */
export function safeArea(
	canvas: CanvasSize,
	area?: "portrait" | "landscape" | Rect,
	insets: { landscape: SafeInsets; portrait: SafeInsets } = SAFE_INSETS.titles,
): Rect {
	if (area && typeof area === "object") return area;
	const { width: W, height: H } = canvas;
	const portrait = area ? area === "portrait" : H > W;
	const i = portrait ? insets.portrait : insets.landscape;
	return {
		x: W * i.x,
		y: H * i.top,
		width: W * (1 - 2 * i.x),
		height: H * (1 - i.top - i.bottom),
	};
}
