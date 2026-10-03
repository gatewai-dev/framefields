/**
 * Design system for Full Circle: one warm-black palette lifted from the
 * plates, a geometric display face against an italic serif, and the house
 * motion curves. Timing lives in grid.ts (measured from the score).
 */
import {
	FontManager,
	Layer,
	LayerAnimation,
	TextAnimator,
	TextPathBuilder,
} from "gitframes";
import { font } from "./paths.js";

export const W = 1920;
export const H = 1080;
export const FPS = 30;

export const INK = "#0B0A09";
export const BONE = "#EDE6DA";
export const AMBER = "#E9A54B";
export const STONE = "#968D80";
export const EMBER = "#6E3B12";

export const DISPLAY = "Syne";
export const SERIF = "Instrument Serif Italic";
export const SANS = "Inter";

export async function registerFonts(): Promise<void> {
	await FontManager.register({ family: DISPLAY, source: font("Syne.ttf") });
	await FontManager.register({
		family: SERIF,
		source: font("InstrumentSerif-Italic.ttf"),
	});
	await FontManager.register({ family: SANS, source: font("Inter.ttf") });
}

export const EASE_OUT = "expo.out";
export const EASE_IN = "power3.in";
export const EASE_IN_OUT = "expo.inOut";

/** Safe margin (8% of height) for every caption. */
export const MARGIN = 88;

type Node = ReturnType<typeof Layer.box>;
type Anim = ReturnType<typeof LayerAnimation.create>;
type AnimProp = Parameters<Anim["keyframe"]>[0];
export type Key = [frame: number, value: number | string, ease?: string];

/** Keyframe list shorthand: `[frame, value, easeIntoThisKey?]`. */
export function keys(
	prop: AnimProp,
	list: Key[],
	anim: Anim = LayerAnimation.create(),
): Anim {
	for (const [frame, value, ease] of list)
		anim.keyframe(prop, frame, value, ease);
	return anim;
}

export interface LineOptions {
	id: string;
	text: string;
	y: number;
	size: number;
	color?: string;
	font?: string;
	/** Local frame the letters start rising. */
	inAt: number;
	/** Local frame the line starts leaving (omit to hold). */
	outAt?: number;
	letterSpacing?: number;
	weight?: number;
}

/**
 * A centred line whose letters rise out of a soft blur one after another,
 * then lift away. Used for every sentence in the film.
 */
export function line(o: LineOptions): Node {
	const height = Math.round(o.size * 1.3);
	const anim = LayerAnimation.create().kineticSweep(
		-1,
		1,
		o.inAt,
		o.inAt + 20,
		"power2.inOut",
	);
	if (o.outAt !== undefined) {
		anim
			.fromTo("y", 0, -o.size * 0.3, {
				start: o.outAt,
				end: o.outAt + 10,
				ease: EASE_IN,
			})
			.fadeOut(o.outAt, o.outAt + 10, "power2.in");
	}
	return Layer.box({
		id: o.id,
		position: "absolute",
		x: 0,
		y: o.y,
		width: W,
		height,
		overflow: "visible",
		children: [
			Layer.text(o.text, {
				id: `${o.id}-text`,
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height,
				fontFamily: o.font ?? SERIF,
				fontSize: o.size,
				fontWeight: o.weight,
				fill: o.color ?? BONE,
				align: "center",
				letterSpacing: o.letterSpacing ?? 0,
				animators: [
					TextAnimator.waveRise({
						y: o.size * 0.45,
						rotationX: 0,
						opacity: 0,
						blur: 10,
						easing: "expo.in",
					}),
				],
			}).animate(anim),
		],
	});
}

export interface CaptionOptions {
	id: string;
	text: string;
	y: number;
	inAt: number;
	outAt?: number;
	color?: string;
	size?: number;
	/** Frames the tracking takes to settle; keep it inside short clips. */
	settle?: number;
}

/** Small tracked uppercase caption, centred: the film's catalogue voice. */
export function caption(o: CaptionOptions): Node {
	const size = o.size ?? 24;
	const settle = o.settle ?? 18;
	const anim = LayerAnimation.create()
		.fadeIn(o.inAt, o.inAt + Math.min(6, settle), "power2.out")
		.letterSpacing(size * 0.6, size * 0.4, o.inAt, o.inAt + settle, EASE_OUT);
	if (o.outAt !== undefined) anim.fadeOut(o.outAt, o.outAt + 6, "power2.in");
	return Layer.text(o.text.toUpperCase(), {
		id: o.id,
		position: "absolute",
		x: 0,
		y: o.y,
		width: W,
		fontFamily: SANS,
		fontSize: size,
		fontWeight: 500,
		letterSpacing: size * 0.4,
		fill: o.color ?? BONE,
		align: "center",
	}).animate(anim) as unknown as Node;
}

/** Full-frame container owning [from, to) of the timeline; children use scene-local frames. */
export function scene(
	id: string,
	from: number,
	to: number,
	children: unknown[],
): Node {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: from,
		durationFrames: to - from,
		children: children as never,
	});
}

/** A full-frame flat colour, for fades and flashes. */
export function plane(id: string, color: string, blendMode?: string): Node {
	return Layer.shape("rect", {
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		fillColor: color,
		blendMode,
	}) as unknown as Node;
}

export interface OrbitOptions {
	id: string;
	text: string;
	ring: { cx: number; cy: number; r: number };
	inAt: number;
	outAt?: number;
	/** Full turns over `duration` frames (negative spins counter-clockwise). */
	turns: number;
	duration: number;
	size?: number;
}

/** Average advance of a tracked Inter capital, in ems (measured on the rendered caps). */
const CAP_ADVANCE = 0.7;

/** Tracked caps repeated around a circle and spinning on it at a constant rate. */
export function orbit(o: OrbitOptions): Node {
	const size = o.size ?? 26;
	const tracking = size * 0.5;
	const unit = `${o.text}   ·   `;
	const circumference = 2 * Math.PI * o.ring.r;
	const repeats = Math.max(
		1,
		Math.floor(circumference / (unit.length * (size * CAP_ADVANCE + tracking))),
	);
	const pad = size * 2;
	const box = 2 * (o.ring.r + pad);
	const anim = LayerAnimation.create()
		.fadeIn(o.inAt, o.inAt + 12, "power2.out")
		// Constant angular velocity: a spinner is the one place linear is right.
		.fromTo("rotation", 0, o.turns * 360, {
			start: 0,
			end: o.duration,
			ease: "none",
		});
	if (o.outAt !== undefined) anim.fadeOut(o.outAt, o.outAt + 8, "power2.in");
	return Layer.text(unit.repeat(repeats), {
		id: o.id,
		position: "absolute",
		x: o.ring.cx - box / 2,
		y: o.ring.cy - box / 2,
		width: box,
		height: box,
		fontFamily: SANS,
		fontSize: size,
		fontWeight: 600,
		letterSpacing: tracking,
		fill: BONE,
		pathOptions: TextPathBuilder.circularBadge(box / 2, box / 2, o.ring.r)
			.baselineOffset("center")
			.build(),
	}).animate(anim) as unknown as Node;
}
