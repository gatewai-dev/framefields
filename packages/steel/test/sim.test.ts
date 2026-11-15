import { describe, expect, it } from "vitest";
import { boxOnPlane, simOf, zOf } from "./helpers.js";

describe("Sim", () => {
	it("drops a box onto the ground and rests it there", async () => {
		const { builder, box } = boxOnPlane(1);
		const sim = await simOf(builder);
		sim.step(120);
		const { bodyQ, bodyQd } = await sim.state();
		expect(zOf(bodyQ, box)).toBeCloseTo(0.1, 2);
		expect(Math.abs(bodyQd[box * 6 + 2])).toBeLessThan(0.05);
		sim.destroy();
	});

	it("falls as gravity says before it lands", async () => {
		const { builder, box } = boxOnPlane(10);
		const sim = await simOf(builder);
		sim.step(30);
		const { bodyQ } = await sim.state();
		// Half a second of free fall from 10 m: 10 - g t^2 / 2 (semi-implicit Euler, a little more).
		expect(zOf(bodyQ, box)).toBeCloseTo(10 - 9.81 * 0.125, 1);
		sim.destroy();
	});
});
