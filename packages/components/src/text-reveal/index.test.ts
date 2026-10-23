import type { LayoutNode } from "@framefields/compositions/program";
import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { evaluateGlyphExpression, type GlyphAnimator } from "../core/glyphs.js";
import { fakeHost } from "../test/fake-host.js";
import { textReveal } from "./index.js";

const make = () => bind(fakeHost(), textReveal);

type Node = LayoutNode & {
	animators?: GlyphAnimator[];
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
	children?: Node[];
};
const find = (root: unknown, id: string): Node | undefined => {
	const n = root as Node;
	if (n.id === id) return n;
	for (const c of n.children ?? []) {
		const hit = find(c, id);
		if (hit) return hit;
	}
	return undefined;
};
/** A track as `[frame, value, ease?]` tuples. */
const track = (n: Node | undefined, prop: string) =>
	(n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? []).map(
		(k) => (k.ease ? [k.frame, k.value, k.ease.name] : [k.frame, k.value]),
	);
const weight = (a: GlyphAnimator, frame: number, i: number) =>
	evaluateGlyphExpression(a.selectors[0]?.expression ?? "0", {
		frame,
		textIndex: i,
		wordIndex: i,
		lineIndex: i,
	});

describe("TextReveal", () => {
	it("rises word by word and rests exactly on the static text", () => {
		const t = make()({ id: "t", text: "Ship it faster", fontSize: 40 });
		expect(t.cues.units.map((u) => u.text)).toEqual(["Ship", "it", "faster"]);
		const revealed = t.cues.revealed[0]?.frame ?? 0;
		expect(revealed).toBe(Math.max(...t.cues.units.map((u) => u.settled)));
		const enter = find(t, "t-text")?.animators?.find((a) => a.name === "enter");
		expect(enter?.props).toMatchObject({ opacity: 0 });
		// Every unit fully pushed at frame 0, at rest once revealed.
		for (const i of [0, 1, 2]) {
			expect(weight(enter as GlyphAnimator, 0, i)).toBe(1);
			expect(weight(enter as GlyphAnimator, revealed, i)).toBe(0);
		}
	});

	it("stays on screen unless an exit is asked for", () => {
		const still = make()({ text: "Hello" });
		expect(still.span.end).toBe(Number.POSITIVE_INFINITY);
		const faded = make()({ text: "Hello", exit: "fade", hold: 10 });
		expect(faded.span.end).toBeLessThan(Number.POSITIVE_INFINITY);
	});

	it("plays its own exit after the hold", () => {
		const t = make()({ id: "t", text: "one two", exitStyle: "rise", hold: 20 });
		const revealed = t.cues.revealed[0]?.frame ?? 0;
		const exitStart = t.cues.exitStart[0]?.frame ?? 0;
		expect(exitStart).toBe(revealed + 20);
		const exit = find(t, "t-text")?.animators?.find((a) => a.name === "exit");
		expect(exit?.props.y).toBeLessThan(0);
		expect(weight(exit as GlyphAnimator, exitStart, 0)).toBe(0);
		expect(weight(exit as GlyphAnimator, t.span.duration, 1)).toBe(1);
		expect(t.span.duration).toBeGreaterThan(exitStart);
	});

	it("types with key cues, a caret, and count keys", () => {
		const t = make()({ id: "t", text: "ab c", style: "type" });
		expect(t.cues.keystrokes).toHaveLength(3);
		const keys = track(find(t, "t-text"), "text");
		expect(keys[keys.length - 1]?.[1]).toBe(4);
		// One character is a fraction (1 would mean "all of it").
		expect(keys.map((k) => k[1])).toContain(0.25);
		expect(keys.map((k) => k[1])).not.toContain(1);
		expect(find(t, "t-caret")).toBeDefined();
	});

	it("masks line by line, and only a split text can exit by mask", () => {
		const t = make()({
			id: "t",
			text: "aaaa bbbb cccc",
			style: "mask",
			width: 100,
			fontSize: 20,
		});
		expect(t.cues.units).toHaveLength(2);
		expect(find(t, "t-line-0")).toBeDefined();
		expect(find(t, "t-line-1")).toBeDefined();
		expect(() =>
			make()({ text: "x", style: "rise", exitStyle: "mask" }),
		).toThrow(/needs style "mask"/);
	});

	it("scrambles deterministically and hands over to the real text", () => {
		const a = make()({ id: "t", text: "CODE", style: "scramble", seed: 7 });
		const b = make()({ id: "t", text: "CODE", style: "scramble", seed: 7 });
		const c = make()({ id: "t", text: "CODE", style: "scramble", seed: 8 });
		const reel = (n: unknown) =>
			(find(n, "t-reel-0") as { text?: string })?.text;
		expect(reel(a)).toBe(reel(b));
		expect(reel(a)).not.toBe(reel(c));
		expect(reel(a)?.endsWith("C")).toBe(true);
		const done = a.cues.revealed[0]?.frame ?? 0;
		expect(track(find(a, "t-text"), "opacity")).toEqual([
			[0, 0],
			[done, 1, "hold"],
		]);
	});

	it("slams words as their own nodes, then shows the paragraph", () => {
		const t = make()({ id: "t", text: "big bold words", style: "slam" });
		expect(find(t, "t-unit-2")).toBeDefined();
		const landed = Math.max(...t.cues.units.map((u) => u.settled));
		// At rest once the landing shake has died out.
		expect(t.cues.revealed[0]?.frame).toBeGreaterThan(landed);
		expect(track(find(t, "t-text"), "opacity")).toContainEqual([
			landed,
			1,
			"hold",
		]);
	});

	it("colours emphasis and exposes rects in parent coordinates", () => {
		const t = make()({
			id: "t",
			text: "go faster now",
			emphasis: ["faster"],
			x: 100,
			y: 50,
			fontSize: 20,
		});
		const em = find(t, "t-text")?.animators?.[0];
		expect(em?.name).toBe("emphasis");
		expect(weight(em as GlyphAnimator, 0, 3)).toBe(1);
		expect(weight(em as GlyphAnimator, 0, 0)).toBe(0);
		// 10 px per glyph in the fake measure: "faster" starts at index 3.
		expect(t.rects("faster")[0]).toMatchObject({ x: 130, y: 50, width: 60 });
	});

	it("fails loudly on unknown fonts and props", () => {
		expect(() => make()({ text: "x", fontFamily: "Nope" })).toThrow(
			/not registered. Registered: Inter/,
		);
		expect(() => make()({ text: "x", styel: "rise" } as never)).toThrow(
			/invalid props/,
		);
	});
});
