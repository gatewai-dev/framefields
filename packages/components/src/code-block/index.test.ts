import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { codeBlock } from "./index.js";

const make = () => bind(fakeHost(), codeBlock);
type Node = {
	id?: string;
	children?: Node[];
	spans?: Array<{ text: string; fill: string }>;
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
const track = (n: Node | undefined, prop: string) =>
	n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? [];

describe("CodeBlock", () => {
	it("colours tokens from the theme", () => {
		const c = make()({ id: "c", code: 'const a = "x";' });
		const spans = find(c, "c-line-0")?.spans ?? [];
		expect(spans.find((s) => s.text.includes("const"))?.fill).toBe("#b07cff");
		expect(spans.find((s) => s.text.includes('"x"'))?.fill).toBe("#3ecf8e");
	});

	it("sizes for the larger of before and after, so nothing reflows", () => {
		const small = make()({ code: "a" });
		const grown = make()({
			code: "a",
			diff: { to: "a\nbbbbbbbbbb\nc", at: 10 },
		});
		const size = (n: unknown) => n as { width: number; height: number };
		expect(size(grown).height).toBeGreaterThan(size(small).height);
		expect(size(grown).width).toBeGreaterThan(size(small).width);
	});

	it("moves kept lines, removes and adds the rest, and cues it", () => {
		const c = make()({
			id: "c",
			code: "a\nb\nc",
			diff: { to: "c\nd", at: 30, duration: 20 },
		});
		expect(c.cues.diff).toEqual([{ frame: 30, end: 50 }]);
		// "c" moves from row 2 to row 0.
		const ys = track(find(c, "c-line-2"), "y").map((k) => k.frame);
		expect(ys).toEqual([0, 30, 50]);
		expect(find(c, "c-added-1")).toBeDefined();
		const gone = track(find(c, "c-line-0"), "opacity");
		expect(gone[gone.length - 1]?.value).toBe(0);
	});

	it("types code with key cues, skipping indentation", () => {
		const c = make()({ code: "ab\n  c", typing: true });
		expect(c.cues.keystrokes.map((k) => k.line)).toEqual([1, 1, 2]);
		expect(c.cues.lines[1]?.frame).toBeGreaterThan(
			c.cues.keystrokes[1]?.frame ?? 0,
		);
	});

	it("dims unfocused lines and cues focus steps", () => {
		const c = make()({
			id: "c",
			code: "a\nb\nc",
			focus: [{ at: 10, lines: { from: 2, to: 3 } }],
		});
		expect(c.cues.focus).toEqual([{ frame: 10, lines: [2, 3] }]);
		const dim = track(find(c, "c-line-0"), "opacity");
		expect(dim[dim.length - 1]?.value).toBeCloseTo(0.32, 5);
		const lit = track(find(c, "c-line-1"), "opacity");
		expect(lit[lit.length - 1]?.value).toBe(1);
	});
});
