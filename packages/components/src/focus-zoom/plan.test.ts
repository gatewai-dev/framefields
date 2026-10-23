import { describe, expect, it } from "vitest";
import { shotsFromClicks, solveCamera } from "./plan.js";

const base = {
	width: 1920,
	height: 1080,
	fps: 30,
	smoothing: 0.6,
	clamp: true,
};

describe("solveCamera", () => {
	it("rests at full view without shots", () => {
		const plan = solveCamera({ ...base, length: 30, shots: [] });
		expect(plan.scale.every((s) => s === 1)).toBe(true);
		expect(plan.x.every((x) => x === 0)).toBe(true);
	});

	it("pushes in, settles on the target, and lets go", () => {
		const plan = solveCamera({
			...base,
			length: 200,
			shots: [{ start: 20, end: 120, zoom: 2, center: [1400, 400] }],
		});
		const settled = plan.shots[0]?.settled ?? 0;
		expect(settled).toBeGreaterThan(20);
		expect(settled).toBeLessThan(80);
		const s = plan.states[110];
		expect(s?.zoom).toBeCloseTo(2, 2);
		expect(s?.cx).toBeCloseTo(1400, 0);
		expect(plan.states[199]?.zoom).toBeCloseTo(1, 2);
		// Wrapper transform puts the centre point in the middle of the view.
		expect((plan.x[110] ?? 0) + 2 * 1400).toBeCloseTo(960, 0);
	});

	it("never shows past the edges, or past bounds once zoomed", () => {
		const plan = solveCamera({
			...base,
			length: 120,
			shots: [{ start: 0, end: 120, zoom: 2, center: [1900, 1060] }],
			bounds: { x: 100, y: 50, width: 1600, height: 950 },
		});
		for (const st of plan.states) {
			const hw = 960 / st.zoom;
			const hh = 540 / st.zoom;
			expect(st.cx + hw).toBeLessThanOrEqual(1920 + 1e-6);
			expect(st.cy + hh).toBeLessThanOrEqual(1080 + 1e-6);
		}
		const last = plan.states[119];
		expect((last?.cx ?? 0) + 960 / (last?.zoom ?? 1)).toBeLessThanOrEqual(
			1700 + 1e-6,
		);
	});

	it("never wiggles: a point near a clamped edge moves one way on screen in and out", () => {
		const plan = solveCamera({
			...base,
			length: 240,
			shots: [{ start: 30, end: 140, zoom: 1.65, center: [1700, 300] }],
			bounds: { x: 150, y: 64, width: 1620, height: 952 },
		});
		const screenX = plan.states.map((s) => 960 + (1612 - s.cx) * s.zoom);
		const directionChanges = (from: number, to: number) => {
			let changes = 0;
			let last = 0;
			for (let f = from + 1; f < to; f++) {
				const d = (screenX[f] ?? 0) - (screenX[f - 1] ?? 0);
				if (Math.abs(d) < 1e-6) continue;
				const sign = Math.sign(d);
				if (last !== 0 && sign !== last) changes++;
				last = sign;
			}
			return changes;
		};
		expect(directionChanges(30, 140)).toBe(0);
		expect(directionChanges(140, 240)).toBe(0);
		// And zoom itself only ever goes up, then only down.
		for (let f = 31; f < 140; f++)
			expect(plan.scale[f] ?? 0).toBeGreaterThanOrEqual(
				(plan.scale[f - 1] ?? 0) - 1e-9,
			);
		for (let f = 141; f < 240; f++)
			expect(plan.scale[f] ?? 0).toBeLessThanOrEqual(
				(plan.scale[f - 1] ?? 0) + 1e-9,
			);
	});
});

describe("shotsFromClicks", () => {
	const o = {
		width: 1920,
		height: 1080,
		lead: 20,
		idle: 40,
		zoom: 1.8,
		maxZoom: 2.5,
		padding: 160,
	};

	it("clusters clicks close in time and space", () => {
		const shots = shotsFromClicks(
			[
				{ frame: 100, point: [500, 500] },
				{ frame: 130, point: [600, 520] },
				{ frame: 400, point: [1500, 300] },
			],
			o,
		);
		expect(shots).toHaveLength(2);
		expect(shots[0]).toMatchObject({ start: 80, end: 170 });
		expect(shots[1]).toMatchObject({ start: 380, end: 440 });
	});

	it("zooms out enough to fit a wide cluster", () => {
		const [shot] = shotsFromClicks(
			[
				{ frame: 10, point: [300, 500] },
				{ frame: 20, point: [1100, 500] },
			],
			o,
		);
		expect(shot?.zoom).toBeLessThan(1.8);
		expect(shot?.zoom).toBeGreaterThanOrEqual(1);
	});

	it("keeps a pushed-in click near the middle of the screen, with the camera still", () => {
		const shots = shotsFromClicks([{ frame: 60, point: [1500, 300] }], o);
		const plan = solveCamera({ ...base, length: 160, shots });
		const s = plan.states[60];
		const prev = plan.states[59];
		const screenX = 960 + (1500 - (s?.cx ?? 0)) * (s?.zoom ?? 1);
		const screenY = 540 + (300 - (s?.cy ?? 0)) * (s?.zoom ?? 1);
		expect(Math.abs(screenX - 960)).toBeLessThan(1920 * 0.3);
		expect(Math.abs(screenY - 540)).toBeLessThan(1080 * 0.3);
		const moved =
			Math.hypot(
				(s?.cx ?? 0) - (prev?.cx ?? 0),
				(s?.cy ?? 0) - (prev?.cy ?? 0),
			) * (s?.zoom ?? 1);
		expect(moved).toBeLessThan(6);
	});
});
