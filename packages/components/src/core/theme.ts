/**
 * Design tokens every component reads instead of hard-coded colors, fonts and
 * timings. `defineTheme` deep-merges a partial theme over `themes.graphite`.
 */
import { contrastRatio, isLight } from "./color.js";
import { scaleFrames } from "./timing.js";

/** A spring, as `springKeys` / `springAt` take it. */
export interface Spring {
	stiffness: number;
	damping: number;
}

/**
 * How far a surface sits above what's behind it: a soft drop shadow, plus a
 * faint highlight along its top edge so it reads as a lit object.
 */
export interface Elevation {
	/** Shadow opacity, 0–1. */
	opacity: number;
	/** Shadow offset (straight down) and blur, px at theme scale 1. */
	distance: number;
	size: number;
	/** Opacity of the 1 px top-edge highlight, 0–1 (0: none). */
	edge: number;
}

export interface Theme {
	/** Whether `bg` is dark or light; components pick shadows and chrome by it. */
	mode: "dark" | "light";
	color: {
		bg: string;
		surface: string;
		raised: string;
		line: string;
		ink: string;
		muted: string;
		accent: string;
		accent2: string;
		positive: string;
		negative: string;
		highlight: string;
		/** Shadow color (elevation). */
		shadow: string;
	};
	font: { display: string; body: string; mono: string; hand?: string };
	/** Font weights by role, so one theme can swap a heavier or lighter family. */
	weight: {
		regular: number;
		medium: number;
		semibold: number;
		bold: number;
		heavy: number;
	};
	radius: { sm: number; md: number; lg: number; pill: number };
	stroke: { hair: number; base: number; bold: number };
	/** Surfaces: `low` (chips, tags), `mid` (cards, toasts), `high` (windows, modals). */
	elevation: { low: Elevation; mid: Elevation; high: Elevation };
	motion: {
		ease: { enter: string; exit: string; move: string; snap: string };
		/** Durations in frames at 30 fps; see {@link themeFrames}. */
		speed: { fast: number; base: number; slow: number };
		/** `settle` lands without overshoot, `base` overshoots a little, `pop` bounces. */
		spring: { settle: Spring; base: Spring; pop: Spring };
	};
	/** Code token colors (CodeBlock); unset kinds use the built-in palette. */
	syntax?: Partial<Record<SyntaxKind, string>>;
	/** 1 = designed for 1080p. 2 for 4K, 0.5 for 540p. */
	scale: number;
}

/** Token kinds CodeBlock colors. */
export type SyntaxKind =
	| "plain"
	| "keyword"
	| "string"
	| "number"
	| "comment"
	| "function"
	| "type"
	| "property"
	| "punctuation"
	| "operator";

export type ThemeInput = DeepPartial<Theme>;

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const motion: Theme["motion"] = {
	ease: {
		enter: "expo.out",
		exit: "power2.in",
		move: "power3.inOut",
		snap: "back.out(1.6)",
	},
	speed: { fast: 8, base: 16, slow: 30 },
	spring: {
		settle: { stiffness: 230, damping: 24 },
		base: { stiffness: 260, damping: 20 },
		pop: { stiffness: 320, damping: 14 },
	},
};

const weight: Theme["weight"] = {
	regular: 400,
	medium: 500,
	semibold: 600,
	bold: 700,
	heavy: 800,
};

/** Dark grounds need deeper shadows, and a lit top edge to separate surfaces. */
const darkElevation: Theme["elevation"] = {
	low: { opacity: 0.32, distance: 3, size: 10, edge: 0.07 },
	mid: { opacity: 0.4, distance: 10, size: 30, edge: 0.08 },
	high: { opacity: 0.5, distance: 22, size: 60, edge: 0.1 },
};
const lightElevation: Theme["elevation"] = {
	low: { opacity: 0.1, distance: 2, size: 8, edge: 0 },
	mid: { opacity: 0.14, distance: 8, size: 26, edge: 0 },
	high: { opacity: 0.2, distance: 18, size: 54, edge: 0 },
};

const shape = {
	radius: { sm: 6, md: 12, lg: 24, pill: 999 },
	stroke: { hair: 1, base: 2, bold: 4 },
};

const fonts: Theme["font"] = {
	display: "Inter",
	body: "Inter",
	mono: "JetBrains Mono",
};

/** Built-in themes. Fonts are never bundled: register the families you use. */
export const themes = {
	/** Dark neutral: product demos, dev tools. */
	graphite: {
		mode: "dark",
		color: {
			bg: "#0d0e11",
			surface: "#16181d",
			raised: "#1f2229",
			line: "#2b2f38",
			ink: "#f3f4f6",
			muted: "#8b909c",
			accent: "#5b8cff",
			accent2: "#b07cff",
			positive: "#3ecf8e",
			negative: "#ff5c5c",
			highlight: "#ffd23f",
			shadow: "#000000",
		},
		font: fonts,
		weight,
		...shape,
		elevation: darkElevation,
		motion,
		scale: 1,
	},
	/** Light editorial: explainers, documentaries. */
	paper: {
		mode: "light",
		color: {
			bg: "#f4f1ea",
			surface: "#fffdf8",
			raised: "#ffffff",
			line: "#dcd6c8",
			ink: "#1a1814",
			muted: "#6b665c",
			accent: "#e0451f",
			accent2: "#1f5fe0",
			positive: "#1f8a4c",
			negative: "#c8282d",
			highlight: "#ffe066",
			shadow: "#3b2f1e",
		},
		font: fonts,
		weight,
		...shape,
		elevation: lightElevation,
		motion,
		scale: 1,
	},
	/** High contrast, saturated accent: social clips. */
	signal: {
		mode: "dark",
		color: {
			bg: "#000000",
			surface: "#111111",
			raised: "#1c1c1c",
			line: "#333333",
			ink: "#ffffff",
			muted: "#a3a3a3",
			accent: "#c6ff00",
			accent2: "#ff2e88",
			positive: "#00e676",
			negative: "#ff1744",
			highlight: "#c6ff00",
			shadow: "#000000",
		},
		font: fonts,
		weight,
		...shape,
		elevation: darkElevation,
		motion: {
			...motion,
			ease: { ...motion.ease, enter: "back.out(1.8)" },
			speed: { fast: 6, base: 12, slow: 24 },
			spring: {
				settle: { stiffness: 300, damping: 26 },
				base: { stiffness: 340, damping: 22 },
				pop: { stiffness: 400, damping: 14 },
			},
		},
		scale: 1,
	},
} as const satisfies Record<string, Theme>;

export type ThemeName = keyof typeof themes;

/**
 * Merge a partial theme over a base (default `themes.graphite`). Throws when
 * `ink` on `surface` falls below WCAG 4.5:1 and both are hex colors.
 */
export function defineTheme(
	input: ThemeInput | Theme = {},
	base: Theme = themes.graphite,
): Theme {
	const theme = merge(base, input) as Theme;
	// A new background without a mode says which one it is.
	if (input.mode === undefined && input.color?.bg !== undefined) {
		theme.mode = isLight(theme.color.bg) ? "light" : "dark";
		if (input.elevation === undefined)
			theme.elevation = theme.mode === "light" ? lightElevation : darkElevation;
	}
	const ratio = contrastRatio(theme.color.ink, theme.color.surface);
	if (ratio !== null && ratio < 4.5) {
		throw new Error(
			`Theme contrast too low: ink ${theme.color.ink} on surface ${theme.color.surface} is ${ratio.toFixed(2)}:1 (needs 4.5:1).`,
		);
	}
	return theme;
}

/** A theme's duration token in frames at `fps`. */
export function themeFrames(
	theme: Theme,
	speed: keyof Theme["motion"]["speed"],
	fps = 30,
): number {
	return scaleFrames(theme.motion.speed[speed], fps);
}

function merge(base: unknown, over: unknown): unknown {
	if (over === undefined) return base;
	if (
		base === null ||
		over === null ||
		typeof base !== "object" ||
		typeof over !== "object" ||
		Array.isArray(base) ||
		Array.isArray(over)
	) {
		return over;
	}
	const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const [key, value] of Object.entries(over as Record<string, unknown>)) {
		out[key] = merge(out[key], value);
	}
	return out;
}
