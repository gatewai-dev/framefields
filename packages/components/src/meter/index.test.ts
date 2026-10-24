import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { meter } from "./index.js";

const make = () => bind(fakeHost(), meter);
type Node = {
	id?: string;
	children?: Node[];
	animation?: {
		tracks: Array<{
			prop: string;
			keyframes: Array<{
				frame: number;
				value: number;
				ease?: { name: string };
			}>;
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

describe("Meter", () => {
	it("fills to (value − from) / (max − from) on the value's own keys", () => {
		const m = make()({
			id: "m",
			values: [
				[0, 0],
				[30, 50, "power2.out"],
				[60, 25],
			],
		});
		const keys = track(find(m, "m-fill"), "trimEnd");
		expect(keys.map((k) => [k.frame, k.value])).toEqual([
			[0, 0],
			[30, 0.5],
			[60, 0.25],
		]);
		expect(keys[1]?.ease?.name).toBe("power2");
		expect(find(m, "m-counter")).toBeDefined();
	});

	it("bars fill their width; segments light as the value crosses them", () => {
		const bar = make()({
			id: "m",
			value: 40,
			kind: "bar",
			size: 500,
			countDuration: 30,
		});
		expect(track(find(bar, "m-fill"), "width").map((k) => k.value)).toEqual([
			0, 200,
		]);
		const seg = make()({
			value: 35,
			kind: "segments",
			segments: 10,
			countDuration: 30,
		});
		expect(seg.cues.crossings.map((c) => c.segment)).toEqual([0, 1, 2]);
	});

	it("fills 3.5 stars as three and a half", () => {
		const m = make()({
			id: "m",
			value: 3.5,
			kind: "stars",
			size: 300,
			countDuration: 30,
		});
		const width = (k: number) => {
			const keys = track(find(m, `m-star-${k}-clip`), "width");
			return keys[keys.length - 1]?.value ?? 0;
		};
		const cell = (300 - 300 * 0.03 * 4) / 5;
		expect(width(2)).toBeCloseTo(cell, 3);
		expect(width(3)).toBeCloseTo(cell / 2, 3);
		expect(width(4)).toBe(0);
		expect(m.cues.crossings).toHaveLength(3);
	});

	it("needs a value", () => {
		expect(() => make()({})).toThrow(/give `value`/);
	});
});
