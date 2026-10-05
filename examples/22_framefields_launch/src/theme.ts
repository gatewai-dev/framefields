/**
 * Design system for the launch film: a paper-white world with one cobalt
 * accent, Unbounded for display (900 against 300) over JetBrains Mono for the
 * machine voice, guest faces for the typography chapter, and the motion and
 * 3D primitives every scene is assembled from. Timing lives in grid.ts.
 */
import path from "node:path";
import { FontManager, Layer, LayerAnimation, TextAnimator } from "framefields";
import { FPS } from "./grid.js";
import { bare, type SungWord } from "./lyrics.js";
import { ASSETS, ROOT } from "./paths.js";

export const W = 1920;
export const H = 1080;
export { FPS };

// Palette: a light, paper-white world; ink for type, one cobalt accent.
export const BG = "#F4F2ED";
export const FG = "#121216";
export const SURFACE = "#E4E0D8";
export const MUTED = "#7C786F";
export const ACCENT = "#2B44FF";
export const ACCENT_DEEP = "#1A2BB0";
export const HAIRLINE = "rgba(18,18,22,0.14)";
/** The green screen behind the generated subject (images.ts), keyed out by ColorKey. */
export const KEY_GREEN = "#00FF00";

// Type.
export const DISPLAY = "Unbounded";
export const MONO = "JetBrains Mono";
/** Guest faces: each gets one moment in the typography chapter. */
export const GUEST = {
	anton: "Anton",
	monoton: "Monoton",
	fraunces: "Fraunces Italic",
	shade: "Bungee Shade",
	major: "Major Mono Display",
	pixel: "Silkscreen",
	dela: "Dela Gothic One",
	rubik: "Rubik Mono One",
	michroma: "Michroma",
	bowlby: "Bowlby One",
} as const;

/** Every face the film uses, fetched into assets/fonts by `pnpm fonts`. */
const FONT_FILES: Record<string, string> = {
	[DISPLAY]: "Unbounded.ttf",
	[MONO]: "JetBrainsMono.ttf",
	[GUEST.anton]: "Anton.ttf",
	[GUEST.monoton]: "Monoton.ttf",
	[GUEST.fraunces]: "FrauncesItalic.ttf",
	[GUEST.shade]: "BungeeShade.ttf",
	[GUEST.major]: "MajorMonoDisplay.ttf",
	[GUEST.pixel]: "Silkscreen.ttf",
	[GUEST.dela]: "DelaGothicOne.ttf",
	[GUEST.rubik]: "RubikMonoOne.ttf",
	[GUEST.michroma]: "Michroma.ttf",
	[GUEST.bowlby]: "BowlbyOne.ttf",
};

export async function registerFonts(): Promise<void> {
	for (const [family, file] of Object.entries(FONT_FILES))
		await FontManager.register({
			family,
			source: path.join(ASSETS, "fonts", file),
		});
}

export const EASE_OUT = "expo.out";
export const EASE_IN = "power3.in";
export const EASE_IN_OUT = "expo.inOut";
export const SNAP = "back.out(1.6)";

export type Node = ReturnType<typeof Layer.box>;
export type Anim = ReturnType<typeof LayerAnimation.create>;
type AnimProp = Parameters<Anim["keyframe"]>[0];
export type Key = [frame: number, value: number | string, ease?: string];

/** Keyframe list shorthand: `[frame, value, easeIntoThisKey?]`. */
export function keys(
	prop: AnimProp,
	list: Key[],
	anim: Anim = LayerAnimation.create(),
): Anim {
	return anim.keys(prop, list);
}

export interface SceneOptions {
	background?: string;
}

/** Full-frame container owning [from, to) of the timeline; children use scene-local frames. */
export function scene(
	id: string,
	from: number,
	to: number,
	children: unknown[],
	o: SceneOptions = {},
): Node {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: o.background ?? "transparent",
		startFrame: from,
		durationFrames: to - from,
		children: children as never,
	});
}

/** A full-frame flat colour, for flashes, wipes and fades. */
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

/** Opacity spikes: full at each hit frame, decaying over `decay` frames. */
export function flashes(
	hits: { at: number; peak: number }[],
	decay = 10,
): Anim {
	const list: Key[] = [[0, 0]];
	for (const { at, peak } of hits) {
		const last = list[list.length - 1][0];
		if (at - 1 > last) list.push([at - 1, 0]);
		if (at > list[list.length - 1][0]) list.push([at, peak]);
		list.push([at + decay, 0, "power2.out"]);
	}
	return keys("opacity", list);
}

export interface LabelOptions {
	id: string;
	text: string;
	x?: number;
	y: number;
	width?: number;
	align?: "start" | "center" | "end";
	color?: string;
	size?: number;
	inAt: number;
	outAt?: number;
}

/** The machine voice: small tracked mono caps that decode in from scrambled glyphs. */
export function label(o: LabelOptions): Node {
	const size = o.size ?? 22;
	const anim = LayerAnimation.create()
		.fadeIn(o.inAt, o.inAt + 4, "power2.out")
		.letterSpacing(size * 0.7, size * 0.32, o.inAt, o.inAt + 24, EASE_OUT);
	if (o.outAt !== undefined) anim.fadeOut(o.outAt, o.outAt + 6, "power2.in");
	return Layer.text(o.text.toUpperCase(), {
		id: o.id,
		position: "absolute",
		x: o.x ?? 0,
		y: o.y,
		width: o.width ?? W,
		fontFamily: MONO,
		fontSize: size,
		fontWeight: 600,
		letterSpacing: size * 0.32,
		fill: o.color ?? MUTED,
		align: o.align ?? "center",
	}).animate(anim) as unknown as Node;
}

export interface WordOptions {
	id: string;
	text: string;
	at: number;
	/** Frame the word starts leaving; omit to hold. */
	outAt?: number;
	y?: number;
	x?: number;
	width?: number;
	size?: number;
	font?: string;
	weight?: number;
	color?: string;
	align?: "start" | "center" | "end";
	letterSpacing?: number;
	/** Entrance: slam (scale down onto the beat) or rise (letters wave up). */
	enter?: "slam" | "rise";
}

/** A word that lands on a beat: slams from 1.6× with a blur-in, or rises letter by letter. */
export function word(o: WordOptions): Node {
	const size = o.size ?? 150;
	const lineH = Math.round(size * 1.25);
	const y = o.y ?? (H - lineH) / 2;
	const enter = o.enter ?? "slam";
	const anim = LayerAnimation.create();
	if (enter === "slam") {
		anim
			.fromTo("scale", 1.6, 1, { start: 0, end: 9, ease: EASE_OUT })
			.fromTo("opacity", 0, 1, { start: 0, end: 3, ease: "none" });
	} else {
		anim.kineticSweep(-1, 1, 0, 14, "power2.out");
	}
	if (o.outAt !== undefined) {
		anim.fromTo("y", y, y - size * 0.25, {
			start: o.outAt - o.at,
			end: o.outAt - o.at + 6,
			ease: EASE_IN,
		});
		anim.fadeOut(o.outAt - o.at, o.outAt - o.at + 6, "power2.in");
	}
	return Layer.text(o.text, {
		id: o.id,
		position: "absolute",
		x: o.x ?? 0,
		y,
		width: o.width ?? W,
		height: lineH,
		fontFamily: o.font ?? DISPLAY,
		fontSize: size,
		fontWeight: o.weight ?? 900,
		letterSpacing: o.letterSpacing ?? 0,
		fill: o.color ?? FG,
		align: o.align ?? "center",
		verticalAlign: "middle",
		anchorX: 0.5,
		anchorY: 0.5,
		startFrame: o.at,
		durationFrames: o.outAt !== undefined ? o.outAt - o.at + 7 : undefined,
		motionBlurShutter: 180,
		animators:
			enter === "rise"
				? [
						TextAnimator.waveRise({
							y: size * 0.5,
							rotationX: 70,
							opacity: 0,
							blur: 12,
							easing: "expo.out",
						}),
					]
				: [],
	}).animate(anim) as unknown as Node;
}

/** A full circle as two arcs from 12 o'clock, clockwise, centred in a 2r box. */
export function circlePath(r: number, cx = r, cy = r): string {
	return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r}`;
}

/** The default lens: at z = -CAM_Z the plane z = 0 maps 1:1 onto the canvas (fov 50). */
export const CAM_Z = H / 2 / Math.tan((25 * Math.PI) / 180);

export interface SungLineOptions {
	id: string;
	/** The sung words, each shown from its own sung frame. */
	words: SungWord[];
	/** Scene start: word frames are scene-local. */
	from: number;
	y: number;
	size: number;
	x?: number;
	width?: number;
	font?: string;
	weight?: number;
	color?: string;
	/** Per-word colour override, by index. */
	colors?: (string | undefined)[];
	gap?: number;
	upper?: boolean;
	justify?: "start" | "center" | "end";
	/** Frame (scene-local) the whole line leaves. */
	outAt?: number;
	/** Frame (relative to `from`) the line's clip ends: entrances are shortened to finish by then. */
	until?: number;
	enter?: "pop" | "rise";
	/** Stand the line in the 3D scene at this depth. */
	z?: number;
}

/**
 * A lyric line that builds word by word: every word appears on the frame it
 * is sung and not before, so the screen never runs ahead of the voice. The
 * row is laid out at full width from the start, so nothing reflows.
 */
export function sungLine(o: SungLineOptions): Node {
	// Shrink to fit the row: Unbounded 900 caps run about 0.92 em a character.
	const chars = o.words.reduce((n, w) => n + bare(w).length, 0);
	const gaps = Math.max(0, o.words.length - 1) * 0.28;
	const em =
		(o.font ?? DISPLAY) === DISPLAY && (o.weight ?? 900) >= 700 ? 0.92 : 0.7;
	const room = (o.width ?? W) - 160;
	const size = Math.min(o.size, Math.floor(room / (chars * em + gaps)));
	const children = o.words.map((w, i) => {
		const at = Math.max(0, w.at - o.from);
		const text = o.upper === false ? bare(w) : bare(w).toUpperCase();
		const anim = LayerAnimation.create();
		// A word sung just before the cut still lands at rest on its last frame.
		const fit = (frames: number) =>
			o.until === undefined
				? frames
				: Math.max(1, Math.min(frames, o.until - 1 - at));
		if ((o.enter ?? "pop") === "pop") {
			anim
				.fromTo("scale", 1.35, 1, {
					start: at,
					end: at + fit(8),
					ease: EASE_OUT,
				})
				.fromTo("opacity", 0, 1, { start: at, end: at + fit(2), ease: "none" });
		} else {
			anim
				.fromTo("y", size * 0.45, 0, {
					start: at,
					end: at + fit(10),
					ease: EASE_OUT,
				})
				.fromTo("opacity", 0, 1, { start: at, end: at + fit(3), ease: "none" });
		}
		return Layer.text(text, {
			id: `${o.id}-${i}`,
			fontFamily: o.font ?? DISPLAY,
			fontSize: size,
			fontWeight: o.weight ?? 900,
			fill: o.colors?.[i] ?? o.color ?? FG,
			anchorX: 0.5,
			anchorY: 0.5,
			opacity: 0,
		}).animate(anim);
	});
	const row = Layer.flex({
		id: o.id,
		position: "absolute",
		x: o.x ?? 0,
		y: o.y,
		width: o.width ?? W,
		dir: "row",
		gap: o.gap ?? Math.round(size * 0.28),
		justify: o.justify ?? "center",
		align: "center",
		...(o.z !== undefined ? { is3D: true, z: o.z } : {}),
		children,
	} as never);
	if (o.outAt !== undefined)
		row.animate(
			LayerAnimation.create().fadeOut(o.outAt, o.outAt + 6, "power2.in"),
		);
	return row as unknown as Node;
}

/** A time window for 3D groups: preserve-3d containers gate their faces by startFrame, not by scale. */
export function window3D(
	id: string,
	at: number,
	len: number,
	children: unknown[],
) {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		startFrame: at,
		durationFrames: len,
		transformStyle: "preserve-3d",
		children: children as never,
	} as never);
}

/** The framefields logo (the repo's brand mark): a viewfinder round a play head. */
export const LOGO = path.join(ROOT, "assets", "brand", "logo.png");

export interface LogoOptions {
	id: string;
	size: number;
	/** Centre of the mark. */
	x: number;
	y: number;
	/** Stand the mark in the 3D scene at this depth. */
	z?: number;
	startFrame?: number;
}

/** The logo as a square layer centred on (x, y), flat or standing in 3D. */
export function logoMark(o: LogoOptions): Node {
	return Layer.box({
		id: o.id,
		position: "absolute",
		x: o.x - o.size / 2,
		y: o.y - o.size / 2,
		width: o.size,
		height: o.size,
		...(o.z !== undefined ? { is3D: true, z: o.z } : {}),
		startFrame: o.startFrame,
		children: [
			Layer.image(LOGO, {
				id: `${o.id}-image`,
				position: "absolute",
				x: 0,
				y: 0,
				width: o.size,
				height: o.size,
				fit: "contain",
			}),
		],
	} as never);
}
