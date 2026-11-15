/**
 * Ropes: a one-sided distance row between two anchors, taut at its length
 * and slack when shorter.
 */
import { describe, expect, it } from "vitest";
import { SceneBuilder } from "../src/index.js";
import { simOf } from "./helpers.js";

const at = (q: Float32Array, b: number): [number, number, number] => [
	q[b * 7],
	q[b * 7 + 1],
	q[b * 7 + 2],
];
const dist = (a: number[], b: number[]) =>
	Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function ball(
	builder: SceneBuilder,
	p: [number, number, number],
	twist?: [number, number, number, number, number, number],
): number {
	const b = builder.addBody({ xform: [...p, 0, 0, 0, 1], twist });
	builder.addJointFree(b);
	builder.addShapeSphere(b, { radius: 0.05, gap: 0.01 });
	return b;
}

describe("ropes", () => {
	it("holds a hanging ball at its length", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		const b = ball(builder, [0, 0, 1]);
		builder.addRope(-1, b, { anchorA: [0, 0, 2], length: 1 });
		const sim = await simOf(builder);
		sim.step(120);
		const { bodyQ, bodyQd } = await sim.state();
		expect(dist(at(bodyQ, b), [0, 0, 2])).toBeCloseTo(1, 3);
		expect(Math.abs(bodyQd[b * 6 + 2])).toBeLessThan(1e-2);
		expect(await sim.contacts()).toEqual([]);
		sim.destroy();
	});

	it("swings without stretching and keeps the energy a pendulum has", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		const b = ball(builder, [1, 0, 2]);
		builder.addRope(-1, b, { anchorA: [0, 0, 2], length: 1 });
		const sim = await simOf(builder);
		let lowest = 2;
		let longest = 0;
		for (let f = 0; f < 60; f++) {
			sim.step(1);
			const p = at((await sim.state()).bodyQ, b);
			longest = Math.max(longest, dist(p, [0, 0, 2]));
			lowest = Math.min(lowest, p[2]);
		}
		expect(longest).toBeLessThan(1.01);
		// Swung down through the bottom of the arc.
		expect(lowest).toBeLessThan(1.02);
		sim.destroy();
	});

	it("lets a slack rope fall freely until it is taut", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		const b = ball(builder, [0, 0, 1.8]);
		builder.addRope(-1, b, { anchorA: [0, 0, 2], length: 1 });
		const sim = await simOf(builder);
		sim.step(9);
		// Free fall for 0.15 s: g t² / 2 = 0.11 m.
		expect(at((await sim.state()).bodyQ, b)[2]).toBeCloseTo(
			1.8 - 0.5 * 9.81 * 0.15 ** 2,
			2,
		);
		sim.step(120);
		expect(at((await sim.state()).bodyQ, b)[2]).toBeCloseTo(1, 2);
		sim.destroy();
	});

	it("drags one body after another and turns it at its anchor", async () => {
		const builder = new SceneBuilder({ fps: 60, gravity: [0, 0, 0] });
		const lead = ball(builder, [0, 0, 0], [2, 0, 0, 0, 0, 0]);
		const box = builder.addBody({ xform: [-1, 0.3, 0, 0, 0, 0, 1] });
		builder.addJointFree(box);
		builder.addShapeBox(box, { hx: 0.1, hy: 0.1, hz: 0.1, gap: 0.01 });
		builder.addRope(lead, box, { anchorB: [0.1, 0, 0], length: 1 });
		const sim = await simOf(builder);
		sim.step(60);
		const { bodyQ, bodyQd } = await sim.state();
		// Taut, the jerk sharing the ball's momentum, the box turned by the off-center pull.
		const ml = sim.bodyMass(lead);
		const mb = sim.bodyMass(box);
		const px = ml * bodyQd[lead * 6] + mb * bodyQd[box * 6];
		expect(px / (ml * 2)).toBeCloseTo(1, 3);
		expect(bodyQd[box * 6]).toBeGreaterThan(0.05);
		const anchor = [bodyQ[box * 7] + 0.1, bodyQ[box * 7 + 1], 0];
		expect(dist(at(bodyQ, lead), anchor)).toBeLessThan(1.02);
		expect(Math.abs(bodyQd[box * 6 + 5])).toBeGreaterThan(0.01);
		sim.destroy();
	});
});
