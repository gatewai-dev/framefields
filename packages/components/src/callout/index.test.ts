import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { callout } from "./index.js";

const make = () => bind(fakeHost(), callout);
type Node = {
	id?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
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
const last = (n: Node | undefined, prop: string) => {
	const k = n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? [];
	return k[k.length - 1]?.value ?? 0;
};

describe("Callout", () => {
	it("opens toward the free side and stays inside the frame", () => {
		const left = make()({
			id: "c",
			target: [100, 900],
			text: "near the left bottom",
		});
		const label = find(left, "c-label");
		expect(last(label, "x")).toBeGreaterThan(100);
		expect(last(label, "y")).toBeLessThan(900);
		const corner = make()({
			id: "c",
			target: [1900, 20],
			text: "a long label pinned at the corner",
			side: "top-right",
		});
		const l2 = find(corner, "c-label");
		expect(last(l2, "x") + (l2?.width ?? 0)).toBeLessThanOrEqual(1920);
		expect(last(l2, "y")).toBeGreaterThanOrEqual(0);
	});

	it("follows a moving target for `length` frames", () => {
		const c = make()({
			id: "c",
			target: (f: number) => [200 + f * 5, 500],
			text: "moving",
			length: 60,
		});
		expect(c.span.duration).toBe(60);
		expect(last(find(c, "c-dot"), "x")).toBeCloseTo(200 + 60 * 5 - 7, 0);
	});
});
