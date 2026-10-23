/**
 * Geometry of text from real font measurement: word ranges, and the boxes a
 * character range covers (one per line it spans). Positions are relative to
 * the text box's top-left.
 */
import type { Rect } from "./draw.js";

/** The subset of `FontManager.measure` options components pass. */
export interface MeasureOptions {
	fontFamily: string;
	fontSize?: number;
	fontWeight?: string | number;
	letterSpacing?: number;
	lineHeight?: number;
	width?: number;
	align?: "left" | "center" | "right";
	direction?: "ltr" | "rtl" | "auto";
}

export interface GlyphBox {
	char: string;
	index: number;
	x: number;
	width: number;
	line: number;
	rtl?: boolean;
}

/** The subset of `FontManager.measure` results components read. */
export interface Metrics {
	width: number;
	height: number;
	lines: number;
	lineHeight: number;
	glyphs: GlyphBox[];
	caretX(count: number): number;
}

export type MeasureFn = (text: string, options: MeasureOptions) => Metrics;

export interface WordRange {
	text: string;
	/** Index of the first character (code units). */
	start: number;
	/** Index after the last character. */
	end: number;
	index: number;
}

/** Whitespace-separated words with their character ranges. */
export function wordRanges(text: string): WordRange[] {
	const out: WordRange[] = [];
	for (const m of text.matchAll(/\S+/g)) {
		const start = m.index ?? 0;
		out.push({
			text: m[0],
			start,
			end: start + m[0].length,
			index: out.length,
		});
	}
	return out;
}

/** Character range of the `nth` match of `match` in `text`, or null. */
export function findRange(
	text: string,
	match: string | RegExp,
	nth = 0,
): [number, number] | null {
	if (typeof match === "string") {
		let from = 0;
		for (let i = 0; ; i++) {
			const at = text.indexOf(match, from);
			if (at < 0) return null;
			if (i === nth) return [at, at + match.length];
			from = at + Math.max(1, match.length);
		}
	}
	const flags = match.flags.includes("g") ? match.flags : `${match.flags}g`;
	let i = 0;
	for (const m of text.matchAll(new RegExp(match.source, flags))) {
		if (i === nth) return [m.index ?? 0, (m.index ?? 0) + m[0].length];
		i++;
	}
	return null;
}

/**
 * Per-line x offset that `align` adds inside a box of `options.width`
 * (measurement itself lays every line out from the left edge).
 */
function lineShift(
	metrics: Metrics,
	line: number,
	options: MeasureOptions,
): number {
	if (!options.width || !options.align || options.align === "left") return 0;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const g of metrics.glyphs) {
		if (g.line !== line || g.char.trim() === "") continue;
		min = Math.min(min, g.x);
		max = Math.max(max, g.x + g.width);
	}
	if (!Number.isFinite(min)) return 0;
	const free = options.width - (max - min);
	return (options.align === "center" ? free / 2 : free) - min;
}

/**
 * The boxes characters [start, end) cover: one rect per line, spanning the
 * glyphs' advances, `lineHeight` tall. Whitespace at a line's ends is
 * excluded.
 */
export function rangeRects(
	metrics: Metrics,
	start: number,
	end: number,
	options: MeasureOptions,
): Rect[] {
	const byLine = new Map<number, { min: number; max: number }>();
	for (const g of metrics.glyphs) {
		if (g.index < start || g.index >= end || g.char.trim() === "") continue;
		const box = byLine.get(g.line) ?? {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
		};
		box.min = Math.min(box.min, g.x);
		box.max = Math.max(box.max, g.x + g.width - (options.letterSpacing ?? 0));
		byLine.set(g.line, box);
	}
	return [...byLine.entries()]
		.sort(([a], [b]) => a - b)
		.map(([line, box]) => {
			const shift = lineShift(metrics, line, options);
			return {
				x: box.min + shift,
				y: line * metrics.lineHeight,
				width: box.max - box.min,
				height: metrics.lineHeight,
			};
		});
}
