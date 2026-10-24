import type { KeyframeTuple } from "@framefields/compositions/program";
import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { wordCycle } from "./index.js";

const make = () => bind(fakeHost(), wordCycle);
type Node = {
	id?: string;
	x?: number;
	width?: number;
	opacity?: number;
	children?: Node[];
	animation?: {
		tracks: Array<{
			prop: string;
			keyframes: Array<{ frame: number; value: number }>;
		}>;
	};
};
const find = (n: unknown, id: string): Node | undefined => {
	const node = n as Node;
	if (node.id === id) return node;
	for (const c of node.children ?? []) {
		const hit = find(c, id);
		if (hit) return hit;
	}
	return undefined;
};
const keys = (n: Node | undefined, prop: string) =>
	(n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? []).map(
		(k) => [k.frame, k.value] as KeyframeTuple,
	);
const at = (k: KeyframeTuple[], f: number) =>
	[...k].reverse().find((key) => (key[0] as number) <= f)?.[1] as number;

// Fake measure: 0.5 em per glyph at 96 px → 48 px a glyph, a space is 48.
const G = 48;

describe("WordCycle", () => {
	it("keeps one space between the slot and the text after it, at rest", () => {
		const w = make()({
			id: "w",
			text: "Make {} today",
			words: ["it", "videos", "a"],
			every: 60,
		});
		const slot = find(w, "w-slot");
		const after = find(w, "w-after");
		for (const [i, len] of [2, 6, 1].entries()) {
			// Settled frames: just before the next change, and after the last.
			const f = i < 2 ? (i + 1) * 60 - 1 : 400;
			const slotRight = at(keys(slot, "x"), f) + at(keys(slot, "width"), f);
			expect(at(keys(slot, "width"), f)).toBeCloseTo(len * G, 5);
			expect(at(keys(after, "x"), f) - slotRight).toBeCloseTo(G, 5);
		}
		// The root fits the longest line: "Make" + space + "videos" + space + "today".
		expect(w.width).toBeCloseTo((4 + 1 + 6 + 1 + 5) * G, 5);
	});

	it("re-centres the line for centred text", () => {
		const w = make()({
			id: "w",
			text: "Make {} today",
			words: ["it", "videos"],
			align: "center",
		});
		const before = find(w, "w-before");
		// Word 0 is 4 glyphs shorter than the longest: the line starts 2 in.
		expect(before?.x).toBeCloseTo(2 * G, 5);
		expect(keys(before, "x").at(-1)?.[1]).toBeCloseTo(0, 5);
	});

	it("shows one word at rest and cues every change", () => {
		const w = make()({
			id: "w",
			text: "{} works",
			words: ["it", "this", "that"],
			every: 40,
			cycles: 2,
		});
		expect(w.cues.changes.map((c) => c.frame)).toEqual([40, 80, 120, 160, 200]);
		expect(w.cues.changes.map((c) => c.word)).toEqual([
			"this",
			"that",
			"it",
			"this",
			"that",
		]);
		const visible = (f: number) =>
			[0, 1, 2].filter((i) => {
				const n = find(w, `w-word-${i}`);
				const o = keys(n, "opacity");
				return (
					(o.length ? at(o, f) : (n?.opacity ?? 1)) > 0 &&
					at(keys(n, "y"), f) === 0
				);
			});
		expect(visible(20)).toEqual([0]);
		expect(visible(70)).toEqual([1]);
		expect(visible(300)).toEqual([2]);
		expect(w.span.end).toBe(Number.POSITIVE_INFINITY);
	});

	it("types: deletes, then types the next word", () => {
		const w = make()({
			id: "w",
			text: "{}",
			words: ["ab", "xyz"],
			transition: "type",
			every: 60,
		});
		const reveal = keys(find(w, "w-word-1"), "text");
		expect(reveal.at(-1)?.[1]).toBe(1);
		const slotW = keys(find(w, "w-slot"), "width");
		expect(slotW.at(-1)?.[1]).toBeCloseTo(3 * G, 5);
	});

	it("rejects a line without one slot", () => {
		expect(() => make()({ text: "no slot", words: ["a", "b"] })).toThrow(
			/slot/,
		);
	});
});
