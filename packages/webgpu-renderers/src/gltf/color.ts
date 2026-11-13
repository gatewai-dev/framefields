/**
 * Colors as authors write them (`"#d99a2b"`, `"#d99a2bcc"`, or display
 * 0..1 RGB(A) tuples) turned into glTF's linear factors.
 */

/** A display (sRGB) color: hex, or 0..1 components. */
export type ColorInput =
	| string
	| readonly [number, number, number]
	| readonly [number, number, number, number];

const srgbToLinear = (c: number) =>
	c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function parseHex(hex: string): [number, number, number, number] {
	const h = hex.trim().replace(/^#/, "");
	const full =
		h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join("") : h;
	if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full))
		throw new Error(`color: "${hex}" is not #rgb, #rgba, #rrggbb or #rrggbbaa`);
	const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255;
	return [n(0), n(2), n(4), full.length === 8 ? n(6) : 1];
}

/** Display RGBA, 0..1. */
export function displayRgba(c: ColorInput): [number, number, number, number] {
	if (typeof c === "string") return parseHex(c);
	return [c[0], c[1], c[2], c[3] ?? 1];
}

/** Linear RGB, 0..1, for glTF color factors. Alpha stays as written. */
export function linearRgba(c: ColorInput): [number, number, number, number] {
	const [r, g, b, a] = displayRgba(c);
	return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a];
}

export function linearRgb(c: ColorInput): [number, number, number] {
	const [r, g, b] = linearRgba(c);
	return [r, g, b];
}
