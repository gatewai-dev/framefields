import type { ExtendedLayer } from "./layer-schema.js";

// ── Timing & FPS ────────────────────────────────────────────────────────────

export const DEFAULT_FPS = 60;
export const DEFAULT_DURATION_MS = 3000;

// ── Dimension fallback for visual media without metadata ────────────────────

export const DEFAULT_MEDIA_DIMENSION = 1080;

// ── Per-type layer defaults ─────────────────────────────────────────────────

/** Default styling applied to new Text layers. */
export const TEXT_LAYER_DEFAULTS: Partial<ExtendedLayer> = {
	fontSize: 60,
	fontFamily: "Inter",
	fill: "#ffffff",
	fontStyle: "normal",
	align: "start",
	padding: 0,
};

/** Default styling applied to new Caption layers. */
export const CAPTION_LAYER_DEFAULTS: Partial<ExtendedLayer> = {
	fontSize: 48,
	fontFamily: "Inter",
	fill: "#ffffff",
	align: "center",
	verticalAlign: "bottom",
	padding: 0,
	lineHeight: 1.1,
	textAnimation: {
		in: "none",
		out: "none",
		entranceMs: 0,
		exitMs: 0,
		kinetic: "none",
		applyBy: "word",
		smoothing: true,
	},
	bottomPadding: 60,
};
