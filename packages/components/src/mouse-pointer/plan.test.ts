import { describe, expect, it } from "vitest";
import { type PlanInput, planPointer, travelFrames } from "./plan.js";

const at = (x: number, y: number) => () => [x, y] as [number, number];

function input(over: Partial<PlanInput> = {}): PlanInput {
	return {
		waypoints: [{ point: at(100, 100) }, { point: at(900, 500), clicks: 1 }],
		fps: 30,
		style: "arrow",
		motion: "natural",
		speed: 1,
		drift: 0,
		seed: 1,
		hoverRegions: [],
		appear: 7,
		vanish: 7,
		...over,
	};
}

describe("planPointer", () => {
	it("travels by Fitts' law: longer moves take longer, never linearly", () => {
		const short = travelFrames(100, 30, "natural", 1);
		const long = travelFrames(1000, 30, "natural", 1);
		expect(long).toBeGreaterThan(short);
		expect(long).toBeLessThan(short * 3);
		expect(travelFrames(500, 30, "natural", 2)).toBeLessThan(
			travelFrames(500, 30, "natural", 1),
		);
	});

	it("lands exactly on the target and clicks after settling", () => {
		const plan = planPointer(input());
		const arrival = plan.cues.arrivals[1]?.frame ?? -1;
		expect(plan.positions[arrival]).toEqual([900, 500]);
		const click = plan.cues.clicks[0];
		expect(click?.frame).toBe(arrival + 4 + 3); // settle + press
		expect(click?.point).toEqual([900, 500]);
		// Still on the target the whole time the button is down.
		const press = plan.presses[0];
		for (let f = press?.down ?? 0; f <= (press?.released ?? 0); f++) {
			expect(plan.positions[f]).toEqual([900, 500]);
		}
	});

	it("bends travel off the straight line, and overshoots a hair on natural landings", () => {
		// Largest distance from the straight line through (100,100) → (900,500).
		const deviation = (positions: Array<[number, number]>) =>
			Math.max(
				...positions.map(
					([x, y]) =>
						Math.abs(400 * x - 800 * y + 40000) / Math.hypot(800, 400),
				),
			);
		const end = (p: ReturnType<typeof planPointer>) =>
			p.cues.arrivals[1]?.frame ?? 0;
		const natural = planPointer(input());
		expect(
			deviation(natural.positions.slice(0, end(natural) + 1)),
		).toBeGreaterThan(15);
		const linear = planPointer(input({ motion: "linear" }));
		expect(deviation(linear.positions.slice(0, end(linear) + 1))).toBeLessThan(
			0.01,
		);
	});

	it("double clicks and drags", () => {
		const plan = planPointer(
			input({
				waypoints: [
					{ point: at(0, 0), clicks: 2 },
					{ point: at(400, 0), drag: at(400, 300) },
				],
			}),
		);
		expect(plan.cues.clicks).toHaveLength(2);
		const [a, b] = plan.cues.clicks;
		expect((b?.frame ?? 0) - (a?.frame ?? 0)).toBeGreaterThan(5);
		expect(plan.cues.drags).toHaveLength(1);
		const drag = plan.cues.drags[0];
		expect(drag?.from).toEqual([400, 0]);
		expect(drag?.to).toEqual([400, 300]);
		expect(plan.positions[drag?.end ?? 0]).toEqual([400, 300]);
		expect(plan.presses).toHaveLength(3);
	});

	it("honours explicit arrival frames and refuses impossible ones", () => {
		const plan = planPointer(
			input({
				waypoints: [{ point: at(0, 0) }, { point: at(500, 0), at: 90 }],
			}),
		);
		expect(plan.cues.arrivals[1]?.frame).toBe(90);
		expect(() =>
			planPointer(
				input({
					waypoints: [
						{ point: at(0, 0), dwell: 30 },
						{ point: at(500, 0), at: 10 },
					],
				}),
			),
		).toThrow(/busy until/);
	});

	it("enters and leaves through edges without fading", () => {
		const plan = planPointer(
			input({ from: [-60, 500], to: [1980, 300], appear: 0, vanish: 0 }),
		);
		expect(plan.positions[0]).toEqual([-60, 500]);
		expect(plan.positions[plan.length - 1]).toEqual([1980, 300]);
		expect(plan.shown).toBe(0);
	});

	it("swaps styles inside hover regions and on waypoint cursors", () => {
		const plan = planPointer(
			input({
				hoverRegions: [
					{ rect: { x: 850, y: 450, width: 100, height: 100 }, style: "hand" },
				],
			}),
		);
		const arrival = plan.cues.arrivals[1]?.frame ?? 0;
		const win = plan.styles.find((w) => arrival >= w.start && arrival <= w.end);
		expect(win?.style).toBe("hand");
		expect(plan.styles[0]?.style).toBe("arrow");
		const switched = planPointer(
			input({
				waypoints: [
					{ point: at(0, 0) },
					{ point: at(300, 0), cursor: "ibeam" },
				],
			}),
		);
		expect(switched.styles.at(-1)?.style).toBe("ibeam");
	});

	it("is deterministic per seed, and drift never moves a click", () => {
		const a = planPointer(input({ drift: 2, seed: 4 }));
		const b = planPointer(input({ drift: 2, seed: 4 }));
		const c = planPointer(input({ drift: 2, seed: 5 }));
		expect(a.positions).toEqual(b.positions);
		expect(a.positions).not.toEqual(c.positions);
		const click = a.cues.clicks[0];
		expect(a.positions[click?.frame ?? 0]).toEqual([900, 500]);
	});
});
