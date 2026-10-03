import type { Color } from "./renderer2d/index.js";
export type { Color }
/**
 * CSS named colors → normalized RGBA.
 * Covers the most commonly used names; hex and functional notation
 * are handled by the parser below.
 */
const NAMED_COLORS: Record<string, Color> = {
	transparent: { r: 0, g: 0, b: 0, a: 0 },
	black: { r: 0, g: 0, b: 0, a: 1 },
	white: { r: 1, g: 1, b: 1, a: 1 },
	red: { r: 1, g: 0, b: 0, a: 1 },
	green: { r: 0, g: 0.502, b: 0, a: 1 }, // CSS green = #008000
	lime: { r: 0, g: 1, b: 0, a: 1 },
	blue: { r: 0, g: 0, b: 1, a: 1 },
	yellow: { r: 1, g: 1, b: 0, a: 1 },
	cyan: { r: 0, g: 1, b: 1, a: 1 },
	aqua: { r: 0, g: 1, b: 1, a: 1 },
	magenta: { r: 1, g: 0, b: 1, a: 1 },
	fuchsia: { r: 1, g: 0, b: 1, a: 1 },
	orange: { r: 1, g: 0.647, b: 0, a: 1 },
	purple: { r: 0.502, g: 0, b: 0.502, a: 1 },
	pink: { r: 1, g: 0.753, b: 0.796, a: 1 },
	gray: { r: 0.502, g: 0.502, b: 0.502, a: 1 },
	grey: { r: 0.502, g: 0.502, b: 0.502, a: 1 },
};

const RGBA_RE =
	/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/;

function parseHex(hex: string): Color | null {
	const clean = hex.startsWith("#") ? hex.slice(1) : hex;
	const len = clean.length;

	if (len === 3) {
		return {
			r: parseInt(clean[0] + clean[0], 16) / 255,
			g: parseInt(clean[1] + clean[1], 16) / 255,
			b: parseInt(clean[2] + clean[2], 16) / 255,
			a: 1,
		};
	}
	if (len === 4) {
		return {
			r: parseInt(clean[0] + clean[0], 16) / 255,
			g: parseInt(clean[1] + clean[1], 16) / 255,
			b: parseInt(clean[2] + clean[2], 16) / 255,
			a: parseInt(clean[3] + clean[3], 16) / 255,
		};
	}
	if (len === 6) {
		return {
			r: parseInt(clean.slice(0, 2), 16) / 255,
			g: parseInt(clean.slice(2, 4), 16) / 255,
			b: parseInt(clean.slice(4, 6), 16) / 255,
			a: 1,
		};
	}
	if (len === 8) {
		return {
			r: parseInt(clean.slice(0, 2), 16) / 255,
			g: parseInt(clean.slice(2, 4), 16) / 255,
			b: parseInt(clean.slice(4, 6), 16) / 255,
			a: parseInt(clean.slice(6, 8), 16) / 255,
		};
	}
	return null;
}

/**
 * Parse any CSS color string into a normalized {r,g,b,a} Color
 * with channel values in [0,1].
 *
 * Supports:
 * - Hex: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
 * - Functional: rgb(r,g,b), rgba(r,g,b,a)
 * - Named: black, white, red, green, blue, yellow, transparent, etc.
 * - Color objects pass through unchanged.
 *
 * Returns `{ r: 0, g: 0, b: 0, a: 0 }` (transparent black) for
 * null/undefined/unrecognised input.
 */
export function parseColor(color: Color | string | null | undefined): Color {
	if (color == null) {
		return { r: 0, g: 0, b: 0, a: 0 };
	}

	if (typeof color !== "string") {
		return color;
	}

	const trimmed = color.trim();
	if (trimmed.length === 0) {
		return { r: 0, g: 0, b: 0, a: 0 };
	}

	// Hex
	if (trimmed.startsWith("#")) {
		const parsed = parseHex(trimmed);
		if (parsed) return parsed;
	}

	// rgb() / rgba()
	const rgbaMatch = RGBA_RE.exec(trimmed);
	if (rgbaMatch) {
		return {
			r: parseInt(rgbaMatch[1], 10) / 255,
			g: parseInt(rgbaMatch[2], 10) / 255,
			b: parseInt(rgbaMatch[3], 10) / 255,
			a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
		};
	}

	// Named color
	const named = NAMED_COLORS[trimmed.toLowerCase()];
	if (named) {
		return { ...named };
	}

	// Fallback: transparent black
	return { r: 0, g: 0, b: 0, a: 0 };
}

/**
 * Premultiplies an un-premultiplied (straight) RGBA Color by its alpha channel.
 */
export function premultiplyColor(color: Color): Color {
	return {
		r: color.r * color.a,
		g: color.g * color.a,
		b: color.b * color.a,
		a: color.a,
	};
}
