/**
 * Design system for the film: one warm palette, two typefaces, a 100 BPM beat
 * grid (the score's tempo) and a handful of motion primitives every scene uses.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FontManager, Layer, LayerAnimation, TextAnimator } from "gitframes";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const ASSETS = path.resolve(HERE, "../assets");
export const asset = (file: string) => path.join(ASSETS, file);

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const DURATION_FRAMES = 1044;

/** 100 BPM → one beat every 0.6 s = 18 frames. Every cut lands on this grid. */
export const BEAT = 18;
export const beats = (n: number) => Math.round(n * BEAT);

export const INK = "#0E0D0C";
export const PAPER = "#EEE9E0";
export const SAND = "#C9B89E";
export const STONE = "#8C857B";
export const GRAPHITE = "#181715";
export const EMBER = "#FF5A1F";

export const SERIF = "Instrument Serif";
export const SERIF_ITALIC = "Instrument Serif Italic";
export const SANS = "Inter";
export const MONO = "JetBrains Mono";

export async function registerFonts(): Promise<void> {
	const font = (file: string) => path.join(ROOT, "assets/fonts", file);
	await FontManager.register({ family: SERIF, source: font("InstrumentSerif-Regular.ttf") });
	await FontManager.register({ family: SERIF_ITALIC, source: font("InstrumentSerif-Italic.ttf") });
	await FontManager.register({ family: SANS, source: font("Inter.ttf") });
	await FontManager.register({ family: MONO, source: font("JetBrainsMono.ttf") });
}

/** House easing: fast out of the gate, long silky settle. */
export const EASE_OUT = "expo.out";
export const EASE_IN = "power3.in";
export const EASE_IN_OUT = "expo.inOut";

type Node = ReturnType<typeof Layer.box>;
type Anim = ReturnType<typeof LayerAnimation.create>;
type AnimProp = Parameters<Anim["keyframe"]>[0];

/** Keyframe list shorthand: `[frame, value, easeIntoThisKey?]`. */
export function keys(prop: AnimProp, list: [number, number | string, string?][], anim: Anim = LayerAnimation.create()): Anim {
	for (const [frame, value, ease] of list) anim.keyframe(prop, frame, value, ease);
	return anim;
}

export interface SceneOptions {
	id: string;
	from: number;
	to: number;
	background?: string;
	children: unknown[];
}

/** Full-frame container that owns a slice of the timeline; children use scene-local frames. */
export function scene({ id, from, to, background, children }: SceneOptions): Node {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: background ?? "transparent",
		startFrame: from,
		durationFrames: to - from,
		children: children as never,
	});
}

export interface HeadlineOptions {
	id: string;
	text: string;
	x: number;
	y: number;
	width?: number;
	size: number;
	color: string;
	font?: string;
	align?: "start" | "center" | "end";
	/** Scene-local frame the reveal starts on. */
	inAt: number;
	/** Scene-local frame the line starts sliding back out (omit to hold). */
	outAt?: number;
	/** Frames the letter-by-letter sweep takes to cross the whole line. */
	sweep?: number;
	letterSpacing?: number;
	/** Reveal direction: letters rise into place ("up") or settle down into it ("down"). */
	from?: "up" | "down";
	/** Exit keeps travelling the reveal direction, or sinks back where it came from. */
	exit?: "continue" | "return";
	/** Letter-spacing gained (px) while the line holds — keeps a static title breathing. */
	drift?: number;
}

/**
 * The signature type move: letters rise out of a soft blur one after another
 * and settle, then the whole line lifts away (or sinks back) as it fades.
 */
export function headline(o: HeadlineOptions): Node {
	const lineH = Math.round(o.size * 1.25);
	const width = o.width ?? W;
	const dir = o.from === "down" ? -1 : 1;
	const anim = LayerAnimation.create().kineticSweep(-1, 1, o.inAt, o.inAt + (o.sweep ?? 22), "power2.inOut");
	if (o.outAt !== undefined) {
		const exitY = (o.exit === "return" ? dir : -dir) * o.size * 0.35;
		anim
			.fromTo("y", 0, exitY, { start: o.outAt, end: o.outAt + 12, ease: EASE_IN })
			.fadeOut(o.outAt, o.outAt + 12, "power2.in");
	}
	if (o.drift) {
		const base = o.letterSpacing ?? 0;
		anim.letterSpacing(base, base + o.drift, o.inAt, (o.outAt ?? o.inAt + 90) + 14, "sine.out");
	}
	return Layer.box({
		id: o.id,
		position: "absolute",
		x: o.x,
		y: o.y,
		width,
		height: lineH,
		overflow: "visible",
		children: [
			Layer.text(o.text, {
				id: `${o.id}-text`,
				position: "absolute",
				x: 0,
				y: 0,
				width,
				height: lineH,
				fontFamily: o.font ?? SERIF,
				fontSize: o.size,
				fill: o.color,
				align: o.align ?? "start",
				letterSpacing: o.letterSpacing ?? 0,
				animators: [
					// Glyph progress runs 1 → 0 as the sweep passes, so an "in" curve
					// here is what makes each letter decelerate into place.
					TextAnimator.waveRise({ y: dir * o.size * 0.5, rotationX: 0, opacity: 0, blur: 10, easing: "expo.in" }),
				],
			}).animate(anim),
		],
	});
}

/** Soft ink gradient along the top or bottom edge so type reads over bright plates. */
export function scrim(id: string, edge: "top" | "bottom", height: number, alpha = 0.55): Node {
	const clear = "rgba(14,13,12,0)";
	const dark = `rgba(14,13,12,${alpha})`;
	return Layer.shape("rect", {
		id,
		position: "absolute",
		x: 0,
		y: edge === "top" ? 0 : H - height,
		width: W,
		height,
		fillType: "linear",
		fillColor: edge === "top" ? dark : clear,
		gradientEndColor: edge === "top" ? clear : dark,
		gradientAngle: 90,
	}) as unknown as Node;
}

export interface LabelOptions {
	id: string;
	text: string;
	x: number;
	y: number;
	color: string;
	inAt: number;
	outAt?: number;
	size?: number;
	width?: number;
	align?: "start" | "center" | "end";
}

/** Small tracked uppercase caption that slides in — the film's UI voice. */
export function label(o: LabelOptions): Node {
	const size = o.size ?? 22;
	const anim = LayerAnimation.create()
		.fadeIn(o.inAt, o.inAt + 10, "power2.out")
		.fromTo("x", o.x - 14, o.x, { start: o.inAt, end: o.inAt + 14, ease: EASE_OUT });
	if (o.outAt !== undefined) anim.fadeOut(o.outAt, o.outAt + 8, "power2.in");
	return Layer.text(o.text.toUpperCase(), {
		id: o.id,
		position: "absolute",
		x: o.x,
		y: o.y,
		width: o.width,
		fontFamily: SANS,
		fontSize: size,
		fontWeight: 500,
		letterSpacing: size * 0.22,
		fill: o.color,
		align: o.align ?? "start",
	}).animate(anim) as unknown as Node;
}

export interface ChapterOptions {
	id: string;
	index: string;
	name: string;
	color: string;
	inAt: number;
	outAt?: number;
	y?: number;
	/** Index colour; ember by default, override where the plate is ember-warm. */
	accent?: string;
}

/** "01 — Composite" chapter marker, bottom-left, shared by every scene. */
export function chapter(o: ChapterOptions): Node[] {
	const y = o.y ?? H - 92;
	const rule = LayerAnimation.create().fromTo("width", 0, 40, { start: o.inAt + 2, end: o.inAt + 16, ease: EASE_OUT });
	return [
		label({ id: `${o.id}-index`, text: o.index, x: 96, y, color: o.accent ?? EMBER, inAt: o.inAt, outAt: o.outAt }),
		Layer.shape("rect", {
			id: `${o.id}-rule`,
			position: "absolute",
			x: 140,
			y: y + 11,
			width: 40,
			height: 1,
			fillColor: o.color,
		}).animate(
			o.outAt === undefined ? rule : rule.fadeOut(o.outAt, o.outAt + 8),
		) as unknown as Node,
		label({ id: `${o.id}-name`, text: o.name, x: 196, y, color: o.color, inAt: o.inAt + 6, outAt: o.outAt }),
	];
}
