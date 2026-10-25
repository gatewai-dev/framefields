import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { cardStack, SHRINK } from "./index.js";

const make = () => bind(fakeHost(), cardStack);
type Key = { frame: number; value: number };
type Node = {
	id?: string;
	y?: number;
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
const valueAt = (n: Node | undefined, prop: string, f: number) => {
	const keys =
		n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? [];
	return [...keys].reverse().find((k) => k.frame <= f)?.value ?? keys[0]?.value;
};
const cards = ["a", "b", "c", "d"].map((title) => ({ title }));

describe("CardStack", () => {
	it("rests with the front card last, unscaled, and the rest stepped back", () => {
		const st = make()({ id: "s", cards, tilt: false });
		const stage = (st.children as Node[])[0] as Node;
		expect(stage.children?.at(-1)?.id).toBe("s-card-0");
		expect(valueAt(find(st, "s-card-0"), "scale", 0)).toBe(1);
		const y0 = valueAt(find(st, "s-card-0"), "y", 0) as number;
		for (const k of [1, 2]) {
			expect(valueAt(find(st, `s-card-${k}`), "scale", 0)).toBeCloseTo(
				1 - SHRINK * k,
				6,
			);
			expect(
				y0 - (valueAt(find(st, `s-card-${k}`), "y", 0) as number),
			).toBeCloseTo(26 * k, 6);
		}
		// A card behind shows only the strip above the card in front.
		const clip = valueAt(find(st, "s-card-1-clip"), "height", 0) as number;
		expect(clip).toBeCloseTo(26 / (1 - SHRINK), 3);
	});

	it("returns to the starting order after a full cycle", () => {
		const st = make()({ id: "s", cards, every: 40 });
		const end = st.span.duration;
		expect(Number.isFinite(end)).toBe(false); // open-ended
		const settle = (st.cues.changes.at(-1)?.frame ?? 0) + 60;
		for (const [c] of cards.entries())
			for (const prop of ["y", "scale"])
				expect(valueAt(find(st, `s-card-${c}`), prop, settle)).toBeCloseTo(
					valueAt(find(st, `s-card-${c}`), prop, 0) as number,
					6,
				);
		expect(st.cues.changes.map((c) => c.index)).toEqual([1, 2, 3, 0]);
	});

	it("deals cards on top, in order", () => {
		const st = make()({ id: "s", cards, mode: "deal", every: 30, tilt: false });
		const stage = (st.children as Node[])[0] as Node;
		expect(stage.children?.at(-1)?.id).toBe("s-card-3");
		expect(valueAt(find(st, "s-card-3"), "opacity", 10)).toBe(0);
		expect(valueAt(find(st, "s-card-3"), "scale", 200)).toBe(1);
		expect(valueAt(find(st, "s-card-0"), "scale", 200)).toBeCloseTo(
			1 - SHRINK * 3,
			6,
		);
		expect(st.cues.changes.map((c) => c.index)).toEqual([1, 2, 3]);
	});

	it("shows the next card whole as soon as the front one starts leaving", () => {
		const st = make()({ id: "s", cards, every: 40, tilt: false });
		const clip = find(st, "s-card-1-clip");
		const strip = valueAt(clip, "height", 0) as number;
		expect(strip).toBeLessThan(60);
		// Whole (the card's height) from the frame after the move starts.
		expect(valueAt(clip, "height", 41)).toBe(400);
		expect(valueAt(clip, "height", 60)).toBe(400);
	});

	it("leaves by flying, dropping, zooming or flipping", () => {
		const at = (leave: "fly" | "drop" | "zoom" | "flip", prop: string) => {
			const st = make()({ id: "s", cards, every: 40, tilt: false, leave });
			const card = find(st, "s-card-0");
			const y0 = valueAt(card, prop, 0) as number;
			const keys =
				card?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? [];
			// The furthest it gets from rest during its exit.
			return Math.max(
				...keys
					.filter((k) => k.frame > 40 && k.frame < 80)
					.map((k) => k.value - y0),
			);
		};
		expect(at("drop", "y")).toBeGreaterThan(100);
		expect(at("zoom", "scale")).toBeGreaterThan(0.15);
		expect(at("flip", "rotateX")).toBeGreaterThan(80);
		expect(at("fly", "x")).toBeLessThanOrEqual(0); // flies left
	});

	it("fans out into a hand and gathers again", () => {
		const st = make()({ id: "s", cards, mode: "fan", every: 40, tilt: false });
		expect(st.cues.changes.map((c) => c.frame)).toEqual([40, 80]);
		const spread = 75;
		const xs = cards.map(
			(_, c) => valueAt(find(st, `s-card-${c}`), "x", spread) as number,
		);
		for (let c = 1; c < xs.length; c++)
			expect(xs[c]).toBeGreaterThan(xs[c - 1] as number);
		const rot = (c: number, f: number) =>
			valueAt(find(st, `s-card-${c}`), "rotation", f) as number;
		expect(rot(0, spread)).toBeLessThan(0);
		expect(rot(3, spread)).toBeGreaterThan(0);
		// Every card shows in the fan, even past `visible`.
		const many = make()({
			id: "m",
			cards: [...cards, ...cards],
			mode: "fan",
			every: 40,
			visible: 2,
		});
		expect(valueAt(find(many, "m-card-7"), "opacity", 79)).toBe(1);
		// Gathered: back to the stack.
		expect(valueAt(find(st, "s-card-2"), "x", 200)).toBe(
			valueAt(find(st, "s-card-2"), "x", 0) ?? xs[2],
		);
		expect(rot(3, 200)).toBe(0);
	});
});
