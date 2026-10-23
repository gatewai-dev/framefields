import type { LayoutNode } from "@framefields/compositions/program";
import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { annotate } from "./index.js";

const make = () => bind(fakeHost(), annotate);
type Node = LayoutNode & {
	d?: string;
	strokeWidth?: number;
	animation?: {
		tracks: Array<{
			prop: string;
			keyframes: Array<{
				frame: number;
				value: unknown;
				ease?: { name: string };
			}>;
		}>;
	};
};
const strokes = (n: unknown) =>
	(
		(n as { children: Array<{ children: Node[] }> }).children[0]?.children ?? []
	).filter((c) => (c.id ?? "").includes("stroke"));
const keys = (n: Node, prop: string) =>
	n.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? [];
const ys = (d = "") =>
	[...d.matchAll(/[ML]\s*[-\d.]+\s+([-\d.]+)/g)].map((m) => Number(m[1]));

// Wraps after "aaaa bbbb" at 100 px (10 px glyphs in the fake measure).
const text = {
	kind: "text",
	id: "t",
	text: "aaaa bbbb cccc",
	x: 0,
	y: 0,
	width: 100,
	fontSize: 20,
	fontFamily: "Inter",
};

describe("Annotate", () => {
	it("underlines a wrapped phrase with one stroke per line, under each baseline", () => {
		const a = make()({
			target: { text, match: "bbbb cccc" },
			mark: "underline",
			hand: false,
			padding: 8,
		});
		const s = strokes(a);
		expect(s).toHaveLength(2);
		const [y0, y1] = s.map((n) => ys(n.d)[0] as number);
		// Lines are 24 px tall: baseline ≈ 0.84 of it, plus 40 % of the padding.
		expect(y0).toBeCloseTo(24 * 0.84 + 3.2, 1);
		expect((y1 as number) - (y0 as number)).toBeCloseTo(24, 5);
	});

	it("draws strokes one after another and reports when it's drawn", () => {
		const a = make()({
			target: { text, match: "bbbb cccc" },
			hand: false,
			drawDuration: 20,
		});
		const [first, second] = strokes(a).map((n) => keys(n, "trimEnd"));
		expect(first?.[0]?.frame).toBe(0);
		expect(second?.[0]?.frame).toBe(first?.[1]?.frame);
		expect(a.cues.drawn[0]?.frame).toBe(20);
	});

	it("boils hand-drawn marks on a fixed beat, the same for the same seed", () => {
		const make1 = () =>
			make()({
				target: { x: 0, y: 0, width: 100, height: 40 },
				mark: "circle",
				hand: { wobble: 1, boil: 4 },
				seed: 3,
			});
		const d = keys(strokes(make1())[0] as Node, "d");
		expect(d.slice(0, 4).map((k) => k.frame)).toEqual([0, 4, 8, 12]);
		expect(d.every((k) => k.ease?.name === "hold")).toBe(true);
		expect(d.map((k) => k.value)).toEqual(
			keys(strokes(make1())[0] as Node, "d").map((k) => k.value),
		);
	});

	it("points arrows from `from` and keeps the tail inside its box", () => {
		const a = make()({
			target: { x: 100, y: 100, width: 50, height: 50 },
			mark: "arrow",
			from: [600, 500],
		});
		expect(a.part("head")).toBeDefined();
		const shaft = a.part("stroke-0") as unknown as {
			width: number;
			height: number;
		};
		expect(shaft.width).toBeGreaterThan(600);
		expect(shaft.height).toBeGreaterThan(500);
		expect(() => make()({ target: [0, 0], mark: "arrow" })).toThrow(
			/needs `from`/,
		);
	});

	it("labels after drawing, stays up, and refuses moving targets", () => {
		const a = make()({
			target: { x: 200, y: 200, width: 80, height: 30 },
			mark: "box",
			label: "note",
		});
		expect(a.cues.labelIn[0]?.frame).toBeLessThanOrEqual(
			a.cues.drawn[0]?.frame ?? 0,
		);
		expect(a.span.end).toBe(Number.POSITIVE_INFINITY);
		expect(() => make()({ target: () => [0, 0] })).toThrow(/must be static/);
	});
});
