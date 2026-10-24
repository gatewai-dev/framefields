import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { rangeRects } from "../core/text.js";
import { fakeHost, fakeMeasure } from "../test/fake-host.js";
import { selection } from "./index.js";

const make = () => bind(fakeHost(), selection);
type Key = { frame: number; value: number };
type Node = {
	id?: string;
	x?: number;
	y?: number;
	width?: number;
	children?: Node[];
	animation?: { tracks: Array<{ prop: string; keyframes: Key[] }> };
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
const track = (n: Node | undefined, prop: string) =>
	n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? [];
const valueAt = (keys: Key[], f: number) =>
	[...keys].reverse().find((k) => k.frame <= f)?.value ?? 0;

// Fake measure: 20 px glyphs at 40 px; lines 48 px tall.
const text = {
	kind: "text",
	id: "t",
	text: "select these words now",
	x: 100,
	y: 200,
	fontSize: 40,
	fontFamily: "Inter",
	width: 260,
};

describe("Selection", () => {
	it("ends on the glyph boundary nearest the pointer", () => {
		// The pointer sweeps from the start of the text, 15 px a frame, on line 0.
		const pointer = {
			positionAt: (f: number): [number, number] => [100 + (f - 10) * 15, 220],
			cues: { drags: [{ frame: 10, end: 30 }] },
		};
		const sel = make()({
			id: "s",
			target: { text, match: "select these" },
			pointer,
		});
		const line = find(sel, "s-line-0");
		expect(line?.x).toBe(100);
		// Frame 17: pointer at 205 px → 5.25 glyphs in → boundary 5.
		expect(valueAt(track(line, "width"), 17)).toBe(100);
		// Frame 30: pointer at 400, past the line's end (340) → its whole width.
		expect(valueAt(track(line, "width"), 30)).toBe(240);
		expect(sel.cues.selected[0]?.frame).toBe(30);
	});

	it("draws one rect per line, matching rangeRects", () => {
		const sel = make()({
			id: "s",
			target: { text },
			drag: { frame: 0, end: 20 },
		});
		const options = { fontFamily: "Inter", fontSize: 40, width: 260 };
		const rects = rangeRects(
			fakeMeasure(text.text, options),
			0,
			text.text.length,
			options,
		);
		expect(rects.length).toBeGreaterThan(1);
		rects.forEach((r, i) => {
			const line = find(sel, `s-line-${i}`);
			expect(line?.x).toBe(100 + r.x);
			expect(track(line, "width").at(-1)?.value).toBeCloseTo(r.width, 6);
		});
	});

	it("marquee: lights items as the box covers them", () => {
		const sel = make()({
			id: "s",
			kind: "marquee",
			from: [0, 0],
			to: [400, 400],
			drag: { frame: 0, end: 40 },
			items: [
				{ x: 50, y: 50, width: 20, height: 20 },
				{ x: 350, y: 350, width: 20, height: 20 },
				{ x: 900, y: 900, width: 20, height: 20 },
			],
		});
		expect(sel.cues.items.map((c) => c.index)).toEqual([0, 1]);
		const [a, b] = sel.cues.items.map((c) => c.frame) as [number, number];
		expect(a).toBeLessThan(b);
		expect(track(find(sel, "s-item-2"), "opacity").at(-1)?.value ?? 0).toBe(0);
		expect(track(find(sel, "s-marquee"), "opacity").at(-1)?.value).toBe(0);
	});

	it("needs a drag", () => {
		expect(() => make()({ target: { text } })).toThrow(/drag/);
	});
});
