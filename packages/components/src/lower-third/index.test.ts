import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { lowerThird } from "./index.js";

const make = () => bind(fakeHost(), lowerThird);
type Node = {
	id?: string;
	x?: number;
	y?: number;
	width?: number;
	children?: Node[];
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

describe("LowerThird", () => {
	it("measures the plate to the text plus padding", () => {
		// Fake measure: 0.5 em per glyph. Name 44 px → 22 px a glyph.
		const short = find(make()({ id: "l", name: "Ada" }), "l-plate");
		const long = find(make()({ id: "l", name: "Ada Lovelace" }), "l-plate");
		expect((long?.width ?? 0) - (short?.width ?? 0)).toBeCloseTo(9 * 22, 5);
	});

	it("sits on the safe area's right edge on the right side", () => {
		const plate = find(
			make()({ id: "l", name: "Ada", role: "Engineer", side: "right" }),
			"l-plate",
		);
		expect((plate?.x ?? 0) + (plate?.width ?? 0)).toBeCloseTo(1920 * 0.94, 5);
	});

	it("leaves on its own after the hold, or stays", () => {
		const l = make()({ name: "Ada", hold: 30 });
		const inAt = l.cues.in[0]?.frame ?? 0;
		expect(l.cues.out[0]?.frame).toBe(inAt + 30);
		expect(l.span.duration).toBeGreaterThan(inAt + 30);
		const stays = make()({ name: "Ada", stay: true });
		expect(stays.span.end).toBe(Number.POSITIVE_INFINITY);
		expect(stays.cues.out).toEqual([]);
	});
});
