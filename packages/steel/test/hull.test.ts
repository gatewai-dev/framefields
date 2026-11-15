/**
 * Hull vertex caps: a mesh's convex hull keeps the points that stand out
 * most, up to `maxVertices` (64 unless asked), so detailed meshes collide
 * as compact hulls that stay within a small distance of the full one.
 */
import { describe, expect, it } from "vitest";
import { convexHull, MAX_HULL_VERTICES, SceneBuilder } from "../src/index.js";
import { simOf, zOf } from "./helpers.js";

/** n points spread over a sphere of radius r (a golden-angle spiral). */
function sphere(n: number, r: number): number[][] {
	return Array.from({ length: n }, (_, i) => {
		const z = 1 - (2 * (i + 0.5)) / n;
		const q = Math.sqrt(1 - z * z);
		const a = i * Math.PI * (3 - Math.sqrt(5));
		return [r * q * Math.cos(a), r * q * Math.sin(a), r * z];
	});
}

/** How far the farthest point lies outside a hull. */
function outside(
	hull: ReturnType<typeof convexHull>,
	points: number[][],
): number {
	let worst = 0;
	for (const p of points)
		for (const f of hull.faces)
			worst = Math.max(
				worst,
				f.n[0] * p[0] + f.n[1] * p[1] + f.n[2] * p[2] - f.d,
			);
	return worst;
}

describe("hull vertex caps", () => {
	it("caps a hull at its vertex count, within a bound of the full hull", () => {
		const points = sphere(3000, 1);
		expect(convexHull(points).verts.length).toBe(3000);
		const errors = [256, 64, 16].map((cap) => {
			const hull = convexHull(points, cap);
			expect(hull.verts.length).toBeLessThanOrEqual(cap);
			expect(hull.verts.length).toBeGreaterThan(cap * 0.9);
			return outside(hull, points);
		});
		// More vertices, a closer hull: 64 on a unit sphere stays within 7%.
		expect(errors[0]).toBeLessThan(errors[1]);
		expect(errors[1]).toBeLessThan(errors[2]);
		expect(errors[1]).toBeLessThan(0.07);
		expect(() => convexHull(points, 3)).toThrow(/at least 4/);
	});

	it("keeps the corners that stand out over the points between them", () => {
		// A box's 8 corners among 2,000 points on its faces and edges.
		const points: number[][] = [];
		for (const x of [-1, 1])
			for (const y of [-1, 1])
				for (const z of [-1, 1]) points.push([x * 0.3, y * 0.2, z * 0.1]);
		for (let i = 0; i < 2000; i++) {
			const t = (i * 0.618034) % 1;
			const s = (i * 0.754878) % 1;
			const face = i % 3;
			const p = [(t * 2 - 1) * 0.3, (s * 2 - 1) * 0.2, (i % 2 ? 1 : -1) * 0.1];
			if (face === 1) p[1] = (i % 2 ? 1 : -1) * 0.2;
			if (face === 2) p[0] = (i % 2 ? 1 : -1) * 0.3;
			points.push(p);
		}
		const hull = convexHull(points, 8);
		expect(hull.verts.length).toBe(8);
		expect(hull.faces.length).toBe(6);
		expect(outside(hull, points)).toBeLessThan(1e-6);
	});

	it("caps mesh hulls by default and keeps every vertex when asked", () => {
		const builder = new SceneBuilder({ fps: 60 });
		const capped = builder.addBody({});
		builder.addShapeConvexHull(capped, { vertices: sphere(1000, 0.1) });
		const full = builder.addBody({});
		builder.addShapeConvexHull(full, {
			vertices: sphere(1000, 0.1),
			maxVertices: Infinity,
		});
		const shapes = builder.finalize().json.shapes;
		expect(shapes.map((s) => s.hull?.nv)).toEqual([MAX_HULL_VERTICES, 1000]);
	});

	it("rests a ball of 4,000 vertices on the ground as its capped hull", async () => {
		const builder = new SceneBuilder({ fps: 60 });
		builder.addGroundPlane();
		const ball = builder.addBody({ xform: [0, 0, 0.3, 0, 0, 0, 1] });
		builder.addJointFree(ball);
		builder.addShapeConvexHull(ball, {
			vertices: sphere(4000, 0.1),
			gap: 0.01,
		});
		const sim = await simOf(builder);
		sim.step(180);
		const z = zOf((await sim.state()).bodyQ, ball);
		// Within the 64-vertex hull's bound of the full sphere's radius.
		expect(z).toBeGreaterThan(0.093);
		expect(z).toBeLessThanOrEqual(0.1001);
	});
});
