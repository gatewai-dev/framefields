/**
 * Tokens for "First Light", the framefields desktop launch film: one take,
 * one world. Sizes, palette, the beats of the take and small math helpers.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const OUTPUT = path.join(ROOT, "output");
export const ASSETS = path.join(ROOT, "assets");

export const W = 1920;
export const H = 1080;
export const FPS = 30;

/** framefields.dev's palette: ink, graphite, paper, the mark's blue, one signal yellow. */
export const INK = "#040506";
export const GRAPHITE = "#1f2022";
export const SIDE = "#18191a";
export const CHAT = "#141516";
export const SHEET = "#2a2b2e";
export const RULE = "#3a3c3f";
export const STEEL = "#9a9da0";
export const PAPER = "#e8e9e7";
export const BLUE = "#3b82f6";
export const SIGNAL = "#f5e300";

export const DISPLAY = "Archivo";
export const TEXT = "Inter";
export const FONTS = {
	[DISPLAY]: path.resolve(ROOT, "../../assets/fonts/Archivo.ttf"),
	[TEXT]: path.resolve(ROOT, "../../assets/fonts/Inter.ttf"),
} as const;

/** The words typed into the composer: the film's only line. */
export const PROMPT = "a field of frames at first light";

/** The cut's pulse: 120 beats a minute, so a beat is 15 frames and a bar 60. */
export const BPM = 120;
export const BEAT_FRAMES = Math.round((FPS * 60) / BPM);
const bar = (bars: number, beats = 0) =>
	Math.round((bars * 4 + beats) * BEAT_FRAMES);

/**
 * The take, in frames, on the beat. The camera never cuts: it rushes over
 * the sleeping field as the window rises out of the floor, reads a line
 * being typed, kicks back as the field wakes, swings round it while the
 * field plays, follows the playhead, dives through the preview and
 * corkscrews up to find the mark landing below.
 */
export const BEAT = {
	/** The window starts to rise out of the floor … */
	rise: 8,
	/** … and the lens is at it. */
	arrive: bar(1),
	/** First key. */
	type: bar(1, 1) - 3,
	/** Last key. */
	typed: bar(2) - 6,
	/** Send, on the bar. */
	send: bar(2),
	/** The render bar starts to fill. */
	work: bar(2) + 6,
	/** The field wakes: the bar is full. */
	wake: bar(3),
	/** The field plays: four flips, a beat apart. */
	flips: bar(4),
	/** The playhead enters the field … */
	play: bar(5),
	/** … and leaves it. */
	played: bar(5, 3),
	/** The lens passes through the preview. */
	through: bar(6, 2) + 6,
	/** Frames lift off for the mark. */
	gather: bar(6, 3),
	/** The mark is whole, on the bar. */
	mark: bar(9),
	/** The name. */
	name: bar(9, 1),
	/** A glint runs across the mark. */
	glint: bar(10, 2),
	/** Fade to black starts. */
	out: bar(13),
	end: bar(14),
} as const;
export const DURATION = BEAT.end;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smoothstep 0 → 1 as `f` goes from `a` to `b`. */
export function ramp(f: number, a: number, b: number): number {
	const t = clamp01((f - a) / (b - a));
	return t * t * (3 - 2 * t);
}
/** Slow in, slow out, stronger than smoothstep. */
export function ease(t: number): number {
	const c = clamp01(t);
	return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;

/** A stable 0..1 hash of an integer pair. */
export function hash(i: number, j = 0): number {
	const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
	return s - Math.floor(s);
}
