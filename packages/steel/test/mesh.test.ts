/**
 * Triangle-mesh colliders: a static mesh collides as its triangles, found
 * through its BVH, so shapes rest on terrain at their own size however
 * many triangles it has.
 */
import { describe, expect, it } from "vitest";
import { SceneBuilder } from "../src/index.js";
import { simOf, zOf } from "./helpers.js";

/** A square grid of n × n cells, `size` m across, at height z = f(x, y). */
function grid(n: number, size: number, f: (x: number, y: number) => number) {
	const vertices: number[] = [];
	const indices: number[] = [];
	for (let j = 0; j <= n; j++)
		for (let i = 0; i <= n; i++) {
			const x = (i / n - 0.5) * size;
			const y = (j / n - 0.5) * size;
			vertices.push(x, y, f(x, y));
		}
	for (let j = 0; j < n; j++)
		for (let i = 0; i < n; i++) {
			const a = j * (n + 1) + i;
			indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
		}
	return { vertices, indices };
}

function free(builder: SceneBuilder, at: [number, number, number]): number {
	const b = builder.addBody({ xform: [...at, 0, 0, 0, 1] });
	builder.addJointFree(b);
	return b;
}

describe("triangle meshes", () => {
	it("holds a box, a ball, a rounded box and a hull at their size", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		builder.addShapeMesh(-1, { ...grid(8, 4, () => 0), gap: 0.01 });
		const box = free(builder, [-1, 0, 0.3]);
		builder.addShapeBox(box, { hx: 0.1, hy: 0.1, hz: 0.1, gap: 0.01 });
		const ball = free(builder, [0, 0, 0.3]);
		builder.addShapeSphere(ball, { radius: 0.1, gap: 0.01 });
		const round = free(builder, [1, 0, 0.3]);
		builder.addShapeBox(round, {
			hx: 0.1,
			hy: 0.1,
			hz: 0.1,
			radius: 0.04,
			gap: 0.01,
		});
		// A 32-sided prism: the large-hull path.
		const hull = free(builder, [0, 1, 0.3]);
		const vertices: number[][] = [];
		for (let k = 0; k < 32; k++) {
			const a = (k / 32) * 2 * Math.PI;
			vertices.push(
				[0.15 * Math.cos(a), 0.15 * Math.sin(a), -0.05],
				[0.15 * Math.cos(a), 0.15 * Math.sin(a), 0.05],
			);
		}
		builder.addShapeConvexHull(hull, { vertices, gap: 0.01 });
		const sim = await simOf(builder);
		sim.step(120);
		const { bodyQ } = await sim.state();
		expect(zOf(bodyQ, box)).toBeCloseTo(0.1, 3);
		expect(zOf(bodyQ, ball)).toBeCloseTo(0.1, 3);
		expect(zOf(bodyQ, round)).toBeCloseTo(0.1, 3);
		expect(zOf(bodyQ, hull)).toBeCloseTo(0.05, 3);
		// Resting where they fell, across the triangles' shared edges.
		expect(bodyQ[box * 7]).toBeCloseTo(-1, 3);
		expect(bodyQ[ball * 7]).toBeCloseTo(0, 3);
		const contacts = await sim.contacts();
		expect(contacts.every((c) => c.a === -1)).toBe(true);
		sim.destroy();
	});

	it("rolls a ball down a sloped mesh", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		builder.addShapeMesh(-1, { ...grid(4, 6, (x) => -0.3 * x), gap: 0.01 });
		const ball = free(builder, [-2, 0, 0.75]);
		builder.addShapeSphere(ball, { radius: 0.1, gap: 0.01 });
		const sim = await simOf(builder);
		sim.step(60);
		const { bodyQ } = await sim.state();
		const x = bodyQ[ball * 7];
		expect(x).toBeGreaterThan(-1.5);
		// On the surface: 0.1 m along the slope's normal.
		const z = zOf(bodyQ, ball);
		expect(z - -0.3 * x).toBeCloseTo(0.1 * Math.hypot(1, 0.3), 2);
		sim.destroy();
	});

	it("settles boxes on a bumpy 20,000-triangle terrain", async () => {
		const f = (x: number, y: number) =>
			0.05 * Math.sin(3 * x) * Math.cos(2 * y);
		const builder = new SceneBuilder({ fps: 60 });
		const t = grid(100, 10, f);
		builder.addShapeMesh(-1, { ...t, gap: 0.02 });
		const boxes: number[] = [];
		for (let k = 0; k < 16; k++) {
			const b = free(builder, [
				(k % 4) * 2 - 3,
				Math.floor(k / 4) * 2 - 3,
				0.5,
			]);
			builder.addShapeBox(b, { hx: 0.1, hy: 0.1, hz: 0.1, gap: 0.01 });
			boxes.push(b);
		}
		const sim = await simOf(builder);
		sim.step(180);
		const { bodyQ, bodyQd } = await sim.state();
		for (const b of boxes) {
			const [x, y] = [bodyQ[b * 7], bodyQ[b * 7 + 1]];
			// Above the surface below it, by about its half size.
			const above = zOf(bodyQ, b) - f(x, y);
			expect(above).toBeGreaterThan(0.06);
			expect(above).toBeLessThan(0.16);
			expect(
				Math.hypot(bodyQd[b * 6], bodyQd[b * 6 + 1], bodyQd[b * 6 + 2]),
			).toBeLessThan(0.05);
		}
		sim.destroy();
	});

	it("moves a mesh with its kinematic body", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		const lift = builder.addBody({
			kinematic: true,
			twist: [0, 0, 0.5, 0, 0, 0],
		});
		builder.addShapeMesh(lift, { ...grid(2, 2, () => 0), gap: 0.01 });
		const box = free(builder, [0, 0, 0.1]);
		builder.addShapeBox(box, { hx: 0.1, hy: 0.1, hz: 0.1, gap: 0.01 });
		const sim = await simOf(builder);
		sim.step(60);
		// Carried up half a meter with the platform.
		expect(zOf((await sim.state()).bodyQ, box)).toBeCloseTo(0.6, 2);
		sim.destroy();
	});

	it("refuses a mesh on a dynamic body", () => {
		const builder = new SceneBuilder();
		const b = builder.addBody();
		builder.addShapeMesh(
			b,
			grid(1, 1, () => 0),
		);
		expect(() => builder.finalize()).toThrow("static or kinematic");
	});
});
