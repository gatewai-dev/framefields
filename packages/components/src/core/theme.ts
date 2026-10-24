/**
 * Design tokens every component reads instead of hard-coded colors, fonts and
 * timings. `defineTheme` deep-merges a partial theme over `themes.graphite`.
 */
import { scaleFrames } from "./timing.js";

export interface Theme {
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
	};
	font: { display: string; body: string; mono: string; hand?: string };
	radius: { sm: number; md: number; lg: number; pill: number };
	stroke: { hair: number; base: number; bold: number };
	motion: {
		ease: { enter: string; exit: string; move: string; snap: string };
		/** Durations in frames at 30 fps; see {@link themeFrames}. */
		speed: { fast: number; base: number; slow: number };
	};
	/** 1 = designed for 1080p. 2 for 4K, 0.5 for 540p. */
	scale: number;
}

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
		},
		font: fonts,
		...shape,
		motion,
		scale: 1,
	},
	/** Light editorial: explainers, documentaries. */
	paper: {
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
		},
		font: fonts,
		...shape,
		motion,
		scale: 1,
	},
	/** High contrast, saturated accent: social clips. */
	signal: {
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
		},
		font: fonts,
		...shape,
		motion: {
			...motion,
			ease: { ...motion.ease, enter: "back.out(1.8)" },
			speed: { fast: 6, base: 12, slow: 24 },
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

/** WCAG contrast ratio of two hex colors, or null when either isn't hex. */
export function contrastRatio(a: string, b: string): number | null {
	const la = luminance(a);
	const lb = luminance(b);
	if (la === null || lb === null) return null;
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number | null {
	const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
	if (!m?.[1]) return null;
	const h =
		m[1].length === 3
			? m[1]
					.split("")
					.map((c) => c + c)
					.join("")
			: m[1];
	const channel = (i: number) => {
		const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
