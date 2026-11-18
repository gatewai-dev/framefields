/**
 * Shared design tokens, 120 BPM musical timing grid, palette, and math
 * helpers for the 20-second Gemini 4 Neon showcase film.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const ASSETS = path.join(ROOT, "assets");
export const FONTS_DIR = path.join(ASSETS, "fonts");
export const GENERATED_DIR = path.join(ASSETS, "generated");
export const OUTPUT = path.join(ROOT, "output");
export const SCORE_PATH = path.join(GENERATED_DIR, "score.wav");

/** 16:9 1080p at 30 fps, exactly 20.000 seconds (600 frames). */
export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const DURATION = 600;

/** 120 BPM: 15 frames per beat, 60 frames per 4-beat bar (10 bars total). */
export const BPM = 120;
export const BEAT_FRAMES = 15;
export const BAR_FRAMES = 60;
export const TRANSITION_FRAMES = 12;

/**
 * Five overlapping scenes in `Layer.sequence` summing to exactly 600 frames:
 *   Scene 1 (Ignition):  [0,   126)  dur 126
 *   Scene 2 (Reasoning): [114, 246)  dur 132  (overlap 12 centered at Bar 2 = f120)
 *   Scene 3 (Agentic):   [234, 366)  dur 132  (overlap 12 centered at Bar 4 = f240)
 *   Scene 4 (OmniModal): [354, 486)  dur 132  (overlap 12 centered at Bar 6 = f360)
 *   Scene 5 (Finale):    [474, 600)  dur 126  (overlap 12 centered at Bar 8 = f480)
 */
export const SCENE_DURATIONS = {
	ignition: 126,
	reasoning: 132,
	agentic: 132,
	omnimodal: 132,
	finale: 126,
} as const;

export const SCENE_STARTS = {
	ignition: 0,
	reasoning: 114,
	agentic: 234,
	omnimodal: 354,
	finale: 474,
} as const;

/** Key global musical/visual beats (in composition frames, 0..600). */
export const BEAT = {
	/** Opening frame. */
	open: 0,
	/** Act I ignition burst (Bar 1 = 2.0s). */
	ignite: 60,
	/** Act II cut center (Bar 2 = 4.0s). */
	reasoningIn: 120,
	/** Act II synaptic hypercube lock (Bar 3 = 6.0s). */
	latticeLock: 180,
	/** Act III cut center (Bar 4 = 8.0s). */
	agenticIn: 240,
	/** Act III live build pass + SDF bloom (Bar 5 = 10.0s). */
	buildPass: 300,
	/** Act IV cut center (Bar 6 = 12.0s). */
	omnimodalIn: 360,
	/** Act IV Voronoi shatter impact (Bar 6.5 = 13.0s). */
	shatter: 390,
	/** Act IV hero orbit pulse (Bar 7 = 14.0s). */
	shatterOrbit: 420,
	/** Act V cut center (Bar 8 = 16.0s). */
	finaleIn: 480,
	/** Act V swarm locks into Gemini 4-point star (Bar 8.5 = 17.0s). */
	starLock: 510,
	/** Act V specular glint across finished star (Bar 9.25 = 18.5s). */
	starGlint: 555,
	/** Final fade out starts (19.6s). */
	fadeOut: 588,
	/** End of film (20.0s). */
	end: DURATION,
} as const;

/** Electric Obsidian + Bioluminescent Neon Prism palette. */
export const PALETTE = {
	void: "#030408",
	obsidian: "#080B14",
	surface: "#0F1424",
	glassBorder: "rgba(0, 240, 255, 0.32)",
	white: "#F4F7FF",
	slate: "#9AB0D4",
	dimSlate: "#6A7FA6",
	cyan: "#00F0FF",
	iceCyan: "#A6FAFF",
	sapphire: "#3B82FF",
	deepBlue: "#112866",
	violet: "#9D3BFF",
	magenta: "#FF2E93",
	lime: "#C8FF00",
	floor: "#04060C",
} as const;

export const FONT_DISPLAY = "Archivo";
export const FONT_SANS = "Inter";
export const FONT_MONO = "JetBrains Mono";

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, t: number): number =>
	a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = clamp01((x - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t: number): number {
	const c = clamp01(t);
	return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

export function easeOutCubic(t: number): number {
	return 1 - (1 - clamp01(t)) ** 3;
}

export function easeOutExpo(t: number): number {
	const c = clamp01(t);
	return c >= 1 ? 1 : 1 - 2 ** (-10 * c);
}

/** Deterministic [0, 1) hash from integer indices. */
export function hash(i: number, j = 0): number {
	const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453123;
	return s - Math.floor(s);
}

/** Beat pulse envelope at global frame `f` (1 on impact, decays over `decay` frames). */
export function pulseAt(f: number, hit: number, decay = 12): number {
	const dt = f - hit;
	if (dt < 0 || dt > decay * 4) return 0;
	return Math.min(1, (dt + 0.5) / 1.5) * Math.exp(-dt / decay);
}
