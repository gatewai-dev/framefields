import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { BREATHE, PULSE } from "./signals.js";
import {
	ACCENT,
	CYAN_TEXT,
	DISPLAY,
	EASE_IN,
	EASE_OUT,
	H,
	HEADER_Y,
	MARGIN,
	MONO,
	MUTED,
	SANS,
	TEXT,
	W,
} from "./theme.js";

/**
 * A full-frame scene on its own clock: children key their animation from
 * frame 0 = `from`. The whole scene lifts out over its last ten frames.
 */
export function scene(
	id: string,
	from: number,
	to: number,
	children: LayoutNode[],
): LayoutNode {
	const len = to - from;
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: from,
		durationFrames: len,
		children,
	}).animate(
		LayerAnimation.create()
			.fromTo("opacity", 1, 0, { start: len - 10, end: len, ease: EASE_OUT })
			.fromTo("y", 0, -40, { start: len - 10, end: len, ease: EASE_OUT }),
	);
}

/** Kicker line + display headline, top-left. */
export function header(
	id: string,
	kicker: string,
	title: string,
	at = 0,
): LayoutNode[] {
	return [
		Layer.text(kicker, {
			id: `${id}-kicker`,
			position: "absolute",
			x: MARGIN,
			y: HEADER_Y,
			width: 1200,
			height: 32,
			fontFamily: MONO,
			fontSize: 22,
			fontWeight: 600,
			letterSpacing: 4,
			fill: CYAN_TEXT,
		}).animate(riseAt(at, HEADER_Y)),
		Layer.text(title, {
			id: `${id}-title`,
			position: "absolute",
			x: MARGIN,
			y: HEADER_Y + 44,
			width: W - 2 * MARGIN,
			height: 96,
			fontFamily: DISPLAY,
			fontSize: 76,
			fontWeight: 700,
			fill: TEXT,
		}).animate(riseAt(at + 4, HEADER_Y + 44)),
	];
}

/** `rise` for absolutely placed nodes, whose `y` keyframes are absolute too. */
export function riseAt(
	at: number,
	y: number,
	dy = 40,
	duration = 24,
): LayerAnimation {
	return LayerAnimation.create()
		.fromTo("opacity", 0, 1, {
			start: at,
			end: at + Math.round(duration * 0.6),
			ease: "power2.out",
		})
		.fromTo("y", y + dy, y, { start: at, end: at + duration, ease: EASE_IN });
}

/** A small caption in the chart's voice. */
export function note(
	id: string,
	text: string,
	x: number,
	y: number,
	at: number,
	width = 520,
	align: "start" | "end" = "start",
): LayoutNode {
	return Layer.text(text, {
		id,
		position: "absolute",
		x,
		y,
		width,
		height: 36,
		fontFamily: SANS,
		fontSize: 26,
		fontWeight: 500,
		fill: MUTED,
		align,
	}).animate(riseAt(at, y, 24));
}

/**
 * A glowing ring that breathes on the beat: its opacity follows the `pulse`
 * signal, so it flashes on each beat and decays along expo.out.
 */
export function beatRing(
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
	at: number,
	color = ACCENT,
): LayoutNode {
	return Layer.box({
		id,
		position: "absolute",
		x,
		y,
		width,
		height,
		borderRadius: 14,
		borderWidth: 3,
		borderColor: color,
		background: "transparent",
		startFrame: at,
	}).animate(
		LayerAnimation.create().signal("opacity", PULSE, {
			multiplier: 0.75,
			offset: 0.25,
		}),
	);
}

/**
 * The ambient backdrop behind every scene: two soft radial glows whose opacity
 * swells with the `breathe` signal, and a faint baseline grid.
 */
export function backdrop(): LayoutNode[] {
	const glow = (
		id: string,
		x: number,
		y: number,
		size: number,
		color: string,
		mult: number,
	) =>
		Layer.shape("circle", {
			id,
			position: "absolute",
			x: x - size / 2,
			y: y - size / 2,
			width: size,
			height: size,
			fillType: "radial",
			fillColor: color,
			gradientEndColor: "rgba(247, 248, 251, 0)",
		}).animate(
			LayerAnimation.create().signal("opacity", BREATHE, {
				multiplier: mult,
				offset: 0.12,
			}),
		);
	const rules = Array.from({ length: 13 }, (_, i) =>
		Layer.box({
			id: `bg-rule-${i}`,
			position: "absolute",
			x: Math.round((W / 12) * i),
			y: 0,
			width: 1,
			height: H,
			background: "rgba(15, 23, 42, 0.035)",
		}),
	);
	return [
		glow(
			"bg-glow-a",
			W * 0.82,
			H * 0.18,
			1300,
			"rgba(99, 102, 241, 0.35)",
			0.18,
		),
		glow(
			"bg-glow-b",
			W * 0.12,
			H * 0.95,
			1100,
			"rgba(34, 211, 238, 0.35)",
			0.14,
		),
		...rules,
	];
}
