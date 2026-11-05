/**
 * Loop subdivision splits each triangle in four, relaxes the surface, and
 * carries what rides on it exactly: a blend shape that translates the
 * whole surface still translates it, skin weights stay normalized, and
 * welded seam copies end up on one point.
 */
import { describe, expect, it } from "vitest";
import { subdivide } from "./index.js";

/** An octahedron with one vertex split at a UV seam (vertex 6 copies 0). */
function octahedron() {
	const positions = [
		1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 1, 0, 0,
	];
	const indices = [
		0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 6, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 6, 3, 5,
	];
	const n = positions.length / 3;
	const uvs = Array.from({ length: n * 2 }, (_, i) => (i === 12 ? 1 : 0));
	const joints = Array.from({ length: n * 4 }, (_, i) => (i % 4 === 1 ? 1 : 0));
	const weights = Array.from({ length: n }, (_, v) =>
		v % 2 ? [0.25, 0.75, 0, 0] : [1, 0, 0, 0],
	).flat();
	weights.splice(24, 4, 1, 0, 0, 0); // the seam copy weighs like vertex 0
	return {
		positions,
		indices,
		uvs,
		joints,
		weights,
		weld: [0, 1, 2, 3, 4, 5, 0],
	};
}

describe("subdivide", () => {
	it("quadruples the triangles and moves the surface toward its limit", () => {
		const o = octahedron();
		const s = subdivide({ ...o }, { weld: o.weld });
		expect(s.indices?.length).toBe(o.indices.length * 4);
		// Corners pull in toward the smooth limit surface.
		const r = Math.hypot(...Array.from(s.positions).slice(0, 3));
		expect(r).toBeLessThan(1);
		expect(r).toBeGreaterThan(0.5);
	});

	it("welds seam copies into one point, and keeps their own UVs", () => {
		const o = octahedron();
		const s = subdivide({ ...o }, { weld: o.weld, levels: 2 });
		const p = Array.from(s.positions);
		const u = Array.from(s.uvs ?? []);
		const n = p.length / 3;
		const at = (v: number) => p.slice(v * 3, v * 3 + 3);
		let seamPairs = 0;
		for (let a = 0; a < n; a++)
			for (let b = a + 1; b < n; b++) {
				const d = Math.hypot(...at(a).map((x, k) => x - (at(b)[k] as number)));
				if (d < 1e-9 && u[a * 2] !== u[b * 2]) seamPairs++;
				// Distinct surface points never coincide.
				if (d < 1e-9) expect(u[a * 2]).not.toBe(u[b * 2]);
			}
		expect(seamPairs).toBeGreaterThan(0);
	});

	it("carries blend shapes and skin weights exactly", () => {
		const o = octahedron();
		const lift = o.positions.map((_, i) => (i % 3 === 1 ? 0.5 : 0));
		const s = subdivide(
			{ ...o, targets: [{ name: "lift", positions: lift }] },
			{ weld: o.weld, levels: 2 },
		);
		const t = Array.from(s.targets?.[0]?.positions ?? []);
		expect(t.length).toBe(s.positions.length);
		for (let i = 0; i < t.length; i++)
			expect(t[i]).toBeCloseTo(i % 3 === 1 ? 0.5 : 0, 12);
		const w = Array.from(s.weights ?? []);
		for (let v = 0; v < w.length / 4; v++)
			expect(w.slice(v * 4, v * 4 + 4).reduce((a, b) => a + b, 0)).toBeCloseTo(
				1,
				9,
			);
		// Normals are unit length.
		const nn = Array.from(s.normals ?? []);
		for (let v = 0; v < nn.length / 3; v++)
			expect(Math.hypot(...nn.slice(v * 3, v * 3 + 3))).toBeCloseTo(1, 9);
	});
});
