import { describe, expect, it } from "vitest";
import { generatePrimitiveGeometry } from "../renderer3d/primitive-geometry.js";
import { ClayField } from "./field.js";
import { BRICK_BYTES } from "./layout.js";
import { meshClay } from "./mesh.js";
import type { ClayGeometryOptions, ClayOp } from "./program.js";

const clay = (ops: ClayOp[], extra: Partial<ClayGeometryOptions> = {}) =>
	new ClayField({ type: "clay", ops, ...extra });

/** Deterministic points in a box of half-size `r`. */
function points(count: number, r: number): Array<[number, number, number]> {
	let seed = 12345;
	const next = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return (seed / 4294967296) * 2 - 1;
	};
	return Array.from({ length: count }, () => [
		next() * r,
		next() * r,
		next() * r,
	]);
}

describe("ClayField", () => {
	it("is an exact distance for a single solid", () => {
		const f = clay([{ type: "sphere", radius: 100 }]);
		expect(f.distance(0, 0, 0)).toBeCloseTo(-100, 4);
		expect(f.distance(100, 0, 0)).toBeCloseTo(0, 4);
		expect(f.distance(0, -130, 0)).toBeCloseTo(30, 4);
	});

	it("fits its bounds to the material and keeps only bricks near the surface", () => {
		const f = clay([{ type: "sphere", radius: 100 }], { bricks: 16 });
		expect(f.min[0]).toBeLessThan(-100);
		expect(f.min[0]).toBeGreaterThan(-110);
		const cells = f.dims[0] * f.dims[1] * f.dims[2];
		expect(f.brickCount).toBeGreaterThan(0);
		expect(f.brickCount).toBeLessThan(cells * 0.6);
	});

	it("carves and joins smoothly, blending colors across the join", () => {
		const f = clay([
			{ type: "sphere", radius: 100, color: "#ff0000" },
			{
				type: "sphere",
				radius: 100,
				center: [150, 0, 0],
				smoothness: 40,
				color: "#0000ff",
			},
			{ type: "sphere", radius: 40, center: [0, -100, 0], mode: "carve" },
		]);
		// The smooth join fills the waist between the two spheres.
		expect(f.distance(75, 66, 0)).toBeLessThan(0);
		expect(f.distance(0, -90, 0)).toBeGreaterThan(0);
		const waist = f.sample(75, 0, 60).color;
		expect(waist[0]).toBeGreaterThan(0.2);
		expect(waist[2]).toBeGreaterThan(0.2);
		expect(f.sample(-95, 0, 0).color).toEqual([1, 0, 0, 1]);
	});

	it("sweeps a stroke through its points and draws only its progress", () => {
		const path: ClayOp = {
			type: "stroke",
			radius: 10,
			path: [
				[0, 0, 0],
				[100, 0, 0],
				[100, 100, 0],
				[200, 100, 0],
			],
		};
		const whole = clay([path]);
		expect(whole.distance(0, 0, 0)).toBeCloseTo(-10, 3);
		expect(whole.distance(200, 100, 0)).toBeCloseTo(-10, 3);
		// The curve rounds the corners: it passes through the midpoint.
		expect(whole.distance(100, 50, 0)).toBeCloseTo(-10, 3);
		expect(whole.distance(100, 0, 0)).toBeGreaterThan(0);
		const half = clay([{ ...path, progress: 0.5 }]);
		expect(half.distance(0, 0, 0)).toBeCloseTo(-10, 3);
		expect(half.distance(200, 100, 0)).toBeGreaterThan(50);
	});

	it("tapers a stroke's radius along its length", () => {
		const f = clay([
			{
				type: "stroke",
				radius: 30,
				path: [
					[0, 0, 0, 30],
					[200, 0, 0, 5],
				],
			},
		]);
		expect(f.distance(0, 0, 0)).toBeCloseTo(-30, 3);
		expect(f.distance(100, 0, 0)).toBeCloseTo(-17.5, 3);
		expect(f.distance(200, 0, 0)).toBeCloseTo(-5, 3);
	});

	it("grabs the clay: the surface follows the pull", () => {
		const f = clay([
			{ type: "sphere", radius: 100 },
			{ type: "grab", center: [100, 0, 0], radius: 40, delta: [50, 0, 0] },
		]);
		// The pole moved out by about the pull; the far side stayed.
		expect(f.distance(140, 0, 0)).toBeLessThan(0);
		expect(f.distance(160, 0, 0)).toBeGreaterThan(0);
		expect(f.distance(-100, 0, 0)).toBeCloseTo(0, 1);
	});

	it("twists and bulges without tearing the field", () => {
		const f = clay([
			{ type: "box", size: [200, 60, 60] },
			{
				type: "twist",
				center: [0, 0, 0],
				radius: 80,
				axis: [1, 0, 0],
				angle: 45,
			},
			{ type: "bulge", center: [0, 0, 0], radius: 50, amount: 0.3 },
		]);
		expect(f.distance(0, 0, 0)).toBeLessThan(-20);
		// The box's face was at z = 30: its corner has turned to here.
		expect(f.distance(0, 0, 38)).toBeLessThan(0);
		expect(f.distance(0, 0, 60)).toBeGreaterThan(0);
	});

	it("mirrors across the symmetry axes", () => {
		const f = clay(
			[
				{ type: "sphere", radius: 60 },
				{ type: "sphere", radius: 30, center: [70, -20, 10] },
			],
			{ symmetry: "x" },
		);
		for (const [x, y, z] of points(50, 110)) {
			expect(f.distance(x, y, z)).toBeCloseTo(f.distance(-x, y, z), 6);
		}
		expect(f.distance(-90, -20, 10)).toBeLessThan(0);
	});

	it("gives the same field however finely it is binned", () => {
		const ops: ClayOp[] = [
			{ type: "sphere", radius: 90 },
			{ type: "box", size: [60, 200, 60], smoothness: 20 },
			{
				type: "stroke",
				radius: 14,
				smoothness: 8,
				path: [
					[-120, -60, 40],
					[-20, -110, 90],
					[90, -40, 60],
					[130, 50, 0],
				],
			},
			{ type: "grab", center: [0, -100, 0], radius: 50, delta: [0, -40, 20] },
			{ type: "sphere", radius: 30, center: [80, 0, 0], mode: "carve" },
			{ type: "inflate", center: [-60, 40, 0], radius: 70, amount: 12 },
			{ type: "detail", amplitude: 3, scale: 24, octaves: 3, seed: 7 },
		];
		const coarse = clay(ops, { bricks: 4 });
		const fine = clay(ops, { bricks: 24 });
		let compared = 0;
		for (const [x, y, z] of points(4000, 150)) {
			const whole = fine.distance(x, y, z);
			expect(coarse.distance(x, y, z)).toBeCloseTo(whole, 9);
			// A brick's list is the whole field only near the surface.
			if (Math.abs(whole) > 1) continue;
			expect(fine.local(x, y, z)).toBeCloseTo(whole, 3);
			expect(coarse.local(x, y, z)).toBeCloseTo(whole, 3);
			compared++;
		}
		expect(compared).toBeGreaterThan(20);
	});

	it("never skips a brick the surface crosses", () => {
		const f = clay(
			[
				{ type: "torus", radius: 80, tube: 25, rotation: [30, 0, 20] },
				{
					type: "twist",
					center: [80, 0, 0],
					radius: 40,
					axis: [0, 1, 0],
					angle: 60,
				},
				{ type: "detail", amplitude: 4, scale: 30, ridged: true },
			],
			{ bricks: 12 },
		);
		const drawn = new Set<string>();
		const bricks = new Float32Array(f.bricks);
		const stride = BRICK_BYTES / 4;
		for (let i = 0; i < f.brickCount; i++) {
			drawn.add(
				[0, 1, 2]
					.map((k) =>
						Math.round((bricks[i * stride + k] - f.min[k]) / f.brickSize),
					)
					.join(","),
			);
		}
		const step = f.brickSize / 6;
		const at = (i: number, k: number) => f.min[k] + i * step;
		for (let i = 0; at(i + 1, 0) < f.max[0]; i++) {
			for (let j = 0; at(j, 1) < f.max[1]; j++) {
				for (let k = 0; at(k, 2) < f.max[2]; k++) {
					const a = f.distance(at(i, 0), at(j, 1), at(k, 2));
					const b = f.distance(at(i + 1, 0), at(j, 1), at(k, 2));
					if (a < 0 === b < 0) continue;
					const cell = [i, j, k].map((v) => Math.floor(v / 6)).join(",");
					const next = [i + 1, j, k].map((v) => Math.floor(v / 6)).join(",");
					expect(drawn.has(cell) || drawn.has(next)).toBe(true);
				}
			}
		}
	});

	it("drops detail finer than the footprint", () => {
		const f = clay([
			{ type: "sphere", radius: 100 },
			{ type: "detail", amplitude: 5, scale: 10, octaves: 4 },
		]);
		const smooth = clay([{ type: "sphere", radius: 100 }]);
		const scratch = (footprint: number) => {
			let worst = 0;
			for (const [x, y, z] of points(200, 60)) {
				const len = Math.hypot(x, y, z) / 100;
				const p: [number, number, number] = [x / len, y / len, z / len];
				worst = Math.max(
					worst,
					Math.abs(f.distance(...p, footprint) - smooth.distance(...p)),
				);
			}
			return worst;
		};
		expect(scratch(0)).toBeGreaterThan(1);
		expect(scratch(40)).toBe(0);
	});

	it("rejects more overlapping warps than one evaluation can undo", () => {
		const warps: ClayOp[] = Array.from({ length: 20 }, () => ({
			type: "bulge",
			center: [0, 0, 0],
			radius: 50,
			amount: 0.3,
		}));
		expect(() => clay([{ type: "sphere", radius: 100 }, ...warps])).toThrow(
			/warp steps overlap/,
		);
	});
});

/** How many triangles use each edge of an indexed mesh: count → edges. */
function edgeUse(indices: ArrayLike<number>, vertices: number) {
	const edges = new Map<number, number>();
	for (let t = 0; t < indices.length; t += 3) {
		for (let e = 0; e < 3; e++) {
			const a = indices[t + e];
			const b = indices[t + ((e + 1) % 3)];
			const key = a < b ? a * vertices + b : b * vertices + a;
			edges.set(key, (edges.get(key) ?? 0) + 1);
		}
	}
	const use = new Map<number, number>();
	for (const n of edges.values()) use.set(n, (use.get(n) ?? 0) + 1);
	return use;
}

describe("meshClay", () => {
	const blob: ClayOp[] = [
		{ type: "sphere", radius: 110 },
		{ type: "sphere", radius: 70, center: [0, -130, 0], smoothness: 40 },
		{ type: "sphere", radius: 30, center: [40, -40, -95], mode: "carve" },
		{ type: "grab", center: [0, -200, 0], radius: 40, delta: [0, -40, 0] },
	];

	it("keeps a shape in reach of a later smooth join", () => {
		// The first sphere has no blend of its own: the second one's reaches it.
		const f = clay(blob.slice(0, 2), { bricks: 32 });
		for (const [x, y, z] of points(3000, 190)) {
			const whole = f.distance(x, y, z);
			if (Math.abs(whole) < 1) expect(f.local(x, y, z)).toBeCloseTo(whole, 4);
		}
	});

	it("is closed and lies on the surface at every resolution", () => {
		const f = clay(blob);
		let before = 0;
		for (const resolution of [64, 128, 256]) {
			const g = meshClay(f, resolution);
			const triangles = g.indices.length / 3;
			// Four times the triangles for twice the resolution: work follows the area.
			if (before) expect(triangles / before).toBeGreaterThan(3.5);
			before = triangles;
			// Closed: no edge is left with an odd number of triangles (a hard
			// crease can pinch four onto one, as Surface Nets does).
			const use = [...edgeUse(g.indices, g.positions.length / 3).keys()];
			expect(use.every((n) => n % 2 === 0)).toBe(true);
			const cell = (f.max[0] - f.min[0]) / resolution;
			for (let v = 0; v < g.positions.length; v += 3 * 53) {
				const d = f.distance(
					g.positions[v],
					g.positions[v + 1],
					g.positions[v + 2],
				);
				expect(Math.abs(d)).toBeLessThan(cell);
			}
		}
	});

	it("carries the field's colors", () => {
		const f = clay([
			{ type: "sphere", radius: 50, color: "#ff0000" },
			{ type: "sphere", radius: 50, center: [120, 0, 0], color: "#0000ff" },
		]);
		const g = meshClay(f, 64);
		expect(g.colors.length).toBe((g.positions.length / 3) * 4);
		for (let v = 0; v < g.positions.length / 3; v++) {
			const red = g.positions[v * 3] < 60;
			expect(g.colors[v * 4]).toBe(red ? 1 : 0);
			expect(g.colors[v * 4 + 2]).toBe(red ? 0 : 1);
		}
	});
});

describe("clay primitive", () => {
	it("yields a closed mesh that carries its field", () => {
		const model = generatePrimitiveGeometry({
			type: "clay",
			resolution: 32,
			ops: [
				{ type: "sphere", radius: 100 },
				{ type: "sphere", radius: 60, center: [90, 0, 0], smoothness: 20 },
			],
		});
		const mesh = model.meshes[0];
		expect(mesh.clay).toBeInstanceOf(ClayField);
		const triangles = generatePrimitiveGeometry({
			type: "clay",
			draw: "mesh",
			ops: [{ type: "sphere", radius: 100 }],
		});
		expect(triangles.meshes[0].clay).toBeUndefined();
		expect(mesh.indices.length).toBeGreaterThan(1000);
		// Closed: every edge is shared by exactly two triangles.
		const edges = new Map<string, number>();
		for (let t = 0; t < mesh.indices.length; t += 3) {
			for (let e = 0; e < 3; e++) {
				const a = mesh.indices[t + e];
				const b = mesh.indices[t + ((e + 1) % 3)];
				const key = a < b ? `${a},${b}` : `${b},${a}`;
				edges.set(key, (edges.get(key) ?? 0) + 1);
			}
		}
		expect([...edges.values()].every((n) => n === 2)).toBe(true);
		// Vertices sit on the field's surface, within a fraction of a cell.
		for (let v = 0; v < mesh.positions.length; v += 300) {
			const d = mesh.clay?.distance(
				mesh.positions[v],
				mesh.positions[v + 1],
				mesh.positions[v + 2],
			);
			expect(Math.abs(d ?? 99)).toBeLessThan(3);
		}
	});
});
