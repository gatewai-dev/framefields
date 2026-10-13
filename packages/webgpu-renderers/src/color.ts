import { parseCssColor } from "@framefields/core";
import type { Color } from "./renderer2d/index.js";
export type { Color };
/**
 * Parse any CSS color string into a normalized {r,g,b,a} Color
 * with channel values in [0,1].
 *
 * Supports:
 * - Hex: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
 * - Functional: rgb()/rgba(), hsl()/hsla(), oklch(), oklab() (comma or space syntax)
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

	// Hex, rgb()/rgba(), hsl(), oklch(), oklab() and named colors.
	const parsed = parseCssColor(trimmed);
	if (parsed) {
		return { r: parsed[0], g: parsed[1], b: parsed[2], a: parsed[3] };
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

/**
 * Premultiplies straight-alpha RGBA8 pixels in place and returns them.
 *
 * Every 2D pipeline blends with premultiplied "over", so straight pixels
 * (decoded PNGs, `getImageData`, WebCodecs RGBA) must pass through here
 * before `writeTexture`. Otherwise RGB under transparent pixels is added
 * onto the destination.
 */
export function premultiplyPixels<T extends Uint8Array | Uint8ClampedArray>(
	pixels: T,
): T {
	for (let i = 0; i < pixels.length; i += 4) {
		const a = pixels[i + 3];
		if (a === 255) continue;
		// (c·a + 127) / 255, floored, equals round(c·a / 255) for 8-bit ints.
		pixels[i] = ((pixels[i] * a + 127) / 255) | 0;
		pixels[i + 1] = ((pixels[i + 1] * a + 127) / 255) | 0;
		pixels[i + 2] = ((pixels[i + 2] * a + 127) / 255) | 0;
	}
	return pixels;
}
