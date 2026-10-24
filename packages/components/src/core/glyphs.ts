/**
 * Per-unit glyph animation on the GPU, with no node per unit: each unit
 * (character, word or line) gets its own start frame, and the renderer's
 * expression selector reads the schedule from a baked table. Timing is
 * exact (cue frames are where the motion happens) and any ease works,
 * because the curve is sampled offline with `core/ease.ts`.
 *
 * Expression `frame` is the text node's local frame; `textIndex` counts
 * every character of the string, spaces included.
 */
import { evaluateEase } from "./ease.js";

export type GlyphUnit = "char" | "word" | "line";

/** The expression variable that indexes each unit. */
export const UNIT_INDEX: Record<GlyphUnit, string> = {
	char: "textIndex",
	word: "wordIndex",
	line: "lineIndex",
};

export interface UnitSchedule {
	/** Start frame of each unit (indexed like the unit variable). */
	starts: readonly number[];
	/** Frames one unit's move takes. */
	duration: number;
	ease: string;
}

/** Glyph properties an animator can push (at weight 1). */
export interface GlyphProps {
	x?: number;
	y?: number;
	scale?: number;
	rotation?: number;
	rotationX?: number;
	opacity?: number;
	blur?: number;
	fillColor?: string;
}

/** The renderer's advanced text animator, as plain data. */
export interface GlyphAnimator {
	name: string;
	selectors: Array<{
		type: "expression";
		expression: string;
		mode: "add";
		amount: number;
	}>;
	props: GlyphProps;
}

const num = (v: number) => String(Math.round(v * 10000) / 10000);
const list = (values: readonly number[]) => `[${values.map(num).join(",")}]`;

/**
 * The weight expression for a schedule. `enter`: 1 (fully pushed) until the
 * unit starts, easing to 0 (at rest) by `start + duration`. `exit`: the
 * reverse, 0 → 1. Optional `factors` scale each unit's weight (seeded
 * scatter directions, for instance).
 */
export function scheduleExpression(
	unit: GlyphUnit,
	schedule: UnitSchedule,
	mode: "enter" | "exit",
	factors?: readonly number[],
): string {
	const n = Math.max(1, Math.round(schedule.duration));
	const table = Array.from({ length: n + 1 }, (_, k) =>
		evaluateEase(schedule.ease, k / n),
	);
	const idx = UNIT_INDEX[unit];
	const pick = (arr: string) => `(${arr}[${idx}]??${arr}[${arr}.length-1])`;
	const weight = mode === "enter" ? "1-v" : "v";
	const scaled = factors ? `(${weight})*${pick("F")}` : weight;
	return [
		`((S,L,F)=>{`,
		`const t=frame-${pick("S")};`,
		`const k=floor(t);`,
		`const v=t<=0?L[0]:t>=${n}?L[${n}]:L[k]+(L[k+1]-L[k])*(t-k);`,
		`return ${scaled};`,
		`})(${list(schedule.starts)},${list(table)},${factors ? list(factors) : "0"})`,
	].join("");
}

/**
 * 1 while each unit is inside its window [start, end) (a word being spoken),
 * else 0: a hard edge on exact frames. Indexed per unit; `factors` scale it.
 */
export function windowExpression(
	unit: GlyphUnit,
	starts: readonly number[],
	ends: readonly number[],
	factors?: readonly number[],
): string {
	const idx = UNIT_INDEX[unit];
	const f = factors ? `*(${list(factors)}[${idx}]??0)` : "";
	return `((S,E)=>{const s=S[${idx}];return s!==undefined&&frame>=s&&frame<E[${idx}]?1${f}:0;})(${list(starts)},${list(ends)})`;
}

/** 1 until each unit's start frame, then 0 (an exact step, no ease). */
export function stepExpression(
	unit: GlyphUnit,
	starts: readonly number[],
): string {
	const idx = UNIT_INDEX[unit];
	return `((S)=>frame<(S[${idx}]??S[S.length-1])?1:0)(${list(starts)})`;
}

/**
 * A per-character array (one entry per string index) in the renderer's
 * order: its `textIndex` skips line breaks, so every character after a
 * `\n` sits one index earlier than in the string.
 */
export function rendererChars<T>(text: string, values: readonly T[]): T[] {
	return values.filter((_, i) => text[i] !== "\n");
}

/** A fixed weight per unit (e.g. 1 for emphasised characters). */
export function constantExpression(
	unit: GlyphUnit,
	weights: readonly number[],
): string {
	return `(${list(weights)}[${UNIT_INDEX[unit]}]??0)`;
}

export function glyphAnimator(
	name: string,
	expression: string,
	props: GlyphProps,
): GlyphAnimator {
	return {
		name,
		selectors: [{ type: "expression", expression, mode: "add", amount: 1 }],
		props,
	};
}

/**
 * Evaluate an expression the way the renderer does (same scope names, same
 * [-1, 1] clamp). For tests and offline checks.
 */
export function evaluateGlyphExpression(
	expression: string,
	scope: {
		frame: number;
		textIndex?: number;
		wordIndex?: number;
		lineIndex?: number;
	},
): number {
	const vars = {
		textIndex: scope.textIndex ?? 0,
		wordIndex: scope.wordIndex ?? 0,
		lineIndex: scope.lineIndex ?? 0,
		frame: scope.frame,
		floor: Math.floor,
		clamp: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)),
		abs: Math.abs,
		min: Math.min,
		max: Math.max,
	};
	const fn = new Function(...Object.keys(vars), `return (${expression});`);
	const result = Number(fn(...Object.values(vars)));
	return Number.isFinite(result) ? Math.max(-1, Math.min(1, result)) : 0;
}
