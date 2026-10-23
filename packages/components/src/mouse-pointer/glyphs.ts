/**
 * Cursor glyphs, drawn on a 24-unit grid and scaled to `size` px. Each glyph
 * is a few paths painted with the pointer's `color` (fill), `accent`, or as
 * strokes, plus the hotspot: the grid point that lands on the target.
 */
import type { Vec2 } from "../core/path.js";

export const CURSOR_STYLES = [
	"arrow",
	"triangle",
	"chevron",
	"dot",
	"ring",
	"target",
	"crosshair",
	"plus",
	"ibeam",
	"caret",
	"square",
	"diamond",
	"sparkle",
	"hand",
] as const;

export type CursorStyle = (typeof CURSOR_STYLES)[number];

export interface GlyphPart {
	/** Absolute path data on the 24-unit grid (M L C Z only). */
	d: string;
	/** `fill` / `accent` are filled shapes; `stroke` / `accent-stroke` are lines. */
	paint: "fill" | "accent" | "stroke" | "accent-stroke";
	/** Line width in grid units, for stroke paints. */
	width?: number;
}

export interface Glyph {
	parts: GlyphPart[];
	/** The point that lands on the target, in grid units. */
	hotspot: Vec2;
	/** Glyphs that read as a direction rotate with travel when `autoOrient` is on. */
	directional?: boolean;
}

/** A closed circle as cubic Béziers (no arcs, so it scales with the rest). */
function circle(cx: number, cy: number, r: number): string {
	const k = 0.5523 * r;
	return [
		`M${cx + r} ${cy}`,
		`C${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}`,
		`C${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}`,
		`C${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}`,
		`C${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}`,
		"Z",
	].join(" ");
}

function rect(x0: number, y0: number, x1: number, y1: number): string {
	return `M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z`;
}

const CENTER: Vec2 = [12, 12];

let library: Record<CursorStyle, Glyph> | undefined;

/** The glyph for a style (the library is built on first use). */
export function glyphFor(style: CursorStyle): Glyph {
	library ??= buildGlyphs();
	return library[style];
}

function buildGlyphs(): Record<CursorStyle, Glyph> {
	return {
		// The classic pointer: head, notch and tail as one silhouette.
		arrow: {
			parts: [
				{
					d: "M4 2.5 L4 19.4 L8.3 15.4 L11.2 21.8 L14.3 20.4 L11.5 14.2 L17.4 14.2 Z",
					paint: "fill",
				},
			],
			hotspot: [4, 2.5],
		},
		// The arrow's head alone: the pure-shape pointer.
		triangle: {
			parts: [{ d: "M4 2.5 L4 19.6 L17.6 13.9 Z", paint: "fill" }],
			hotspot: [4, 2.5],
			directional: true,
		},
		// A notched dart, the modern design-tool pointer.
		chevron: {
			parts: [
				{ d: "M4.5 3 L20.2 10.4 L12.7 12.7 L10.4 20.2 Z", paint: "fill" },
			],
			hotspot: [4.5, 3],
			directional: true,
		},
		dot: {
			parts: [{ d: circle(12, 12, 6), paint: "fill" }],
			hotspot: CENTER,
		},
		ring: {
			parts: [{ d: circle(12, 12, 7.5), paint: "stroke", width: 2.4 }],
			hotspot: CENTER,
		},
		target: {
			parts: [
				{ d: circle(12, 12, 8), paint: "stroke", width: 2 },
				{ d: circle(12, 12, 2.6), paint: "accent" },
			],
			hotspot: CENTER,
		},
		crosshair: {
			parts: [
				{ d: rect(11.1, 2.5, 12.9, 8.5), paint: "fill" },
				{ d: rect(11.1, 15.5, 12.9, 21.5), paint: "fill" },
				{ d: rect(2.5, 11.1, 8.5, 12.9), paint: "fill" },
				{ d: rect(15.5, 11.1, 21.5, 12.9), paint: "fill" },
				{ d: circle(12, 12, 1.4), paint: "accent" },
			],
			hotspot: CENTER,
		},
		plus: {
			parts: [
				{ d: rect(10, 4, 14, 20), paint: "fill" },
				{ d: rect(4, 10, 20, 14), paint: "fill" },
			],
			hotspot: CENTER,
		},
		ibeam: {
			parts: [
				{ d: rect(11.2, 4.6, 12.8, 19.4), paint: "fill" },
				{ d: rect(8.8, 3.2, 15.2, 4.9), paint: "fill" },
				{ d: rect(8.8, 19.1, 15.2, 20.8), paint: "fill" },
			],
			hotspot: CENTER,
		},
		caret: {
			parts: [{ d: rect(11, 3, 13, 21), paint: "accent" }],
			hotspot: CENTER,
		},
		square: {
			parts: [{ d: rect(6, 6, 18, 18), paint: "fill" }],
			hotspot: CENTER,
		},
		diamond: {
			parts: [{ d: "M12 3.5 L20.5 12 L12 20.5 L3.5 12 Z", paint: "fill" }],
			hotspot: CENTER,
		},
		sparkle: {
			parts: [
				{
					d: "M12 2 C12.8 8.4 15.6 11.2 22 12 C15.6 12.8 12.8 15.6 12 22 C11.2 15.6 8.4 12.8 2 12 C8.4 11.2 11.2 8.4 12 2 Z",
					paint: "accent",
				},
			],
			hotspot: CENTER,
		},
		// A pointing hand: fingertip is the hotspot.
		hand: {
			parts: [
				{
					d: [
						"M7.2 4.6 C7.2 3.5 8.1 2.6 9.2 2.6 C10.3 2.6 11.2 3.5 11.2 4.6",
						"L11.2 10.1 C11.6 9.7 12.2 9.5 12.9 9.6 C13.6 9.7 14.2 10.2 14.4 10.9",
						"C14.8 10.5 15.5 10.3 16.2 10.5 C16.9 10.7 17.4 11.3 17.5 12",
						"C17.9 11.7 18.5 11.6 19.1 11.8 C19.9 12.1 20.4 12.8 20.4 13.7",
						"L20.4 16.4 C20.4 19.5 17.9 22 14.8 22 L12.4 22 C10.6 22 9 21.1 8 19.6",
						"L4.8 14.7 C4.3 13.9 4.5 12.9 5.2 12.4 C5.9 11.9 6.8 12 7.2 12.6 Z",
					].join(" "),
					paint: "fill",
				},
			],
			hotspot: [9.2, 2.8],
		},
	};
}
