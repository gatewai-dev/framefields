/**
 * TextReveal timing, kept pure: which characters form each unit, when each
 * unit starts, the streaming bursts (typing rhythm lives in `core/typing.ts`).
 */
import { type GlyphUnit, rendererChars } from "../core/glyphs.js";
import type { Rng } from "../core/rng.js";
import { type Metrics, wordRanges } from "../core/text.js";
import { type StaggerOrder, staggerRanks } from "../core/timing.js";

export interface Unit {
	index: number;
	text: string;
	/** Character range [start, end). */
	start: number;
	end: number;
}

const isSpace = (c: string) => /\s/.test(c);

/** The units text animates by. Characters skip whitespace; lines follow measured wrapping. */
export function unitsOf(text: string, by: GlyphUnit, metrics: Metrics): Unit[] {
	if (by === "char") {
		const out: Unit[] = [];
		for (let i = 0; i < text.length; i++) {
			const c = text[i] as string;
			if (!isSpace(c))
				out.push({ index: out.length, text: c, start: i, end: i + 1 });
		}
		return out;
	}
	if (by === "word") {
		return wordRanges(text).map((w) => ({
			index: w.index,
			text: w.text,
			start: w.start,
			end: w.end,
		}));
	}
	const lines = new Map<number, { start: number; end: number }>();
	for (const g of metrics.glyphs) {
		const line = lines.get(g.line) ?? {
			start: Number.POSITIVE_INFINITY,
			end: 0,
		};
		line.start = Math.min(line.start, g.index);
		line.end = Math.max(line.end, g.index + 1);
		lines.set(g.line, line);
	}
	return [...lines.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, r], index) => ({
			index,
			text: text.slice(r.start, r.end).trim(),
			start: r.start,
			end: r.end,
		}));
}

/** Start frame per unit: rank in `order` × `stagger` (fractional frames allowed). */
export function unitStarts(
	count: number,
	stagger: number,
	order: StaggerOrder,
	seed: number,
	offset = 0,
): number[] {
	return staggerRanks(count, order, seed).map((r) => offset + r * stagger);
}

/**
 * The schedule indexed the way the renderer indexes `by`: per character
 * (spaces take the next unit's start, so they never lag) or per word / line.
 */
export function indexedStarts(
	text: string,
	by: GlyphUnit,
	units: readonly Unit[],
	starts: readonly number[],
): number[] {
	if (by !== "char") return [...starts];
	// Built per string index, returned in the renderer's index order.
	const out = new Array<number>(text.length).fill(0);
	let next = starts[starts.length - 1] ?? 0;
	for (let u = units.length - 1, i = text.length - 1; i >= 0; i--) {
		const unit = units[u];
		if (unit && unit.start === i) {
			next = starts[u] ?? next;
			u--;
		}
		out[i] = next;
	}
	return rendererChars(text, out);
}

/**
 * Streaming: words arrive in seeded bursts of 1–3, one frame apart inside a
 * burst, with an uneven pause between bursts (`gap` frames ± 50 %).
 */
export function burstStarts(
	count: number,
	gap: number,
	step: number,
	r: Rng,
	start = 0,
): number[] {
	const out: number[] = [];
	let t = start;
	while (out.length < count) {
		const size = r.int(1, 3);
		for (let i = 0; i < size && out.length < count; i++) {
			out.push(Math.round(t));
			t += step;
		}
		t += gap * (0.5 + r.next());
	}
	return out;
}

/** Glyphs a scrambling character cycles through: same case or class, plus a few symbols. */
export function scrambleSet(char: string): string {
	const symbols = "#%&*+=/<>?$";
	if (/[A-Z]/.test(char)) return `ABCDEFGHIJKLMNOPQRSTUVWXYZ${symbols}`;
	if (/[a-z]/.test(char)) return `abcdefghijklmnopqrstuvwxyz${symbols}`;
	if (/[0-9]/.test(char)) return `0123456789${symbols}`;
	return `${symbols}ABCDEFGHJKMNPRSTUVWXYZ`;
}
