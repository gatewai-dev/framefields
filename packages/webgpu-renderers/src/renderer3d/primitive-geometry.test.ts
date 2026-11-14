import { describe, expect, it } from "vitest";
import type { Model3DData } from "../loaders/types.js";
import {
	generatePrimitiveGeometry,
	getPrimitiveGeometry,
	type PrimitiveGeometryOptions,
	primitiveDetailForScreen,
	screenSegments,
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

	it("rejects negative or non-finite sizes instead of building inside out", () => {
		const box = { type: "roundedBox", width: 100, depth: 100 } as const;
		expect(() =>
			generatePrimitiveGeometry({ ...box, height: -12, radius: 0 }),
		).toThrow(/roundedBox: `height` must be a finite size >= 0, got -12/);
		expect(() =>
			generatePrimitiveGeometry({
				type: "cylinder",
				radius: 10,
				height: Number.NaN,
			}),
		).toThrow(/cylinder: `height`/);
		expect(() =>
			generatePrimitiveGeometry({ type: "sphere", radius: -1 }),
		).toThrow(/sphere: `radius`/);
		// Zero is a flat (degenerate) solid, not an inverted one.
		expect(() =>
			generatePrimitiveGeometry({ ...box, height: 0 }),
		).not.toThrow();
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

	it("builds torus and partial-arc torus wound outward", () => {
		const full = generatePrimitiveGeometry({
			type: "torus",
			radius: 80,
			tube: 20,
			radialSegments: 16,
			tubularSegments: 32,
		});
		expect(full.bounds.size[0]).toBeCloseTo(200, 1);
		expect(full.bounds.size[1]).toBeCloseTo(200, 1);
		expect(full.bounds.size[2]).toBeCloseTo(40, 1);
		// Verify every triangle face normal agrees with its vertex normal
		const mesh = full.meshes[0]!;
		const p = mesh.positions;
		const n = mesh.normals;
		const at = (i: number): V => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
		const normalAt = (i: number): V => [
			n[i * 3]!,
			n[i * 3 + 1]!,
			n[i * 3 + 2]!,
		];
		for (let t = 0; t < mesh.indices.length; t += 3) {
			const [i0, i1, i2] = [
				mesh.indices[t]!,
				mesh.indices[t + 1]!,
				mesh.indices[t + 2]!,
			];
			const a = at(i0);
			const face = cross(sub(at(i1), a), sub(at(i2), a));
			if (Math.hypot(...face) < 1e-6) continue;
			expect(dot(face, normalAt(i0))).toBeGreaterThan(0);
		}

		const partial = generatePrimitiveGeometry({
			type: "torus",
			radius: 80,
			tube: 20,
			arc: 180,
		});
		const pMesh = partial.meshes[0]!;
		expect(pMesh.indices.length).toBeGreaterThan(0);
		for (let t = 0; t < pMesh.indices.length; t += 3) {
			const [i0, i1, i2] = [
				pMesh.indices[t]!,
				pMesh.indices[t + 1]!,
				pMesh.indices[t + 2]!,
			];
			const a: V = [
				pMesh.positions[i0 * 3]!,
				pMesh.positions[i0 * 3 + 1]!,
				pMesh.positions[i0 * 3 + 2]!,
			];
			const b: V = [
				pMesh.positions[i1 * 3]!,
				pMesh.positions[i1 * 3 + 1]!,
				pMesh.positions[i1 * 3 + 2]!,
			];
			const c: V = [
				pMesh.positions[i2 * 3]!,
				pMesh.positions[i2 * 3 + 1]!,
				pMesh.positions[i2 * 3 + 2]!,
			];
			const face = cross(sub(b, a), sub(c, a));
			if (Math.hypot(...face) < 1e-6) continue;
			const vn: V = [
				pMesh.normals[i0 * 3]!,
				pMesh.normals[i0 * 3 + 1]!,
				pMesh.normals[i0 * 3 + 2]!,
			];
			expect(dot(face, vn)).toBeGreaterThan(0);
		}
	});

	it("builds a capsule wound outward with total height length + 2 * radius", () => {
		const cap = generatePrimitiveGeometry({
			type: "capsule",
			radius: 25,
			length: 70,
			capSegments: 8,
			radialSegments: 24,
		});
		expect(cap.bounds.size[0]).toBeCloseTo(50, 1);
		expect(cap.bounds.size[1]).toBeCloseTo(120, 1);
		expect(cap.bounds.size[2]).toBeCloseTo(50, 1);
		expectOutwardSolid(cap);
	});

	it("builds flat and thick-walled rings with outward normals", () => {
		const flatRing = generatePrimitiveGeometry({
			type: "ring",
			innerRadius: 30,
			outerRadius: 60,
		});
		expect(flatRing.bounds.size[0]).toBeCloseTo(120, 1);
		expect(flatRing.bounds.size[1]).toBeCloseTo(120, 1);
		expect(flatRing.bounds.size[2]).toBeCloseTo(0, 4);

		const solidRing = generatePrimitiveGeometry({
			type: "ring",
			innerRadius: 30,
			outerRadius: 60,
			depth: 16,
		});
		expect(solidRing.bounds.size[2]).toBeCloseTo(16, 4);
		const mesh = solidRing.meshes[0]!;
		const p = mesh.positions;
		const n = mesh.normals;
		const at = (i: number): V => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
		const normalAt = (i: number): V => [
			n[i * 3]!,
			n[i * 3 + 1]!,
			n[i * 3 + 2]!,
		];
		for (let t = 0; t < mesh.indices.length; t += 3) {
			const [i0, i1, i2] = [
				mesh.indices[t]!,
				mesh.indices[t + 1]!,
				mesh.indices[t + 2]!,
			];
			const a = at(i0);
			const face = cross(sub(at(i1), a), sub(at(i2), a));
			if (Math.hypot(...face) < 1e-6) continue;
			expect(dot(face, normalAt(i0))).toBeGreaterThan(0);
		}
	});

	it("builds flat-shaded prisms and pyramids with caps and outward normals", () => {
		const hexPrism = generatePrimitiveGeometry({
			type: "cylinder",
			radiusTop: 40,
			radiusBottom: 40,
			height: 80,
			segments: 6,
			flatShaded: true,
		});
		expectOutwardSolid(hexPrism);

		const pyramid = generatePrimitiveGeometry({
			type: "cylinder",
			radiusTop: 0,
			radiusBottom: 50,
			height: 90,
			segments: 4,
			flatShaded: true,
		});
		expectOutwardSolid(pyramid);
	});

	it("builds all Platonic polyhedra and subdivided icospheres wound outward", () => {
		for (const shape of [
			"tetrahedron",
			"octahedron",
			"dodecahedron",
			"icosahedron",
			"icosphere",
		] as const) {
			const model = generatePrimitiveGeometry({
				type: "polyhedron",
				shape,
				radius: 50,
			});
			expectOutwardSolid(model);
		}
		const subdivided = generatePrimitiveGeometry({
			type: "polyhedron",
			shape: "icosahedron",
			radius: 50,
			detail: 2,
			flatShaded: true,
		});
		expectOutwardSolid(subdivided);
		// 20 * 4^2 = 320 triangles -> 960 indices
		expect(subdivided.meshes[0]!.indices.length).toBe(20 * 16 * 3);
	});

	it("extrudes 2D SVG paths (with holes and bevels) and polygon contours", () => {
		const svgWithHole =
			"M 0 0 L 100 0 L 100 100 L 0 100 Z M 25 25 L 25 75 L 75 75 L 75 25 Z";
		const extruded = generatePrimitiveGeometry({
			type: "extrude",
			shape: svgWithHole,
			depth: 24,
			bevelThickness: 3,
			bevelSize: 2,
			bevelSegments: 2,
			color: "#38bdf8",
			bevelColor: "#0284c7",
		});
		expect(extruded.meshes.length).toBe(2);
		expect(extruded.bounds.size[0]).toBeCloseTo(100, 1);
		expect(extruded.bounds.size[1]).toBeCloseTo(100, 1);
		expect(extruded.bounds.size[2]).toBeCloseTo(24, 1);

		for (const mesh of extruded.meshes) {
			const p = mesh.positions;
			const n = mesh.normals;
			const at = (i: number): V => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
			const normalAt = (i: number): V => [
				n[i * 3]!,
				n[i * 3 + 1]!,
				n[i * 3 + 2]!,
			];
			for (let t = 0; t < mesh.indices.length; t += 3) {
				const [i0, i1, i2] = [
					mesh.indices[t]!,
					mesh.indices[t + 1]!,
					mesh.indices[t + 2]!,
				];
				const a = at(i0);
				const face = cross(sub(at(i1), a), sub(at(i2), a));
				if (Math.hypot(...face) < 1e-6) continue;
				expect(dot(face, normalAt(i0))).toBeGreaterThan(0);
			}
		}
	});

	it("revolves a 2D profile with lathe and caps the ends", () => {
		const goblet = generatePrimitiveGeometry({
			type: "lathe",
			points: [
				[25, -50],
				[35, -10],
				[10, 20],
				[30, 50],
			],
			segments: 24,
			capped: true,
		});
		expect(goblet.bounds.size[0]).toBeCloseTo(70, 1);
		expect(goblet.bounds.size[1]).toBeCloseTo(100, 1);
		const mesh = goblet.meshes[0]!;
		const p = mesh.positions;
		const n = mesh.normals;
		const at = (i: number): V => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
		const normalAt = (i: number): V => [
			n[i * 3]!,
			n[i * 3 + 1]!,
			n[i * 3 + 2]!,
		];
		for (let t = 0; t < mesh.indices.length; t += 3) {
			const [i0, i1, i2] = [
				mesh.indices[t]!,
				mesh.indices[t + 1]!,
				mesh.indices[t + 2]!,
			];
			const a = at(i0);
			const face = cross(sub(at(i1), a), sub(at(i2), a));
			if (Math.hypot(...face) < 1e-6) continue;
			expect(dot(face, normalAt(i0))).toBeGreaterThan(0);
		}
	});

	it("sweeps solid and hollow thick-walled tubes along 3D paths", () => {
		const solidTube = generatePrimitiveGeometry({
			type: "tube",
			path: [
				[-100, 0, 0],
				[0, -60, 40],
				[100, 0, 0],
			],
			radius: 14,
			tubularSegments: 32,
			radialSegments: 12,
		});
		expect(solidTube.bounds.size[0]).toBeGreaterThan(200);

		const hollowPipe = generatePrimitiveGeometry({
			type: "tube",
			path: {
				kind: "helix",
				radius: 60,
				pitch: 40,
				turns: 1.5,
			},
			radius: 14,
			innerRadius: 9,
			tubularSegments: 48,
			radialSegments: 12,
		});
		const mesh = hollowPipe.meshes[0]!;
		const p = mesh.positions;
		const n = mesh.normals;
		const at = (i: number): V => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
		const normalAt = (i: number): V => [
			n[i * 3]!,
			n[i * 3 + 1]!,
			n[i * 3 + 2]!,
		];
		for (let t = 0; t < mesh.indices.length; t += 3) {
			const [i0, i1, i2] = [
				mesh.indices[t]!,
				mesh.indices[t + 1]!,
				mesh.indices[t + 2]!,
			];
			const a = at(i0);
			const face = cross(sub(at(i1), a), sub(at(i2), a));
			if (Math.hypot(...face) < 1e-6) continue;
			expect(dot(face, normalAt(i0))).toBeGreaterThan(0);
		}
	});

	it("builds 3D line-list and point-list / spherical point geometries", () => {
		const line = generatePrimitiveGeometry({
			type: "line3d",
			points: [
				[0, 0, 0],
				[100, 0, 0],
				[100, 100, 0],
			],
			dashSize: 10,
			gapSize: 5,
			colors: ["#ff0000", "#00ff00", "#0000ff"],
		});
		expect(line.meshes[0]!.topology).toBe("line-list");
		expect(line.meshes[0]!.colors).toBeDefined();

		const pixelPoints = generatePrimitiveGeometry({
			type: "points3d",
			points: [
				[0, 0, 0],
				[50, 50, 50],
			],
		});
		expect(pixelPoints.meshes[0]!.topology).toBe("point-list");

		const spherePoints = generatePrimitiveGeometry({
			type: "points3d",
			points: [
				[0, 0, 0],
				[50, 50, 50],
			],
			pointSize: 6,
		});
		expect(spherePoints.meshes[0]!.topology).toBeUndefined();
		expect(spherePoints.meshes[0]!.indices.length).toBeGreaterThan(100);
	});
});

describe("detail from on-screen size", () => {
	it("keeps the outline within a quarter pixel, in powers of two, from the default up to 256", () => {
		expect(screenSegments(10, 32)).toBe(32); // small: the default is plenty
		expect(screenSegments(100, 32)).toBe(64);
		expect(screenSegments(310, 32)).toBe(128);
		expect(screenSegments(5000, 32)).toBe(256);
		expect(screenSegments(Number.NaN, 32)).toBe(32);
		// Whatever it picks, the sagitta stays under tolerance (until the cap).
		for (const r of [40, 120, 600, 1100]) {
			const n = screenSegments(r, 32);
			expect(r * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(0.25);
		}
	});

	it("refines spheres, cylinders, capsules and tori it draws large, and nothing else", () => {
		const sphere: PrimitiveGeometryOptions = { type: "sphere", radius: 62 };
		expect(primitiveDetailForScreen(sphere, 0.5)).toBe(sphere); // 31 px: 32 holds
		expect(primitiveDetailForScreen(sphere, 5)).toEqual({
			...sphere,
			segments: 128,
		});
		const own: PrimitiveGeometryOptions = {
			type: "sphere",
			radius: 62,
			segments: 12,
		};
		expect(primitiveDetailForScreen(own, 5)).toBe(own); // a set count wins
		expect(
			primitiveDetailForScreen(
				{ type: "cylinder", height: 10, radiusTop: 400 },
				1,
			),
		).toMatchObject({ segments: 128 });
		const flat: PrimitiveGeometryOptions = {
			type: "cylinder",
			height: 10,
			radius: 400,
			flatShaded: true,
		};
		expect(primitiveDetailForScreen(flat, 1)).toBe(flat);
		expect(
			primitiveDetailForScreen({ type: "capsule", radius: 400 }, 1),
		).toMatchObject({
			radialSegments: 128,
			capSegments: 32,
		});
		expect(
			primitiveDetailForScreen({ type: "torus", radius: 300, tube: 100 }, 1),
		).toMatchObject({ radialSegments: 64, tubularSegments: 128 });
		const box: PrimitiveGeometryOptions = {
			type: "roundedBox",
			width: 900,
			height: 900,
			depth: 900,
		};
		expect(primitiveDetailForScreen(box, 4)).toBe(box);
	});

	it("builds a smoother sphere when asked: more segments, the same size", () => {
		const coarse = generatePrimitiveGeometry({ type: "sphere", radius: 50 });
		const fine = generatePrimitiveGeometry(
			primitiveDetailForScreen({ type: "sphere", radius: 50 }, 8),
		);
		const verts = (m: Model3DData) =>
			m.meshes.reduce((n, mesh) => n + mesh.positions.length / 3, 0);
		expect(verts(fine)).toBeGreaterThan(verts(coarse) * 3);
		expect(fine.bounds.size).toEqual(coarse.bounds.size);
	});
});
