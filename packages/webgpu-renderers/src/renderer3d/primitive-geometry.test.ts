import { describe, expect, it } from "vitest";
import type { Model3DData } from "../loaders/types.js";
import {
	generatePrimitiveGeometry,
	getPrimitiveGeometry,
	type PrimitiveGeometryOptions,
} from "./primitive-geometry.js";

type V = [number, number, number];

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Every triangle must wind so its geometric normal points away from the
 * solid's center (single-sided shading drops the others) and agree with
 * its vertex normals.
 */
function expectOutwardSolid(model: Model3DData): void {
	const mesh = model.meshes[0]!;
	const p = mesh.positions;
	const n = mesh.normals;
	const at = (i: number): V => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
	const normalAt = (i: number): V => [n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!];
	let checked = 0;
	for (let t = 0; t < mesh.indices.length; t += 3) {
		const [i0, i1, i2] = [
			mesh.indices[t]!,
			mesh.indices[t + 1]!,
			mesh.indices[t + 2]!,
		];
		const a = at(i0);
		const face = cross(sub(at(i1), a), sub(at(i2), a));
		// Degenerate slivers (arc samples meeting at a pole or corner) say nothing.
		if (Math.hypot(...face) < 1e-6) continue;
		const centroid: V = [
			(a[0] + at(i1)[0] + at(i2)[0]) / 3,
			(a[1] + at(i1)[1] + at(i2)[1]) / 3,
			(a[2] + at(i1)[2] + at(i2)[2]) / 3,
		];
		expect(dot(face, centroid)).toBeGreaterThan(0);
		expect(dot(face, normalAt(i0))).toBeGreaterThan(0);
		checked++;
	}
	expect(checked).toBeGreaterThan(0);
	for (let i = 0; i < n.length; i += 3) {
		expect(Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!)).toBeCloseTo(1, 4);
	}
}

describe("3D primitive geometry", () => {
	it("builds a rounded box to size, wound outward on all six faces", () => {
		const model = generatePrimitiveGeometry({
			type: "roundedBox",
			width: 200,
			height: 40,
			depth: 120,
			radius: 10,
			segments: 4,
		});
		expect(model.bounds.size[0]).toBeCloseTo(200, 4);
		expect(model.bounds.size[1]).toBeCloseTo(40, 4);
		expect(model.bounds.size[2]).toBeCloseTo(120, 4);
		expect(model.bounds.center).toEqual([0, 0, 0]);
		expectOutwardSolid(model);
	});

	it("builds a sharp box when the radius is 0", () => {
		const model = generatePrimitiveGeometry({
			type: "roundedBox",
			width: 10,
			height: 10,
			depth: 10,
		});
		// Six single-quad faces.
		expect(model.meshes[0]!.indices.length).toBe(6 * 6);
		expectOutwardSolid(model);
	});

	it("tapers the top (-y) face and tilts the side normals up", () => {
		const model = generatePrimitiveGeometry({
			type: "roundedBox",
			width: 100,
			height: 20,
			depth: 100,
			radius: 0,
			taper: 0.8,
		});
		const { positions: p, normals: n } = model.meshes[0]!;
		let topHalfWidth = 0;
		let bottomHalfWidth = 0;
		for (let i = 0; i < p.length; i += 3) {
			if (p[i + 1]! < 0) topHalfWidth = Math.max(topHalfWidth, p[i]!);
			else bottomHalfWidth = Math.max(bottomHalfWidth, p[i]!);
			// A side vertex (|x| at its max) leans up: its normal has -y.
			if (Math.abs(n[i]!) > 0.9) expect(n[i + 1]!).toBeLessThan(0);
		}
		expect(topHalfWidth).toBeCloseTo(40, 4);
		expect(bottomHalfWidth).toBeCloseTo(50, 4);
		expectOutwardSolid(model);
	});

	it("builds spheres and capped cylinders wound outward", () => {
		expectOutwardSolid(
			generatePrimitiveGeometry({ type: "sphere", radius: 50, segments: 24 }),
		);
		const cyl = generatePrimitiveGeometry({
			type: "cylinder",
			radiusTop: 20,
			radiusBottom: 40,
			height: 60,
			segments: 24,
		});
		expect(cyl.bounds.size[1]).toBeCloseTo(60, 4);
		expect(cyl.bounds.size[0]).toBeCloseTo(80, 4);
		expectOutwardSolid(cyl);
	});

	it("bakes the color into the material", () => {
		const model = generatePrimitiveGeometry({
			type: "sphere",
			radius: 1,
			color: "#ff0000",
		});
		const material = Object.values(model.materials)[0]!;
		expect(material.diffuseColor).toEqual([1, 0, 0, 1]);
	});

	it("hands equal shapes the same mesh, so they share one GPU buffer", () => {
		const opts: PrimitiveGeometryOptions = {
			type: "roundedBox",
			width: 65,
			height: 15,
			depth: 65,
			radius: 6,
		};
		const a = getPrimitiveGeometry(opts);
		expect(getPrimitiveGeometry({ ...opts })).toBe(a);
		expect(getPrimitiveGeometry({ ...opts, width: 66 })).not.toBe(a);
	});

	it("builds a convex shard wound outward on all facets", () => {
		const shard = generatePrimitiveGeometry({
			type: "shard",
			radius: 40,
			facets: 16,
			seed: 42,
			irregularity: 0.4,
		});
		expect(shard.bounds.center[0]).toBeCloseTo(0, 1);
		expect(shard.bounds.center[1]).toBeCloseTo(0, 1);
		expect(shard.bounds.center[2]).toBeCloseTo(0, 1);
		expect(shard.bounds.boundingSphereRadius).toBeGreaterThan(15);
		expect(shard.bounds.boundingSphereRadius).toBeLessThanOrEqual(
			Math.hypot(40, 40, 40) + 1,
		);
		expectOutwardSolid(shard);

		// Equal shard specs share cached geometry
		const cached = getPrimitiveGeometry({
			type: "shard",
			radius: 40,
			facets: 16,
			seed: 42,
			irregularity: 0.4,
		});
		expect(
			getPrimitiveGeometry({
				type: "shard",
				radius: 40,
				facets: 16,
				seed: 42,
				irregularity: 0.4,
			}),
		).toBe(cached);
	});
});
