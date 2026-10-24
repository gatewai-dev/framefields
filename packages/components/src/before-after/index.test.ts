import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { beforeAfter } from "./index.js";

const make = () => bind(fakeHost(), beforeAfter);
type Key = { frame: number; value: number };
type Node = {
	id?: string;
	x?: number;
	width?: number;
	height?: number;
	opacity?: number;
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
const keys = (n: Node | undefined, prop: string) =>
	n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? [];

describe("BeforeAfter", () => {
	it("clips the before side to the divider", () => {
		const b = make()({
			id: "b",
			before: [],
			after: [],
			width: 1000,
			height: 500,
			split: [
				[0, 0.2],
				[30, 0.8, "power2.inOut"],
			],
		});
		const clip = keys(find(b, "b-before-clip"), "width");
		const divider = keys(find(b, "b-divider"), "x");
		expect(clip.map((k) => k.value)).toEqual([200, 800]);
		// The divider's centre rides the clip's edge.
		const w = find(b, "b-divider")?.width ?? 0;
		expect(divider.map((k) => k.value + w / 2)).toEqual([200, 800]);
		// Both sides are laid out at the full size.
		expect(find(b, "b-before")?.width).toBe(1000);
		expect(find(b, "b-after")?.width).toBe(1000);
		expect(b.cues.settled[0]?.frame).toBe(30);
	});

	it("fades a label as the divider covers it", () => {
		const b = make()({
			id: "b",
			before: [],
			after: [],
			width: 1000,
			height: 500,
			split: [
				[0, 0.5],
				[30, 0],
			],
		});
		const label = keys(find(b, "b-label-0"), "opacity");
		expect(label[0]?.value).toBe(1);
		expect(label.at(-1)?.value).toBe(0);
		expect(keys(find(b, "b-label-1"), "opacity").at(-1)?.value).toBe(1);
	});

	it("splits vertically and holds a static split", () => {
		const b = make()({
			id: "b",
			before: [],
			after: [],
			height: 400,
			direction: "vertical",
			split: 0.25,
		});
		expect(find(b, "b-before-clip")?.height).toBe(100);
		expect(keys(find(b, "b-before-clip"), "height")).toEqual([]);
		expect(b.span.end).toBe(Number.POSITIVE_INFINITY);
	});
});
