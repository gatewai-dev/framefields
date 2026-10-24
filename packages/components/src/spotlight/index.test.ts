import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { spotlight } from "./index.js";

const make = () => bind(fakeHost(), spotlight);
type Node = {
	id?: string;
	children?: Node[];
	matte?: { node: Node; mode: string };
	animation?: {
		tracks: Array<{
			prop: string;
			keyframes: Array<{ frame: number; value: number }>;
		}>;
	};
};
const keys = (n: Node | undefined, prop: string) =>
	(n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? []).map(
		(k) => [k.frame, k.value],
	);

describe("Spotlight", () => {
	it("dims through an inverted matte whose hole glides between targets", () => {
		const s = make()({
			id: "s",
			glide: 10,
			targets: [
				{
					at: 0,
					target: { x: 100, y: 100, width: 50, height: 50 },
					padding: 0,
				},
				{
					at: 30,
					target: { x: 400, y: 200, width: 50, height: 50 },
					padding: 0,
				},
			],
		});
		const dim = ((s as unknown as Node).children?.[0]?.children ??
			[])[0] as Node;
		expect(dim.matte?.mode).toBe("alpha-inverted");
		expect(keys(dim.matte?.node, "x")).toEqual([
			[0, 100],
			[30, 100],
			[40, 400],
		]);
		expect(keys(dim, "opacity").at(-1)).toEqual([10, 0.68]);
		expect(s.cues.moves).toEqual([
			{ frame: 0, end: 10 },
			{ frame: 30, end: 40 },
		]);
	});

	it('lifts the dim on "full"', () => {
		const s = make()({
			glide: 8,
			targets: [
				{ at: 0, target: [10, 10] },
				{ at: 40, target: "full" },
			],
		});
		const dim = ((s as unknown as Node).children?.[0]?.children ??
			[])[0] as Node;
		expect(keys(dim, "opacity").at(-1)).toEqual([48, 0]);
	});
});
