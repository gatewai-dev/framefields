/**
 * Sculpting: the narrow-band mesh is closed and on the true surface,
 * simplification keeps it closed and near its volume, materials split
 * into primitives along their borders, and weights from the field bend a
 * blended elbow without collapsing it.
 */
import { parseGLB } from "@framefields/webgpu-renderers";
import { validateBytes } from "gltf-validator";
import { describe, expect, it } from "vitest";
import {
	GltfDocument,
	humanoidSkeleton,
	limb,
	mirrorParts,
	type Part,
	SculptField,
	Skeleton,
	sculpt,
	type Vec3,
} from "../index.js";

const volumeOf = (positions: ArrayLike<number>, indices: ArrayLike<number>) => {
	let v = 0;
	for (let t = 0; t < indices.length; t += 3) {
		const p = [0, 1, 2].map((k) => {
			const i = (indices[t + k] as number) * 3;
			return [positions[i], positions[i + 1], positions[i + 2]] as Vec3;
		}) as [Vec3, Vec3, Vec3];
		const [a, b, c] = p;
		v +=
			a[0] * (b[1] * c[2] - b[2] * c[1]) -
			a[1] * (b[0] * c[2] - b[2] * c[0]) +
			a[2] * (b[0] * c[1] - b[1] * c[0]);
	}
	return v / 6;
};

describe("sculpt", () => {
	it("meshes a closed surface on the true field", () => {
		const r = 50;
		const { primitives, report } = sculpt({
			parts: [{ shape: "sphere", radius: r }],
			cell: 1,
		});
		expect(report.openEdges).toBe(0);
		const exact = (4 / 3) * Math.PI * r ** 3;
		expect(Math.abs(report.volume - exact) / exact).toBeLessThan(0.005);
		const p = primitives[0]?.positions ?? [];
		let worst = 0;
		for (let i = 0; i < p.length; i += 3)
			worst = Math.max(
				worst,
				Math.abs(
					Math.hypot(p[i] as number, p[i + 1] as number, p[i + 2] as number) -
						r,
				),
			);
		// Projected onto the surface, not left at the Surface Nets average.
		expect(worst).toBeLessThan(0.01);
	});

	it("simplifies to a budget and stays closed", () => {
		const parts: Part[] = [
			{ shape: "box", size: [80, 50, 40], radius: 6 },
			{ shape: "sphere", at: [40, 25, 0], radius: 18, blend: 10 },
			{
				shape: "cylinder",
				at: [-20, 0, 0],
				radius: 10,
				height: 80,
				op: "subtract",
				blend: 3,
			},
		];
		const full = sculpt({ parts, cell: 0.8 });
		const small = sculpt({ parts, cell: 0.8, triangles: 4000 });
		expect(full.report.triangles).toBeGreaterThan(40000);
		expect(small.report.triangles).toBeLessThanOrEqual(4000);
		expect(small.report.openEdges).toBe(0);
		expect(
			Math.abs(small.report.volume - full.report.volume) / full.report.volume,
		).toBeLessThan(0.01);
	});

	it("splits materials into primitives along their borders", () => {
		const doc = new GltfDocument();
		const skin = doc.addMaterial({ color: "#e8cfb0" });
		const cloth = doc.addMaterial({ color: "#3b5a3a" });
		const { primitives, report } = sculpt({
			parts: [
				{ shape: "sphere", radius: 30, material: skin },
				{
					shape: "box",
					at: [0, -20, 0],
					size: [70, 30, 70],
					blend: 4,
					material: cloth,
				},
			],
			cell: 1,
			triangles: 6000,
		});
		expect(report.openEdges).toBe(0);
		expect(primitives.map((p) => p.material)).toEqual([skin, cloth]);
		// The pieces still close into one solid.
		const total = primitives.reduce(
			(s, p) => s + volumeOf(p.positions, p.indices ?? []),
			0,
		);
		expect(total).toBeCloseTo(report.volume, 0);
	});

	it("cuts material borders on the curve where ownership changes", () => {
		const doc = new GltfDocument();
		const a = doc.addMaterial({ color: "#ff0000" });
		const b = doc.addMaterial({ color: "#0000ff" });
		// Two equal spheres, hard union: their border is the circle in x = 0.
		const { primitives, report } = sculpt({
			parts: [
				{ shape: "sphere", at: [-15, 0, 0], radius: 25, material: a },
				{ shape: "sphere", at: [15, 0, 0], radius: 25, material: b },
			],
			cell: 1,
			triangles: 3000,
		});
		expect(report.openEdges).toBe(0);
		const key = (p: ArrayLike<number>, i: number) =>
			`${(p[i * 3] as number).toFixed(6)},${(p[i * 3 + 1] as number).toFixed(6)},${(p[i * 3 + 2] as number).toFixed(6)}`;
		const [pa, pb] = primitives;
		const inB = new Set(
			Array.from({ length: (pb?.positions.length ?? 0) / 3 }, (_, i) =>
				key(pb?.positions ?? [], i),
			),
		);
		let shared = 0;
		let worst = 0;
		const P = pa?.positions ?? [];
		for (let i = 0; i < P.length / 3; i++) {
			if (!inB.has(key(P, i))) continue;
			shared++;
			worst = Math.max(worst, Math.abs(P[i * 3] as number));
		}
		expect(shared).toBeGreaterThan(30);
		expect(worst).toBeLessThan(0.02);
	});

	it("blends vertex colors across smooth joins", () => {
		const { primitives } = sculpt({
			parts: [
				{ shape: "sphere", at: [-20, 0, 0], radius: 20, color: "#ff0000" },
				{
					shape: "sphere",
					at: [20, 0, 0],
					radius: 20,
					color: "#0000ff",
					blend: 12,
				},
			],
			cell: 1,
		});
		const p = primitives[0];
		const colors = p?.colors ?? [];
		const pos = p?.positions ?? [];
		// The vertex nearest the middle of the join is a mix of both.
		let best = 0;
		let bestX = Number.POSITIVE_INFINITY;
		for (let i = 0; i < pos.length / 3; i++) {
			const x = Math.abs(pos[i * 3] as number);
			if (x < bestX) {
				bestX = x;
				best = i;
			}
		}
		expect(colors[best * 4]).toBeGreaterThan(0.2);
		expect(colors[best * 4 + 2]).toBeGreaterThan(0.2);
	});

	it("skins a blended elbow that bends without collapsing", () => {
		// An arm along +x: shoulder at 0, elbow at 60, wrist at 110.
		const skeleton = new Skeleton()
			.add("Arm", { at: [0, 0, 0] })
			.add("ForeArm", { at: [60, 0, 0], parent: "Arm" })
			.add("Hand", { at: [110, 0, 0], parent: "ForeArm" });
		const result = sculpt({
			skeleton,
			parts: [
				limb(skeleton, "Arm", { radii: [10, 8] }),
				limb(skeleton, "ForeArm", { radii: [8, 6], blend: 8 }),
			],
			cell: 1,
			triangles: 8000,
		});
		const prim = result.primitives[0];
		const pos = prim?.positions ?? [];
		const joints = prim?.joints ?? [];
		const weights = prim?.weights ?? [];
		const n = pos.length / 3;
		const weightOf = (v: number, j: number) => {
			let w = 0;
			for (let k = 0; k < 4; k++)
				if (joints[v * 4 + k] === j && (weights[v * 4 + k] as number) > 0)
					w += weights[v * 4 + k] as number;
			return w;
		};
		for (let v = 0; v < n; v++) {
			const x = pos[v * 3] as number;
			if (x < 30) expect(weightOf(v, 0)).toBeGreaterThan(0.95);
			if (x > 85) expect(weightOf(v, 1)).toBeGreaterThan(0.95);
		}
		// The elbow shares: some vertex there is moved by both joints.
		let shared = 0;
		for (let v = 0; v < n; v++) {
			const x = pos[v * 3] as number;
			if (x > 50 && x < 70 && weightOf(v, 0) > 0.2 && weightOf(v, 1) > 0.2)
				shared++;
		}
		expect(shared).toBeGreaterThan(20);

		// Bend the forearm 90° about z at the elbow (linear blend skinning).
		const bent = new Float64Array(pos.length);
		for (let v = 0; v < n; v++) {
			const x = (pos[v * 3] as number) - 60;
			const y = pos[v * 3 + 1] as number;
			const w1 = weightOf(v, 1) + weightOf(v, 2);
			const w0 = 1 - w1;
			bent[v * 3] = w0 * (x + 60) + w1 * (-y + 60);
			bent[v * 3 + 1] = w0 * y + w1 * x;
			bent[v * 3 + 2] = pos[v * 3 + 2] as number;
		}
		const before = volumeOf(pos, prim?.indices ?? []);
		const after = volumeOf(bent, prim?.indices ?? []);
		expect(after / before).toBeGreaterThan(0.85);
	});

	it("shares a part between joints by distance to their bones", () => {
		const skeleton = new Skeleton()
			.add("Hips", { at: [0, 0, 0] })
			.add("Spine", { at: [0, 40, 0], parent: "Hips" })
			.add("Chest", { at: [0, 80, 0], parent: "Spine" })
			.add("Neck", { at: [0, 120, 0], parent: "Chest" });
		const { primitives } = sculpt({
			skeleton,
			parts: [
				{
					shape: "capsule",
					from: [0, 0, 0],
					to: [0, 120, 0],
					radius: 15,
					joint: ["Hips", "Spine", "Chest"],
				},
			],
			cell: 1.5,
		});
		const p = primitives[0];
		const pos = p?.positions ?? [];
		const top = (y: number) => {
			let best = 0;
			let bestD = Number.POSITIVE_INFINITY;
			for (let i = 0; i < pos.length / 3; i++) {
				const d = Math.abs((pos[i * 3 + 1] as number) - y);
				if (d < bestD) {
					bestD = d;
					best = i;
				}
			}
			return p?.joints?.[best * 4];
		};
		expect(top(10)).toBe(0);
		expect(top(60)).toBe(1);
		expect(top(105)).toBe(2);
	});

	it("mirrors parts across the body", () => {
		const skeleton = humanoidSkeleton();
		const [left, right] = mirrorParts([
			limb(skeleton, "LeftArm", { radii: [5, 4] }),
		]);
		expect(right?.joint).toBe("RightArm");
		if (left?.shape !== "roundCone" || right?.shape !== "roundCone")
			throw new Error("shape");
		expect(right.from[0]).toBeCloseTo(-left.from[0]);
		expect(right.to).toEqual([-left.to[0], left.to[1], left.to[2]]);
		const f = new SculptField(
			mirrorParts([limb(skeleton, "LeftArm", { radii: [5, 4] })]),
		);
		const p = skeleton.joint("LeftForeArm").at;
		expect(f.distance(p[0], p[1], p[2])).toBeCloseTo(
			f.distance(-p[0], p[1], p[2]),
			9,
		);
	});

	it("writes a sculpted, skinned humanoid that validates", async () => {
		const skeleton = humanoidSkeleton({
			height: 180,
			fingers: false,
			toes: false,
		});
		const doc = new GltfDocument();
		const rig = doc.addSkeleton(skeleton);
		const skin = doc.addMaterial({ color: "#e8cfb0", roughness: 0.6 });
		const s = (n: string) => skeleton.joint(n).at;
		const body = sculpt({
			skeleton,
			parts: [
				{
					shape: "ellipsoid",
					at: s("Spine1"),
					radii: [15, 24, 10],
					joint: ["Hips", "Spine", "Spine1", "Spine2"],
					material: skin,
				},
				{
					shape: "sphere",
					at: [0, 166, 1],
					radius: 10,
					joint: "Head",
					blend: 4,
					material: skin,
				},
				limb(skeleton, "Neck", { radii: [5, 5], blend: 4, material: skin }),
				...mirrorParts([
					limb(skeleton, "LeftArm", {
						radii: [5, 4],
						blend: 5,
						material: skin,
					}),
					limb(skeleton, "LeftForeArm", {
						radii: [4, 3],
						blend: 3,
						material: skin,
					}),
					limb(skeleton, "LeftUpLeg", {
						radii: [8, 5.5],
						blend: 6,
						material: skin,
					}),
					limb(skeleton, "LeftLeg", {
						radii: [5.5, 4],
						blend: 3,
						material: skin,
					}),
				]),
			],
			cell: 1.2,
			triangles: 20000,
		});
		expect(body.report.openEdges).toBe(0);
		doc.addNode({
			name: "Body",
			mesh: doc.addMesh({ name: "Body", primitives: body.primitives }),
			skin: rig.skin,
		});
		const glb = doc.toGlb();
		const report = await validateBytes(glb, { maxIssues: 20 });
		expect(report.issues.messages.filter((m) => m.severity <= 1)).toEqual([]);
		expect(parseGLB(glb).meshes[0]?.jointIndices?.length).toBe(
			body.report.vertices * 4,
		);
	});
});
