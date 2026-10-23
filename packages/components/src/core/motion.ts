/**
 * Named entrances and exits shared by every component's `enter` / `exit`.
 * A preset becomes plain keyframes on the component's `stage` part, which is
 * pinned at (0, 0) inside the root, so offsets never fight the root's layout.
 */
import { LayerAnimation } from "@framefields/compositions/program";
import type { Theme } from "./theme.js";
import { scaleFrames } from "./timing.js";

export type MotionPresetName =
	| "none"
	| "fade"
	| "rise"
	| "drop"
	| "scale"
	| "pop"
	| "slide-left"
	| "slide-right"
	| "slide-up"
	| "slide-down"
	| "tilt";

export const MOTION_PRESETS: readonly MotionPresetName[] = [
	"none",
	"fade",
	"rise",
	"drop",
	"scale",
	"pop",
	"slide-left",
	"slide-right",
	"slide-up",
	"slide-down",
	"tilt",
];

export interface MotionOptions {
	/** Frames; default the theme's `base` speed. */
	duration?: number;
	ease?: string;
	/** Travel in px; default 40 (rise / drop) or 120 (slides) × theme.scale. */
	distance?: number;
	/** Frames to wait after the window starts (enter) or before it ends (exit). */
	delay?: number;
}

export type MotionPreset =
	| MotionPresetName
	| ({ preset: MotionPresetName } & MotionOptions);

export interface ResolvedMotion {
	preset: MotionPresetName;
	duration: number;
	ease: string;
	distance: number;
	delay: number;
}

/** Normalise a preset (or `false`) against a theme and fps. */
export function resolveMotion(
	input: MotionPreset | false | undefined,
	kind: "enter" | "exit",
	theme: Theme,
	fps = 30,
): ResolvedMotion | null {
	if (input === false || input === undefined) return null;
	const o = typeof input === "string" ? { preset: input } : input;
	if (o.preset === "none") return null;
	if (!MOTION_PRESETS.includes(o.preset)) {
		throw new Error(
			`Unknown motion preset "${o.preset}". Use one of: ${MOTION_PRESETS.join(", ")}.`,
		);
	}
	return {
		preset: o.preset,
		duration: Math.max(
			1,
			Math.round(o.duration ?? scaleFrames(theme.motion.speed.base, fps)),
		),
		ease:
			o.ease ??
			(o.preset === "pop"
				? theme.motion.ease.snap
				: kind === "enter"
					? theme.motion.ease.enter
					: theme.motion.ease.exit),
		distance:
			o.distance ?? (o.preset.startsWith("slide-") ? 120 : 40) * theme.scale,
		delay: Math.max(0, Math.round(o.delay ?? 0)),
	};
}

/** Offset (dx, dy) a translating preset starts from (enter) or ends at (exit). */
function offsetOf(m: ResolvedMotion): [number, number] {
	switch (m.preset) {
		case "rise":
		case "slide-up":
			return [0, m.distance];
		case "drop":
		case "slide-down":
			return [0, -m.distance];
		case "slide-left":
			return [m.distance, 0];
		case "slide-right":
			return [-m.distance, 0];
		default:
			return [0, 0];
	}
}

/**
 * Keyframes for an entrance that ends settled at frame `at + delay + duration`
 * (local frames of the animated node).
 */
export function enterAnimation(m: ResolvedMotion, at = 0): LayerAnimation {
	const s = at + m.delay;
	const e = s + m.duration;
	const anim = LayerAnimation.create();
	anim.keys("opacity", [
		[s, 0],
		[e, 1, m.ease],
	]);
	const [dx, dy] = offsetOf(m);
	if (dx !== 0)
		anim.keys("x", [
			[s, dx],
			[e, 0, m.ease],
		]);
	if (dy !== 0)
		anim.keys("y", [
			[s, dy],
			[e, 0, m.ease],
		]);
	if (m.preset === "scale")
		anim.keys("scale", [
			[s, 0.92],
			[e, 1, m.ease],
		]);
	if (m.preset === "pop")
		anim.keys("scale", [
			[s, 0.6],
			[e, 1, m.ease],
		]);
	if (m.preset === "tilt") {
		anim.keys("perspective", [[s, 1200]]);
		anim.keys("rotateX", [
			[s, 28],
			[e, 0, m.ease],
		]);
		anim.keys("translateZ", [
			[s, -160],
			[e, 0, m.ease],
		]);
	}
	return anim;
}

/**
 * Keyframes for an exit that finishes at local frame `end - delay`.
 */
export function exitAnimation(m: ResolvedMotion, end: number): LayerAnimation {
	const e = end - m.delay;
	const s = Math.max(0, e - m.duration);
	const anim = LayerAnimation.create();
	anim.keys("opacity", [
		[s, 1],
		[e, 0, m.ease],
	]);
	const [dx, dy] = offsetOf(m);
	// Exits leave the way entrances arrive: rise exits upward, and so on.
	if (dx !== 0)
		anim.keys("x", [
			[s, 0],
			[e, -dx, m.ease],
		]);
	if (dy !== 0)
		anim.keys("y", [
			[s, 0],
			[e, -dy, m.ease],
		]);
	if (m.preset === "scale")
		anim.keys("scale", [
			[s, 1],
			[e, 0.92, m.ease],
		]);
	if (m.preset === "pop")
		anim.keys("scale", [
			[s, 1],
			[e, 0.6, m.ease],
		]);
	if (m.preset === "tilt") {
		anim.keys("perspective", [[s, 1200]]);
		anim.keys("rotateX", [
			[s, 0],
			[e, -28, m.ease],
		]);
		anim.keys("translateZ", [
			[s, 0],
			[e, -160, m.ease],
		]);
	}
	return anim;
}
