/**
 * Rounded boxes: a core box swept by a sphere. They rest and stack at their
 * outer size, weigh what the rounded volume weighs, and roll when round.
 */
import { describe, expect, it } from "vitest";
import { SceneBuilder } from "../src/index.js";
import { simOf, zOf } from "./helpers.js";

type Shapes = Parameters<SceneBuilder["addShapeBox"]>[1];

function rounded(radius: number, h = 0.1): SceneBuilder {
	const builder = new SceneBuilder({ fps: 60 });
	const b = builder.addBody();
	builder.addShapeBox(b, { hx: h, hy: h, hz: h, radius, density: 1 });
	return builder;
}

/** Body `b`'s mass and inertia diagonal as finalize() gives them. */
function massOf(builder: SceneBuilder, b = 0): { m: number; I: number[] } {
	const { bodies } = builder.finalize().json as unknown as {
		bodies: { mass: number[]; inertia: number[][] };
	};
	const I = bodies.inertia[b];
	return { m: bodies.mass[b], I: [I[0], I[4], I[8]] };
}

describe("rounded boxes", () => {
	it("weighs the rounded volume: a box at radius 0, a ball as the core vanishes", () => {
		const box = massOf(rounded(0));
		expect(box.m).toBeCloseTo(0.008, 10);
		const h = 0.1;
		const ball = massOf(rounded(h * (1 - 1e-5), h));
		const m = (4 / 3) * Math.PI * h ** 3;
		expect(ball.m / m).toBeCloseTo(1, 4);
		for (const i of ball.I) expect(i / (0.4 * m * h * h)).toBeCloseTo(1, 4);
		// In between: less than the box, more than the ball.
		const mid = massOf(rounded(0.05));
		expect(mid.m).toBeLessThan(box.m);
		expect(mid.m).toBeGreaterThan(m);
		const b = rounded(0.05);
		expect(b.massOf(0)).toBeCloseTo(mid.m, 12);
	});

	it("refuses a radius as large as a half size", () => {
		expect(() => rounded(0.1)).toThrow("radius");
	});

	it("rests on the ground and on a sharp box at its outer size", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		builder.addGroundPlane();
		const drop = (z: number, shape: Shapes) => {
			const b = builder.addBody({ xform: [0, 0, z, 0, 0, 0, 1] });
			builder.addJointFree(b);
			builder.addShapeBox(b, {
				hx: 0.1,
				hy: 0.1,
				hz: 0.1,
				gap: 0.01,
				...shape,
			});
			return b;
		};
		const lone = drop(0.25, { radius: 0.04, xform: [1, 0, 0, 0, 0, 0, 1] });
		const base = drop(0.1, {});
		const top = drop(0.35, { radius: 0.04 });
		const sim = await simOf(builder);
		sim.step(120);
		const { bodyQ } = await sim.state();
		expect(zOf(bodyQ, lone)).toBeCloseTo(0.1, 3);
		expect(zOf(bodyQ, base)).toBeCloseTo(0.1, 3);
		expect(zOf(bodyQ, top)).toBeCloseTo(0.3, 3);
		sim.destroy();
	});

	it("holds a ball on its rounded top", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		const block = builder.addBody({ kinematic: true });
		builder.addShapeBox(block, {
			hx: 0.2,
			hy: 0.2,
			hz: 0.1,
			radius: 0.05,
			gap: 0.01,
		});
		const ball = builder.addBody({ xform: [0, 0, 0.3, 0, 0, 0, 1] });
		builder.addJointFree(ball);
		builder.addShapeSphere(ball, { radius: 0.05, gap: 0.01 });
		const sim = await simOf(builder);
		sim.step(90);
		expect(zOf((await sim.state()).bodyQ, ball)).toBeCloseTo(0.15, 3);
		sim.destroy();
	});

	it("rolls down a slope when nearly round, where a sharp box sticks", async () => {
		const run = async (radius: number) => {
			const builder = new SceneBuilder({ fps: 60 });
			const tilt = (20 * Math.PI) / 180;
			builder.addGroundPlane({
				xform: [0, 0, 0, Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)],
				mu: 1,
			});
			const b = builder.addBody({
				xform: [0, 0, 0.12, Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)],
			});
			builder.addJointFree(b);
			builder.addShapeBox(b, {
				hx: 0.1,
				hy: 0.1,
				hz: 0.1,
				radius,
				gap: 0.01,
				mu: 1,
			});
			const sim = await simOf(builder);
			sim.step(60);
			const y = (await sim.state()).bodyQ[b * 7 + 1];
			sim.destroy();
			return y;
		};
		// Down the slope is -y (the plane's normal leans toward -y).
		expect(Math.abs(await run(0))).toBeLessThan(0.02);
		expect(await run(0.095)).toBeLessThan(-0.5);
	});
});
