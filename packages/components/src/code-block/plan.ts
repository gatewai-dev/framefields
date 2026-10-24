/**
 * CodeBlock planning, kept pure: tab expansion, the line diff, focus ranges,
 * and opacity tracks built from timed transitions.
 */
import type { KeyframeTuple } from "@framefields/compositions/program";

export function expandTabs(code: string, size: number): string {
	return code.replace(/\t/g, " ".repeat(size));
}

export interface LineDiff {
	/** [old index, new index] of lines that stay (in order). */
	kept: Array<[number, number]>;
	removed: number[];
	added: number[];
}

/**
 * Longest common subsequence on trimmed lines: re-indented lines count as
 * kept, so they glide instead of being deleted and re-added.
 */
export function diffLines(
	a: readonly string[],
	b: readonly string[],
): LineDiff {
	const A = a.map((l) => l.trim());
	const B = b.map((l) => l.trim());
	const n = A.length;
	const m = B.length;
	const lcs = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0),
	);
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			(lcs[i] as number[])[j] =
				A[i] === B[j]
					? ((lcs[i + 1] as number[])[j + 1] as number) + 1
					: Math.max(
							(lcs[i + 1] as number[])[j] as number,
							(lcs[i] as number[])[j + 1] as number,
						);
	const kept: Array<[number, number]> = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (A[i] === B[j]) {
			kept.push([i, j]);
			i++;
			j++;
		} else if (
			((lcs[i + 1] as number[])[j] as number) >=
			((lcs[i] as number[])[j + 1] as number)
		)
			i++;
		else j++;
	}
	const keptA = new Set(kept.map(([x]) => x));
	const keptB = new Set(kept.map(([, y]) => y));
	return {
		kept,
		removed: a.map((_, k) => k).filter((k) => !keptA.has(k)),
		added: b.map((_, k) => k).filter((k) => !keptB.has(k)),
	};
}

/** 1-based lines, as a list or `{ from, to }` → 0-based indices inside the code. */
export function focusSet(
	lines: readonly number[] | { from: number; to: number },
	count: number,
): Set<number> {
	const list =
		"from" in lines
			? Array.from(
					{ length: Math.max(0, lines.to - lines.from + 1) },
					(_, k) => lines.from + k,
				)
			: lines;
	return new Set(list.map((l) => l - 1).filter((l) => l >= 0 && l < count));
}

/** A value track built from transitions: each eases from wherever the value is to `to`. */
export class Track {
	private changes: Array<{
		start: number;
		end: number;
		to: number;
		ease: string;
	}> = [];

	constructor(private readonly initial: number) {}

	to(start: number, end: number, value: number, ease = "power2.out"): this {
		this.changes.push({ start, end: Math.max(start, end), to: value, ease });
		return this;
	}

	/** Ascending keyframes; a change that starts mid-transition starts from its target. */
	keys(): KeyframeTuple[] {
		const keys: KeyframeTuple[] = [[0, this.initial]];
		let value = this.initial;
		for (const c of [...this.changes].sort((x, y) => x.start - y.start)) {
			const last = keys[keys.length - 1] as KeyframeTuple;
			const start = Math.max(c.start, last[0] + (c.end === c.start ? 1 : 0));
			if (start > last[0]) keys.push([start, value]);
			const end = Math.max(c.end, start);
			if (end === start) keys[keys.length - 1] = [start, c.to, "hold"];
			else keys.push([end, c.to, c.ease]);
			value = c.to;
		}
		// Drop duplicate frames (a later key wins).
		const out: KeyframeTuple[] = [];
		for (const k of keys) {
			while (
				out.length > 0 &&
				(out[out.length - 1] as KeyframeTuple)[0] >= k[0]
			)
				out.pop();
			out.push(k);
		}
		return out;
	}
}
