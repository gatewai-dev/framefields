import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { transformPathData } from "../core/path.js";
import { fakeHost } from "../test/fake-host.js";
import { logoReveal } from "./index.js";

const make = () => bind(fakeHost(), logoReveal);
type Node = {
	id?: string;
	kind?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	startFrame?: number;
	d?: string;
	children?: Node[];
	animation?: {
		tracks: Array<{
			prop: string;
			keyframes: Array<{ frame: number; value: unknown }>;
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
const last = (n: Node | undefined, prop: string) => {
	const keys = n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes;
	return keys?.[keys.length - 1]?.value as number | undefined;
};
const MARK = {
	d: "M0 0 L10 0 L10 10 Z",
	viewBox: [10, 10] as [number, number],
};

describe("LogoReveal", () => {
	it("centres the lockup in its box, in both layouts", () => {
		// Fake measure: 0.5 em per glyph → "abcd" at 120 px is 240 wide.
		const row = make()({ id: "l", mark: MARK, name: "abcd" });
		const gap = 120 * 0.32;
		expect(row.width).toBeCloseTo(150 + gap + 240, 5);
		expect(find(row, "l-name-clip")?.x).toBeCloseTo(150 + gap, 5);
		// The mark settles at the left edge, vertically centred.
		const mark = find(row, "l-mark");
		expect(last(mark, "x")).toBe(0);
		expect(mark?.y).toBeCloseTo(((row.height as number) - 150) / 2, 5);

		const stack = make()({
			id: "s",
			mark: MARK,
			name: "abcd",
			layout: "stack",
		});
		expect(stack.width).toBe(240);
		expect(last(find(stack, "s-mark"), "y")).toBe(0);
		expect(find(stack, "s-mark")?.x).toBeCloseTo((240 - 150) / 2, 5);
		expect(find(stack, "s-name-clip")?.x).toBeCloseTo(0, 5);
	});

	it("slide: the name waits for the glide, behind the mark", () => {
		const l = make()({ id: "l", mark: MARK, name: "abcd" });
		const name = find(l, "l-name");
		const glideStart = find(l, "l-mark")
			?.animation?.tracks.find((t) => t.prop === "x")
			?.keyframes.find((k) => k.frame > 0)?.frame;
		expect(name?.startFrame).toBe(glideStart);
		// Starts left of its clip (hidden), lands at 0.
		expect(name?.x).toBeLessThan(0);
		expect(last(name, "x")).toBe(0);
		// The mark is drawn last, over the name.
		const stage = (l.children as Node[])[0] as Node;
		expect(stage.children?.[stage.children.length - 1]?.id).toBe("l-mark");
	});

	it("orders its cues and stays after the glint", () => {
		const l = make()({ mark: MARK, name: "abcd", tagline: "tag" });
		const hit = l.cues.hit[0]?.frame ?? 0;
		const revealed = l.cues.revealed[0]?.frame ?? 0;
		const glint = l.cues.glint[0]?.frame ?? 0;
		expect(hit).toBeLessThanOrEqual(revealed);
		expect(glint).toBeGreaterThan(revealed);
		expect(l.span.end).toBe(Number.POSITIVE_INFINITY);
		expect(make()({ name: "abcd", glint: false }).cues.glint).toEqual([]);
	});

	it("draws a path mark in, settling where pop does", () => {
		const draw = make()({ id: "a", mark: MARK, name: "ab", style: "draw" });
		const pop = make()({ id: "a", mark: MARK, name: "ab", style: "pop" });
		const outline = find(draw, "a-mark-outline");
		expect(last(outline, "trimEnd")).toBe(1);
		expect(last(outline, "opacity")).toBe(0);
		expect(find(draw, "a-mark-fill")?.d).toBe(find(pop, "a-mark-fill")?.d);
		expect(find(draw, "a-mark")?.x).toBe(find(pop, "a-mark")?.x);
		// An image mark can't draw on: it pops.
		const image = make()({ id: "i", mark: "logo.png", style: "draw" });
		expect(find(image, "i-mark-outline")).toBeUndefined();
		expect(find(image, "i-mark-image")).toBeDefined();
	});

	it("extrudes the name when given depth", () => {
		const l = make()({ id: "l", name: "abcd", depth: 40, material: "chrome" });
		const name = find(l, "l-name") as Node & {
			depth?: number;
			metallic?: number;
		};
		expect(name.kind).toBe("model");
		expect(name.depth).toBe(40);
		expect(name.metallic).toBe(1);
		expect(last(name, "rotateY")).toBe(0);
		expect(l.cues.glint).toEqual([]);
	});

	it("needs a mark or a name", () => {
		expect(() => make()({})).toThrow(/mark.*name/);
	});
});

describe("transformPathData", () => {
	it("scales relative commands and arcs without offsetting them", () => {
		expect(transformPathData("M1 1 l2 0 h1 v-1 z", 2, 10, 20)).toBe(
			"M12 22l4 0h2v-2z",
		);
		expect(
			transformPathData("M0 0 A5 5 30 0 1 10 10 a1 2 0 1 0 3 4", 2, 1, 1),
		).toBe("M1 1A10 10 30 0 1 21 21a2 4 0 1 0 6 8");
	});
});
