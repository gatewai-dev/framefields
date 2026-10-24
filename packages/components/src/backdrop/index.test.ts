import type { KeyframeTuple } from "@framefields/compositions/program";
import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { evaluateEase } from "../core/ease.js";
import { fakeHost } from "../test/fake-host.js";
import { backdrop, cosineKeys, slideKeys } from "./index.js";

const make = () => bind(fakeHost(), backdrop);

/** Evaluate keys the way the renderer does (destination key's ease). */
function valueAt(keys: readonly KeyframeTuple[], f: number): number {
	const first = keys[0] as KeyframeTuple;
	if (f <= first[0]) return first[1] as number;
	for (let i = 0; i < keys.length - 1; i++) {
		const [f0, v0] = keys[i] as KeyframeTuple;
		const [f1, v1, e] = keys[i + 1] as KeyframeTuple;
		if (f >= f0 && f <= f1) {
			const t = evaluateEase(e as string | undefined, (f - f0) / (f1 - f0));
			return (v0 as number) + ((v1 as number) - (v0 as number)) * t;
		}
	}
	return keys[keys.length - 1]?.[1] as number;
}

type Node = {
	id?: string;
	kind?: string;
	children?: Node[];
	matte?: { node: Node };
	animation?: {
		tracks: Array<{
			prop: string;
			keyframes: Array<{ frame: number; value: number }>;
		}>;
	};
};
const all = (n: Node, out: Node[] = []): Node[] => {
	out.push(n);
	for (const c of n.children ?? []) all(c, out);
	return out;
};

describe("loop keys", () => {
	it("cosine keys are exactly periodic and follow the cosine", () => {
		const loop = 300;
		const keys = cosineKeys(100, 50, 2, 1.1, loop, loop * 6);
		for (const f of [0, 13, 77, 150, 299]) {
			expect(valueAt(keys, f + loop)).toBeCloseTo(valueAt(keys, f), 6);
			expect(valueAt(keys, f + loop * 4)).toBeCloseTo(valueAt(keys, f), 6);
		}
		// Between extremes it is the cosine (within rounding of extreme frames);
		// the partial pieces at the loop seam are close, not exact.
		const exact = (f: number) =>
			100 + 50 * Math.cos((2 * Math.PI * 2 * f) / loop + 1.1);
		const extremes = keys.slice(1, 5).map((k) => k[0] as number);
		for (let f = 0; f < loop; f += 3) {
			const inner =
				f >= (extremes[0] as number) &&
				f <= (extremes[extremes.length - 1] as number);
			expect(Math.abs(valueAt(keys, f) - exact(f))).toBeLessThan(
				inner ? 0.6 : 4,
			);
		}
		expect(keys.length).toBeLessThanOrEqual(120);
	});

	it("loops through long scenes, with a bound on very long ones", () => {
		// 300 loops of 30 frames: the old 120-key cap stopped after ~24.
		const long = cosineKeys(0, 10, 2, 0.3, 30, 30 * 150);
		expect(long.at(-1)?.[0]).toBe(30 * 150);
		expect(
			cosineKeys(0, 10, 2, 0.3, 30, 30 * 10_000).length,
		).toBeLessThanOrEqual(961);
		expect(slideKeys(0, 10, 30, 30 * 10_000).length).toBeLessThanOrEqual(961);
	});

	it("slides one cell a loop and snaps back on the loop frame", () => {
		const keys = slideKeys(-64, 64, 100, 300);
		expect(valueAt(keys, 0)).toBe(-64);
		expect(valueAt(keys, 50)).toBeCloseTo(-32, 5);
		expect(valueAt(keys, 100)).toBe(-64);
		expect(valueAt(keys, 150)).toBeCloseTo(valueAt(keys, 50), 6);
	});
});

describe("Backdrop", () => {
	it("is open-ended, covers the frame and grains its surface", () => {
		const b = make()({ id: "b" });
		expect(b.span.end).toBe(Number.POSITIVE_INFINITY);
		expect(b.width).toBe(1920);
		const grain = all(b as unknown as Node).find((n) => n.id === "b-grain") as
			| (Node & { strength?: number })
			| undefined;
		expect(grain?.strength).toBe(35);
		expect(
			all(b as unknown as Node).filter((n) => n.id?.match(/^b-blob-\d$/))
				.length,
		).toBe(4);
		const off = make()({ id: "b", grain: false, vignette: 0 });
		const nodes = all(off as unknown as Node);
		expect(nodes.find((n) => n.id === "b-grain")).toBeUndefined();
		expect(nodes.find((n) => n.id === "b-vignette")).toBeUndefined();
	});

	it("keys motion for the window in whole loops", () => {
		const b = make()({ id: "b", loop: 100, duration: 250 });
		expect(b.cues.loops.map((c) => c.frame)).toEqual([0, 100, 200]);
	});

	it("seeds blob phases", () => {
		const y = (seed: number) =>
			all(make()({ id: "b", seed }) as unknown as Node)
				.find((n) => n.id === "b-blob-0")
				?.animation?.tracks.find((t) => t.prop === "y")?.keyframes;
		expect(JSON.stringify(y(1))).toBe(JSON.stringify(y(1)));
		expect(JSON.stringify(y(1))).not.toBe(JSON.stringify(y(2)));
	});

	it("lights the grid through a drifting matte", () => {
		const nodes = all(make()({ id: "g", kind: "grid" }) as unknown as Node);
		const lit = nodes.find((n) => n.id === "g-pattern-lit");
		expect(lit?.matte?.node.id).toBe("g-glow-matte");
		expect(nodes.find((n) => n.id === "g-pattern")).toBeDefined();
		const plain = all(
			make()({ id: "g", kind: "dots", glow: false }) as unknown as Node,
		);
		expect(plain.find((n) => n.id === "g-pattern-lit")).toBeUndefined();
	});
});
