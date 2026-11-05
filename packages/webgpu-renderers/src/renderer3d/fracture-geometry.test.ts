import { describe, expect, it } from "vitest";
import type { Mesh3DData, Model3DData } from "../loaders/types.js";
import type { Vec3 } from "../math3d/vector3.js";
import {
	FRACTURE_INTERIOR_MATERIAL,
	fractureModel,
} from "./fracture-geometry.js";
import { generatePrimitiveGeometry } from "./primitive-geometry.js";

/** Each piece's triangles (surface and cut faces), by joint. */
function pieceTriangles(model: Model3DData): Map<number, Vec3[][]> {
	const out = new Map<number, Vec3[][]>();
	for (const mesh of model.meshes) {
		const p = mesh.positions;
		const at = (i: number): Vec3 => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
		for (let t = 0; t < mesh.indices.length; t += 3) {
			const i0 = mesh.indices[t]!;
			const joint = mesh.jointIndices![i0 * 4]!;
			const tri = [at(i0), at(mesh.indices[t + 1]!), at(mesh.indices[t + 2]!)];
			const list = out.get(joint);
			if (list) list.push(tri);
			else out.set(joint, [tri]);
		}
	}
	return out;
}

/**
 * How far the surface is from closed: a closed, consistently wound surface
 * encloses the same signed volume measured from any origin (T-junctions and
 * zero-area slivers along a seam do not open it). Relative to the volume.
 */
function leak(tris: Vec3[][]): number {
	const v0 = volume(tris);
	const o: Vec3 = [137, -211, 89];
	const shifted = tris.map((t) =>
		t.map((p) => p.map((x, k) => x - o[k]!) as Vec3),
	);
	return Math.abs(volume(shifted) - v0) / Math.max(1e-9, Math.abs(v0));
}

function volume(tris: Vec3[][]): number {
	let v = 0;
	for (const [a, b, c] of tris as [Vec3, Vec3, Vec3][]) {
		v +=
			(a[0] * (b[1] * c[2] - b[2] * c[1]) +
				a[1] * (b[2] * c[0] - b[0] * c[2]) +
				a[2] * (b[0] * c[1] - b[1] * c[0])) /
			6;
	}
	return v;
}

const box = () =>
	generatePrimitiveGeometry({
		type: "roundedBox",
		width: 200,
		height: 120,
		depth: 80,
		radius: 0,
		color: "#3366cc",
	});

describe("fractureModel", () => {
	it("splits a solid into closed pieces that fill it exactly", () => {
		const { model, cells } = fractureModel(box(), { cells: 24, seed: 3 });
		expect(cells.length).toBeGreaterThan(16);
		expect(cells.length).toBeLessThanOrEqual(24);
		const pieces = pieceTriangles(model);
		expect(pieces.size).toBe(cells.length);
		let total = 0;
		for (const [joint, tris] of pieces) {
			expect(leak(tris)).toBeLessThan(1e-6);
			const v = volume(tris);
			expect(v).toBeGreaterThan(0);
			// Float32 positions against the double-precision measure.
			expect(Math.abs(v / cells[joint]!.volume - 1)).toBeLessThan(1e-5);
			total += v;
		}
		expect(total).toBeCloseTo(200 * 120 * 80, 0);
		// Cut faces carry the interior material; the outside keeps the source's.
		const names = model.meshes.map((m) => m.materialName);
		expect(names).toContain(FRACTURE_INTERIOR_MATERIAL);
		expect(model.skins?.[0]?.joints.length).toBe(cells.length);
	});

	it("is deterministic and crowds pieces around the impact point", () => {
		const a = fractureModel(box(), {
			cells: 32,
			seed: 9,
			impactPoint: [90, 0, 0],
		});
		const b = fractureModel(box(), {
			cells: 32,
			seed: 9,
			impactPoint: [90, 0, 0],
		});
		expect(a.cells.map((c) => c.centroid)).toEqual(
			b.cells.map((c) => c.centroid),
		);
		const near = a.cells.filter((c) => c.centroid[0] > 50);
		const far = a.cells.filter((c) => c.centroid[0] < -50);
		expect(near.length).toBeGreaterThan(far.length * 2);
		const avg = (cs: typeof near) =>
			cs.reduce((s, c) => s + c.volume, 0) / Math.max(1, cs.length);
		expect(avg(near)).toBeLessThan(avg(far));
	});

	it("closes cuts through non-convex solids, holes included", () => {
		const torus = generatePrimitiveGeometry({
			type: "torus",
			radius: 80,
			tube: 26,
			radialSegments: 24,
			tubularSegments: 48,
		});
		const { model, cells } = fractureModel(torus, { cells: 12, seed: 5 });
		const pieces = pieceTriangles(model);
		let total = 0;
		for (const tris of pieces.values()) {
			expect(leak(tris)).toBeLessThan(1e-6);
			total += volume(tris);
		}
		expect(cells.length).toBeGreaterThan(6);
		// The tessellated torus's own volume.
		const src = torus.meshes[0] as Mesh3DData;
		const whole = pieceTriangles({
			...torus,
			meshes: [
				{
					...src,
					jointIndices: new Float32Array((src.positions.length / 3) * 4),
				},
			],
		}).get(0)!;
		expect(total).toBeCloseTo(volume(whole), -1);
	});

	it("keeps hull points around each centroid", () => {
		const { cells } = fractureModel(box(), { cells: 8, seed: 2 });
		for (const c of cells) {
			expect(c.hull.length % 3).toBe(0);
			expect(c.hull.length).toBeGreaterThanOrEqual(12);
			let mean = [0, 0, 0];
			for (let i = 0; i < c.hull.length; i += 3)
				mean = mean.map((m, k) => m + c.hull[i + k]!);
			// The centroid sits inside its piece: hull points surround it.
			for (let k = 0; k < 3; k++) {
				const vals = c.hull.filter((_, i) => i % 3 === k);
				expect(Math.min(...vals)).toBeLessThan(0);
				expect(Math.max(...vals)).toBeGreaterThan(0);
			}
		}
	});
});
