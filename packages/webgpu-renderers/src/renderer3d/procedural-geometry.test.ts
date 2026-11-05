import { describe, expect, it } from "vitest";
import type { Mesh3DData } from "../loaders/types.js";
import { Matrix4Math } from "../math3d/matrix4.js";
import { generatePrimitiveGeometry } from "./primitive-geometry.js";
import { scatterOnSurface, seatOnSurface } from "./scatter.js";
import { SdfField, type SdfGeometryOptions } from "./sdf-geometry.js";
import {
	createTerrainSampler,
	type TerrainGeometryOptions,
	terrainHeights,
} from "./terrain-geometry.js";

/**
 * Closed and consistently wound: welded by position, every edge is used by
 * exactly two triangles, once in each direction.
 */
function expectWatertight(mesh: Mesh3DData): void {
	const p = mesh.positions;
	const weld = new Map<string, number>();
	const id = (i: number) => {
		const k = `${p[i * 3]!.toFixed(3)},${p[i * 3 + 1]!.toFixed(3)},${p[i * 3 + 2]!.toFixed(3)}`;
		let v = weld.get(k);
		if (v === undefined) {
			v = weld.size;
			weld.set(k, v);
		}
		return v;
	};
	const edges = new Map<string, number>();
	const idx = mesh.indices;
	let degenerate = 0;
	for (let t = 0; t < idx.length; t += 3) {
		const v = [id(idx[t]!), id(idx[t + 1]!), id(idx[t + 2]!)];
		if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) {
			degenerate++;
			continue;
		}
		for (let e = 0; e < 3; e++) {
			const k = `${v[e]}>${v[(e + 1) % 3]}`;
			edges.set(k, (edges.get(k) ?? 0) + 1);
		}
	}
	const bad: string[] = [];
	for (const [k, n] of edges) {
		const [a, b] = k.split(">");
		if (n !== 1 || edges.get(`${b}>${a}`) !== 1) bad.push(k);
	}
	expect(bad.length).toBe(0);
	expect(edges.size).toBeGreaterThan(0);
	expect(degenerate).toBeLessThan(idx.length / 3);
}

const TERRAIN: TerrainGeometryOptions = {
	type: "terrain",
	width: 800,
	depth: 600,
	height: 200,
	segments: [48, 36],
	noise: { seed: 7, ridgeMode: "ridged" },
};

describe("terrain geometry", () => {
	it("spans exactly the requested relief and is deterministic", () => {
		const h = terrainHeights(TERRAIN);
		expect(Math.min(...h)).toBeCloseTo(0, 6);
		expect(Math.max(...h)).toBeCloseTo(1, 6);
		expect(Array.from(terrainHeights(TERRAIN))).toEqual(Array.from(h));
		const other = terrainHeights({
			...TERRAIN,
			noise: { ...TERRAIN.noise, seed: 8 },
		});
		expect(Array.from(other)).not.toEqual(Array.from(h));
	});

	it("closes into a watertight block, warped or faceted", () => {
		for (const extra of [
			{},
			{ overhangWarp: 40 },
			{ flatShaded: true },
			{ noise: { ridgeMode: "terrace" as const, terraceSteps: 5 } },
		]) {
			const model = generatePrimitiveGeometry({ ...TERRAIN, ...extra });
			expectWatertight(model.meshes[0]!);
		}
	});

	it("colors faces by altitude and slope", () => {
		const model = generatePrimitiveGeometry({
			...TERRAIN,
			colorByElevation: {
				lowColor: "#00ff00",
				highColor: "#ffffff",
				cliffColor: "#ff0000",
				cliffThreshold: 0.2,
			},
		});
		const mesh = model.meshes[0]!;
		const colors = mesh.colors!;
		expect(colors.length).toBe((mesh.positions.length / 3) * 4);
		// The lowest vertex is green, the highest white.
		let lo = 0;
		let hi = 0;
		const p = mesh.positions;
		const count = (48 + 1) * (36 + 1);
		for (let v = 0; v < count; v++) {
			if (p[v * 3 + 1]! > p[lo * 3 + 1]!) lo = v;
			if (p[v * 3 + 1]! < p[hi * 3 + 1]!) hi = v;
		}
		expect(colors[lo * 4 + 1]).toBeGreaterThan(0.9);
		expect(colors[lo * 4]).toBeLessThan(0.1);
		expect(colors[hi * 4 + 2]).toBeGreaterThan(0.6);
	});

	it("samples the surface other layers stand on", () => {
		const s = createTerrainSampler(TERRAIN);
		const h = terrainHeights(TERRAIN);
		// Grid points match exactly; the corner is (-w/2, -d/2).
		expect(s.heightAt(-400, -300)).toBeCloseTo(-h[0]! * 200, 6);
		const n = s.normalAt(10, 20);
		expect(Math.hypot(...n)).toBeCloseTo(1, 6);
		expect(n[1]).toBeLessThan(0);
		// Custom heights: a ramp rising toward +x.
		const ramp = createTerrainSampler({
			type: "terrain",
			width: 100,
			depth: 100,
			height: 50,
			segments: 2,
			heights: [0, 0.5, 1, 0, 0.5, 1, 0, 0.5, 1],
		});
		expect(ramp.heightAt(0, 0)).toBeCloseTo(-25);
		expect(ramp.heightAt(25, 10)).toBeCloseTo(-37.5);
		expect(ramp.normalAt(0, 0)[0]).toBeLessThan(0);
	});
});

const SCULPT: SdfGeometryOptions = {
	type: "sdf",
	bounds: [300, 300, 300],
	resolution: 40,
	primitives: [
		{ shape: "box", size: [200, 200, 200], radius: 20, color: "#ff0000" },
		{ shape: "sphere", radius: 130, op: "intersect", smoothness: 10 },
		{
			shape: "cylinder",
			radius: 50,
			height: 400,
			op: "subtract",
			smoothness: 8,
			color: "#0000ff",
		},
		{ shape: "torus", radius: 110, tube: 18, center: [0, -60, 0] },
	],
};

describe("sdf geometry", () => {
	it("combines shapes with hard and smooth booleans", () => {
		const union = new SdfField({
			type: "sdf",
			bounds: [400, 400, 400],
			primitives: [
				{ shape: "sphere", radius: 50, center: [-40, 0, 0] },
				{ shape: "sphere", radius: 50, center: [40, 0, 0], smoothness: 30 },
			],
		});
		// The smooth union bulges past both spheres between them.
		expect(union.distance(0, 0, 0)).toBeLessThan(-15);
		expect(union.distance(0, -32, 0)).toBeLessThan(0);
		expect(new SdfField({ ...SCULPT }).distance(0, 0, 0)).toBeGreaterThan(0);
		// A rotated box: 90° about z swaps its x and y extents.
		const turned = new SdfField({
			type: "sdf",
			bounds: [400, 400, 400],
			primitives: [{ shape: "box", size: [200, 20, 20], rotation: [0, 0, 90] }],
		});
		expect(turned.distance(0, 90, 0)).toBeLessThan(0);
		expect(turned.distance(90, 0, 0)).toBeGreaterThan(0);
	});

	it("meshes a watertight surface with gradient normals", () => {
		const model = generatePrimitiveGeometry(SCULPT);
		const mesh = model.meshes[0]!;
		expectWatertight(mesh);
		const field = new SdfField(SCULPT);
		const p = mesh.positions;
		const n = mesh.normals;
		for (let v = 0; v < p.length / 3; v += 37) {
			const [x, y, z] = [p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!];
			expect(Math.abs(field.distance(x, y, z))).toBeLessThan(6);
			// Stepping along the normal leaves the solid.
			const s = 4;
			expect(
				field.distance(
					x + n[v * 3]! * s,
					y + n[v * 3 + 1]! * s,
					z + n[v * 3 + 2]! * s,
				),
			).toBeGreaterThan(field.distance(x, y, z));
		}
		// The cut through the middle takes the cutter's blue.
		const colors = mesh.colors!;
		let blue = 0;
		for (let v = 0; v < p.length / 3; v++) {
			if (Math.hypot(p[v * 3]!, p[v * 3 + 2]!) < 55 && colors[v * 4 + 2]! > 0.8)
				blue++;
		}
		expect(blue).toBeGreaterThan(10);
	});

	it("clips an unbounded gyroid to its bounds", () => {
		const model = generatePrimitiveGeometry({
			type: "sdf",
			bounds: [200, 200, 200],
			resolution: 32,
			primitives: [{ shape: "gyroid", scale: 80, thickness: 12 }],
		});
		expectWatertight(model.meshes[0]!);
		const b = model.bounds!;
		expect(b.max[0]).toBeLessThanOrEqual(101);
		expect(b.min[1]).toBeGreaterThanOrEqual(-101);
	});
});

describe("scatter", () => {
	const terrain = generatePrimitiveGeometry(TERRAIN);
	const matrix = Matrix4Math.translate(1000, 500, 0);

	it("places the same points for the same seed, on the surface", () => {
		const opts = { count: 200, seed: 3, minDistance: 25 };
		const a = scatterOnSurface({ model: terrain, matrix }, opts);
		const b = scatterOnSurface({ model: terrain, matrix }, opts);
		expect(a.points.length).toBe(200);
		expect(b.points).toEqual(a.points);
		const sampler = createTerrainSampler(TERRAIN);
		for (const pt of a.points) {
			const [x, y, z] = pt.position;
			expect(y - 500).toBeCloseTo(sampler.heightAt(x - 1000, z), 3);
		}
		// Poisson spacing.
		let closest = Number.POSITIVE_INFINITY;
		for (let i = 0; i < a.points.length; i++)
			for (let j = i + 1; j < a.points.length; j++) {
				const p = a.points[i]!.position;
				const q = a.points[j]!.position;
				closest = Math.min(
					closest,
					Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]),
				);
			}
		expect(closest).toBeGreaterThanOrEqual(25);
	});

	it("filters by slope, altitude and exclusion zones", () => {
		const high = scatterOnSurface(
			{ model: terrain },
			{ count: 150, elevationRange: [0.6, 1], slopeRange: [0, 30] },
		);
		expect(high.points.length).toBeGreaterThan(0);
		for (const p of high.points) {
			expect(p.elevation).toBeGreaterThan(0.55);
			expect((Math.acos(-p.normal[1]) * 180) / Math.PI).toBeLessThanOrEqual(
				30.001,
			);
		}
		const cleared = scatterOnSurface(
			{ model: terrain },
			{ count: 300, exclude: [{ x: 0, z: 0, radius: 150 }] },
		);
		for (const p of cleared.points)
			expect(Math.hypot(p.position[0], p.position[2])).toBeGreaterThanOrEqual(
				150,
			);
		const none = scatterOnSurface(
			{ model: terrain },
			{ count: 50, slopeRange: [0, 30], elevationRange: [1.1, 2] },
		);
		expect(none.points.length).toBe(0);
		expect(none.acceptedArea).toBe(0);
	});

	it("stands instances on their base, leaning toward the normal", () => {
		const [pt] = scatterOnSurface(
			{ model: terrain },
			{ count: 1, alignToNormal: 1, randomYaw: false, scaleRange: [2, 2] },
		).points;
		// A mesh whose lowest point is local y = 10 (up is -y) rests on the surface.
		const at = seatOnSurface(pt!, 10);
		const n = pt!.normal;
		for (let k = 0; k < 3; k++)
			expect(at[k]! - n[k]! * 20).toBeCloseTo(pt!.position[k]!, 5);
	});
});
