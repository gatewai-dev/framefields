/**
 * Color math for components: parse, fade, mix and judge lightness. Accepts
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()` (comma or
 * space syntax) and `white` / `black` / `transparent`. Anything else (a
 * gradient, `oklch()`, a CSS variable) passes through untouched where a
 * function returns a color, and counts as unknown where it returns a number.
 */

/** Red, green, blue (0–255) and alpha (0–1). */
export type Rgba = [r: number, g: number, b: number, a: number];

const NAMED: Record<string, Rgba> = {
	white: [255, 255, 255, 1],
	black: [0, 0, 0, 1],
	transparent: [0, 0, 0, 0],
};

/** The color's channels, or null when the format isn't one listed above. */
export function parseColor(color: string): Rgba | null {
	const c = color.trim().toLowerCase();
	const named = NAMED[c];
	if (named) return [...named];
	const hex = c.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/);
	if (hex?.[1]) {
		const h =
			hex[1].length <= 4 ? [...hex[1]].map((x) => x + x).join("") : hex[1];
		const byte = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
		return [byte(0), byte(2), byte(4), h.length === 8 ? byte(6) / 255 : 1];
	}
	const fn = c.match(/^rgba?\(([^)]*)\)$/);
	if (fn?.[1]) {
		const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
		if (parts.length !== 3 && parts.length !== 4) return null;
		const num = (p: string, max: number) =>
			p.endsWith("%") ? (Number.parseFloat(p) / 100) * max : Number(p);
		const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255));
		const a = parts[3] === undefined ? 1 : num(parts[3], 1);
		if ([r, g, b, a].some((v) => v === undefined || Number.isNaN(v)))
			return null;
		return [r as number, g as number, b as number, a];
	}
	return null;
}

const css = ([r, g, b, a]: Rgba) =>
	`rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;

/** `color` at `alpha` (replacing its own); unknown formats pass through. */
export function withAlpha(color: string, alpha: number): string {
	const c = parseColor(color);
	return c ? css([c[0], c[1], c[2], alpha]) : color;
}

/**
 * `color` fully transparent, keeping its hue, so a gradient fading to it has
 * no dark fringe. Unknown formats give plain `rgba(0,0,0,0)`.
 */
export function transparent(color: string): string {
	const c = parseColor(color);
	return css(c ? [c[0], c[1], c[2], 0] : [0, 0, 0, 0]);
}

/** Mix `a` toward `b` by `t` (0 → a, 1 → b): `#rrggbb` when both are opaque. */
export function mix(a: string, b: string, t: number): string {
	const x = parseColor(a);
	const y = parseColor(b);
	if (!x || !y) return a;
	const m = x.map((v, k) => v + ((y[k] as number) - v) * t) as Rgba;
	if (m[3] < 1) return css(m);
	return `#${m
		.slice(0, 3)
		.map((v) => Math.round(v).toString(16).padStart(2, "0"))
		.join("")}`;
}

/** WCAG relative luminance (0 black … 1 white), or null for unknown formats. */
export function luminance(color: string): number | null {
	const c = parseColor(color);
	if (!c) return null;
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return (
		0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
	);
}

/** WCAG contrast ratio of two colors, or null when either is unknown. */
export function contrastRatio(a: string, b: string): number | null {
	const la = luminance(a);
	const lb = luminance(b);
	if (la === null || lb === null) return null;
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * True when black text reads better than white on `color` (luminance above
 * ~0.18). Unknown formats count as dark.
 */
export function isLight(color: string): boolean {
	return (luminance(color) ?? 0) > 0.179;
}

/** Whichever of `light` / `dark` ink reads better on `background`. */
export function inkOn(
	background: string,
	light = "#ffffff",
	dark = "#0b0c0e",
): string {
	return (contrastRatio(light, background) ?? 0) >=
		(contrastRatio(dark, background) ?? 0)
		? light
		: dark;
}
