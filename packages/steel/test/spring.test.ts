/**
 * Springs: two soft rows on the spring's line (pull past the rest length,
 * push short of it), solved implicitly, so stiff springs stay stable.
 */
import { describe, expect, it } from "vitest";
import { SceneBuilder } from "../src/index.js";
import { boxOnPlane, simOf, zOf } from "./helpers.js";

function bob(builder: SceneBuilder, z: number): number {
	const b = builder.addBody({ xform: [0, 0, z, 0, 0, 0, 1] });
	builder.addJointFree(b);
	builder.addShapeSphere(b, {
		radius: 0.05,
		gap: 0.01,
		density: 1 / ((4 / 3) * Math.PI * 0.05 ** 3),
	});
	return b;
}

describe("springs", () => {
	it("hangs a mass at rest length + m g / k", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		const b = bob(builder, 1);
		builder.addSpring(-1, b, {
			anchorA: [0, 0, 2],
			restLength: 0.5,
			stiffness: 200,
			damping: 20,
		});
		const sim = await simOf(builder);
		expect(sim.bodyMass(b)).toBeCloseTo(1, 6);
		sim.step(240);
		// 1 kg on 200 N/m: 4.9 cm past its rest length.
		expect(zOf((await sim.state()).bodyQ, b)).toBeCloseTo(
			2 - 0.5 - 9.81 / 200,
			3,
		);
		sim.destroy();
	});

	it("oscillates at sqrt(k / m) and pushes when compressed", async () => {
		const builder = new SceneBuilder({ fps: 60, gravity: [0, 0, 0] });
		const b = bob(builder, 1.4);
		// Starts 10 cm short of its rest length: pushed down first.
		builder.addSpring(-1, b, {
			anchorA: [0, 0, 2],
			restLength: 0.7,
			stiffness: 400,
		});
		const sim = await simOf(builder, { substeps: 8 });
		const z: number[] = [];
		for (let f = 0; f < 120; f++) {
			sim.step(1);
			z.push(zOf((await sim.state()).bodyQ, b));
		}
		expect(z[0]).toBeLessThan(1.4);
		// Period 2π sqrt(m / k) = 0.314 s: count downward crossings of the rest point over 2 s.
		let crossings = 0;
		for (let f = 1; f < z.length; f++)
			if (z[f - 1] > 1.3 && z[f] <= 1.3) crossings++;
		expect(crossings).toBeGreaterThanOrEqual(6);
		expect(crossings).toBeLessThanOrEqual(7);
		// Implicit: it loses a little energy, never gains.
		expect(Math.min(...z)).toBeGreaterThan(1.19);
		sim.destroy();
	});

	it("stays stable far stiffer than the step rate allows an explicit spring", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		const b = bob(builder, 1.5);
		// ω = 300 rad/s against 240 steps a second (explicit needs ω dt < 2).
		builder.addSpring(-1, b, {
			anchorA: [0, 0, 2],
			restLength: 0.5,
			stiffness: 9e4,
			damping: 0,
		});
		const sim = await simOf(builder);
		sim.step(120);
		const z = zOf((await sim.state()).bodyQ, b);
		expect(Number.isFinite(z)).toBe(true);
		expect(z).toBeCloseTo(1.5, 2);
		sim.destroy();
	});

	it("keeps contacts rigid in a world with springs", async () => {
		const { builder, box } = boxOnPlane(0.3);
		const other = bob(builder, 3);
		builder.addSpring(-1, other, {
			anchorA: [0, 0, 4],
			restLength: 1,
			stiffness: 100,
		});
		const sim = await simOf(builder);
		sim.step(90);
		expect(zOf((await sim.state()).bodyQ, box)).toBeCloseTo(0.1, 3);
		expect(await sim.contacts()).not.toEqual([]);
		for (const c of await sim.contacts()) expect(c.a).toBe(-1);
		sim.destroy();
	});
});
