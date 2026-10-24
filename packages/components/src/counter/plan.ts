/**
 * Counter planning, kept pure: how a format lays a number out (affixes,
 * separators, fixed decimals), the value over time, and where each digit
 * reel sits on every frame.
 */
import { evaluateEase } from "../core/ease.js";

/** How a known format writes any value: digits are laid out from these. */
export interface NumberLayout {
	decimals: number;
	/** Thousands separator, or null for none. */
	group: string | null;
	decimalMark: string;
	prefix: string;
	suffix: string;
	/** 100 for percentages. */
	scale: number;
}

export type CounterFormat =
	| string
	| Intl.NumberFormatOptions
	| ((value: number) => string);

/**
 * A layout for a d3-style format string (`",d"`, `",.2f"`, `".1%"`,
 * `"$,.0f"`) or Intl options. Functions return null: they are laid out per
 * character instead.
 */
export function numberLayout(
	format: CounterFormat,
	locale = "en-US",
): NumberLayout | null {
	if (typeof format === "function") return null;
	if (typeof format === "string") {
		const m = format.match(/^(\$)?(,)?(?:\.(\d+))?([df%]?)$/);
		if (!m) {
			throw new Error(
				`Counter: unsupported format "${format}". Use [$][,][.precision][d|f|%] (e.g. ",d", "$,.2f", ".1%"), Intl options, or a function.`,
			);
		}
		const type = m[4] ?? "";
		return {
			decimals: type === "d" ? 0 : Number(m[3] ?? (type === "%" ? 0 : 0)),
			group: m[2] ? "," : null,
			decimalMark: ".",
			prefix: m[1] ?? "",
			suffix: type === "%" ? "%" : "",
			scale: type === "%" ? 100 : 1,
		};
	}
	const nf = new Intl.NumberFormat(locale, format);
	const resolved = nf.resolvedOptions();
	const parts = nf.formatToParts(1234567.891);
	const first = parts.findIndex((p) => p.type === "integer");
	const lastNumeric = parts.reduce(
		(at, p, i) =>
			["integer", "group", "decimal", "fraction"].includes(p.type) ? i : at,
		-1,
	);
	return {
		decimals: resolved.maximumFractionDigits ?? 0,
		group: parts.find((p) => p.type === "group")?.value ?? null,
		decimalMark: parts.find((p) => p.type === "decimal")?.value ?? ".",
		prefix: parts
			.slice(0, first)
			.map((p) => p.value)
			.join(""),
		suffix: parts
			.slice(lastNumeric + 1)
			.map((p) => p.value)
			.join(""),
		scale: format.style === "percent" ? 100 : 1,
	};
}

/** `[frame, value, ease?]`: the value is reached at `frame`. */
export type ValueKey = readonly [frame: number, value: number, ease?: string];

/** The value at any frame of a piecewise trajectory. */
export function valueAt(
	keys: readonly ValueKey[],
	frame: number,
	fallbackEase: string,
): number {
	const first = keys[0];
	if (!first) return 0;
	if (frame <= first[0]) return first[1];
	for (let i = 1; i < keys.length; i++) {
		const a = keys[i - 1] as ValueKey;
		const b = keys[i] as ValueKey;
		if (frame <= b[0]) {
			const t = (frame - a[0]) / Math.max(1, b[0] - a[0]);
			return a[1] + (b[1] - a[1]) * evaluateEase(b[2] ?? fallbackEase, t);
		}
	}
	return (keys[keys.length - 1] as ValueKey)[1];
}

/** Number of digit places a scaled integer shows (at least `decimals + 1`). */
export function placesOf(n: number, decimals: number): number {
	const abs = Math.abs(Math.round(n));
	return Math.max(
		decimals + 1,
		abs === 0 ? 1 : Math.floor(Math.log10(abs)) + 1,
	);
}

/** Most turns a reel makes in one move; the rest is a blur nobody can read. */
export const MAX_TURNS = 3;

/**
 * Reel position (in digit steps) of place `p` on every frame `0..length`:
 * each segment moves every place from its old digit to its new one, higher
 * places later by `stagger × p` frames, spinning the way an odometer does
 * (capped at {@link MAX_TURNS} turns). `pos mod 10` is the digit shown.
 */
export function reelPositions(
	keys: readonly ValueKey[],
	place: number,
	o: { scale: number; stagger: number; ease: string; length: number },
): number[] {
	const unit = 10 ** place;
	const digitsAt = (v: number) =>
		Math.floor(Math.abs(Math.round(v * o.scale)) / unit);
	const out = new Array<number>(o.length + 1);
	let pos = digitsAt(keys[0]?.[1] ?? 0);
	let free = Number.NEGATIVE_INFINITY;
	const segments = keys.slice(1).map((b, i) => {
		const a = keys[i] as ValueKey;
		const delta = digitsAt(b[1]) - digitsAt(a[1]);
		const turns = Math.abs(delta);
		const distance =
			Math.sign(delta) *
			(turns <= MAX_TURNS * 10 ? turns : MAX_TURNS * 10 + (turns % 10));
		// A place never starts a move before finishing its last one.
		const start = Math.max(a[0] + o.stagger * place, free);
		const seg = {
			from: pos,
			distance,
			start,
			end: start + (b[0] - a[0]),
			ease: b[2] ?? o.ease,
		};
		pos += distance;
		free = seg.end;
		return seg;
	});
	for (let f = 0; f <= o.length; f++) {
		let p = digitsAt(keys[0]?.[1] ?? 0);
		for (const s of segments) {
			if (f <= s.start) break;
			const t = Math.min(1, (f - s.start) / Math.max(1, s.end - s.start));
			p = s.from + s.distance * evaluateEase(s.ease, t);
		}
		out[f] = p;
	}
	return out;
}

/** Frames where `value` crosses a multiple of `every`, with that multiple. */
export function milestones(
	values: readonly number[],
	every: number,
): Array<{ frame: number; value: number }> {
	const out: Array<{ frame: number; value: number }> = [];
	for (let f = 1; f < values.length; f++) {
		const a = Math.floor((values[f - 1] as number) / every);
		const b = Math.floor((values[f] as number) / every);
		if (a === b) continue;
		const dir = Math.sign(b - a);
		for (let k = a + (dir > 0 ? 1 : 0); dir > 0 ? k <= b : k > b; k += dir)
			out.push({ frame: f, value: k * every });
	}
	return out;
}
