import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { confetti } from "./index.js";

type Node = {
	id?: string;
	kind?: string;
	children?: Node[];
	color?: unknown;
	seed?: number;
	floor?: number;
	emitter?: {
		x: number;
		y: number;
		bursts: Array<{ frame: number; count: number }>;
	};
};
const systems = (n: unknown): Node[] => {
	const out: Node[] = [];
	const walk = (x: Node) => {
		if (x.kind === "particles") out.push(x);
		for (const c of x.children ?? []) walk(c);
	};
	walk(n as Node);
	return out;
};

describe("Confetti", () => {
	it("one paper system per colour, plus ribbons and sparkles, sharing an origin", () => {
		const c = bind(
			fakeHost(),
			confetti,
		)({
			bursts: [
				{ at: 10, origin: [500, 900] },
				{ at: 40, origin: [500, 900] },
			],
			palette: ["#f00", "#0f0"],
		});
		const all = systems(c);
		expect(all).toHaveLength(4);
		expect(all[0]?.emitter?.bursts.map((b) => b.frame)).toEqual([10, 40]);
		expect(new Set(all.map((s) => s.seed)).size).toBe(4);
		expect(c.cues.bursts.map((b) => b.origin)).toEqual([
			[500, 900],
			[500, 900],
		]);
	});

	it("separate origins get their own systems; a floor lands them", () => {
		const c = bind(
			fakeHost(),
			confetti,
		)({
			bursts: [
				{ at: 0, origin: [100, 900] },
				{ at: 0, origin: [1800, 900] },
			],
			palette: ["#f00"],
			ribbons: false,
			sparkles: false,
			floor: true,
			height: 1000,
		});
		const all = systems(c);
		expect(all).toHaveLength(2);
		expect(all[0]?.floor).toBeCloseTo(994, 5);
	});
});
