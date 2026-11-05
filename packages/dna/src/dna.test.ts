/**
 * DNA files read back what was written (versions 2.1 and 2.8, unknown
 * layers skipped), Euler angles follow OpenRigLogic's convention, and a
 * character converts to a GLB the Khronos validator accepts and the engine
 * loader reads: joints at their neutral pose with rest rotations, meshes per
 * LOD, skin weights capped at four, blend shapes as named morph targets,
 * mirrored axes handled.
 */
import { denseMorphDeltas, parseGLB } from "@framefields/webgpu-renderers";
import { validateBytes } from "gltf-validator";
import { describe, expect, it } from "vitest";
import { dnaToGlb, eulerQuat, readDna, spaceOf } from "./index.js";
import type { DnaDescriptor } from "./read.js";
import { type TestDna, writeDna21, writeDna28 } from "./write-dna.test-util.js";

const f32 = (...v: number[]) => Float32Array.from(v);
const u16 = (...v: number[]) => Uint16Array.from(v);
const u32 = (...v: number[]) => Uint32Array.from(v);
const table = () => ({
	inputIndices: u16(),
	outputIndices: u16(),
	fromValues: f32(),
	toValues: f32(),
	slopeValues: f32(),
	cutValues: f32(),
});

function descriptor(over: Partial<DnaDescriptor> = {}): DnaDescriptor {
	return {
		name: "Tester",
		archetype: 5,
		gender: 2,
		age: 30,
		metadata: [["source", "unit test"]],
		translationUnit: "cm",
		rotationUnit: "degrees",
		coordinateSystem: ["right", "up", "front"],
		lodCount: 2,
		maxLOD: 0,
		complexity: "test",
		dbName: "none",
		rotationSequence: "xyz",
		rotationSign: [1, 1, 1],
		faceWindingOrder: "ccw",
		...over,
	};
}

/**
 * Three joints: a root, an elbow 10 up turned 90° about z (its x now points
 * up), and a hand 10 along the elbow's x, so at 20 up. One quad facing the
 * viewer (+z), with a UV seam copy of its first corner, skinned and with a
 * "jawOpen" shape that pushes that corner forward; a second, empty mesh
 * belongs to LOD 1 only.
 */
function arm(over: Partial<DnaDescriptor> = {}): TestDna {
	return {
		descriptor: descriptor(over),
		definition: {
			lodJointMapping: { lods: u16(0, 0), indices: [u16(0, 1, 2, 3, 4)] },
			lodBlendShapeMapping: { lods: u16(0, 0), indices: [u16(0)] },
			lodAnimatedMapMapping: { lods: u16(0, 0), indices: [u16()] },
			lodMeshMapping: { lods: u16(0, 1), indices: [u16(0), u16(1)] },
			guiControlNames: ["CTRL_jaw"],
			rawControlNames: ["jawOpen"],
			jointNames: ["root", "elbow", "hand", "thumb", "index"],
			blendShapeChannelNames: ["jawOpen"],
			animatedMapNames: [],
			meshNames: ["quad_lod0", "quad_lod1"],
			meshBlendShapeChannelMapping: { from: u16(0), to: u16(0) },
			jointHierarchy: u16(0, 0, 1, 2, 2),
			neutralJointTranslations: {
				xs: f32(0, 0, 10, 2, 3),
				ys: f32(0, 10, 0, 0, 0),
				zs: f32(0, 0, 0, 1, -1),
			},
			neutralJointRotations: {
				xs: f32(0, 0, 0, 0, 0),
				ys: f32(0, 0, 0, 0, 0),
				zs: f32(0, 90, 0, 0, 0),
			},
		},
		behavior: {
			controls: {
				psdCount: 0,
				conditionals: table(),
				psds: { rows: u16(), columns: u16(), values: f32() },
			},
			joints: { rowCount: 0, colCount: 0, jointGroups: [] },
			blendShapeChannels: {
				lods: u16(1, 1),
				inputIndices: u16(0),
				outputIndices: u16(0),
			},
			animatedMaps: { lods: u16(0, 0), conditionals: table() },
		},
		meshes: [
			{
				positions: {
					xs: f32(-5, 5, 5, -5),
					ys: f32(0, 0, 20, 20),
					zs: f32(0, 0, 0, 0),
				},
				uvs: { us: f32(0, 1, 1, 0, 0.5), vs: f32(0, 0, 1, 1, 0) },
				normals: { xs: f32(0), ys: f32(0), zs: f32(1) },
				layouts: {
					positions: u32(0, 1, 2, 3, 0),
					uvs: u32(0, 1, 2, 3, 4),
					normals: u32(0, 0, 0, 0, 0),
				},
				faces: [u32(0, 1, 2, 3), u32(4, 1, 2)],
				maximumInfluencePerVertex: 5,
				skinWeights: [
					{ weights: f32(1), jointIndices: u16(0) },
					{ weights: f32(0.5, 0.5), jointIndices: u16(0, 1) },
					{
						weights: f32(0.4, 0.3, 0.1, 0.1, 0.05, 0.05),
						jointIndices: u16(2, 1, 0, 3, 4, 0),
					},
					{ weights: f32(1), jointIndices: u16(2) },
				],
				blendShapeTargets: [
					{
						deltas: { xs: f32(0), ys: f32(0), zs: f32(2) },
						vertexIndices: u32(0),
						channel: 0,
					},
				],
			},
			{
				positions: { xs: f32(), ys: f32(), zs: f32() },
				uvs: { us: f32(), vs: f32() },
				normals: { xs: f32(), ys: f32(), zs: f32() },
				layouts: { positions: u32(), uvs: u32(), normals: u32() },
				faces: [],
				maximumInfluencePerVertex: 0,
				skinWeights: [],
				blendShapeTargets: [],
			},
		],
	};
}

async function validate(glb: Uint8Array) {
	const report = await validateBytes(glb, { maxIssues: 50 });
	return report.issues.messages
		.filter((m: { severity: number }) => m.severity <= 1)
		.map(
			(m: { code: string; message: string; pointer?: string }) =>
				`${m.code} ${m.pointer ?? ""}: ${m.message}`,
		);
}

/** A column-major 4×4 matrix times a point. */
const transform = (
	m: ArrayLike<number>,
	o: number,
	p: [number, number, number],
) =>
	[0, 1, 2].map(
		(r) =>
			(m[o + r] as number) * p[0] +
			(m[o + 4 + r] as number) * p[1] +
			(m[o + 8 + r] as number) * p[2] +
			(m[o + 12 + r] as number),
	);

describe("readDna", () => {
	for (const [label, write] of [
		["2.8", writeDna28],
		["2.1", writeDna21],
	] as const)
		it(`reads every layer it knows from a ${label} file`, () => {
			const src = arm({
				rotationSequence: label === "2.8" ? "zyx" : "xyz",
				faceWindingOrder: label === "2.8" ? "cw" : "ccw",
			});
			const dna = readDna(write(src));
			expect(dna.version).toEqual({
				generation: 2,
				version: label === "2.8" ? 8 : 1,
			});
			expect(dna.descriptor).toEqual(src.descriptor);
			expect(dna.definition).toEqual(src.definition);
			expect(dna.behavior).toEqual(src.behavior);
			expect(dna.geometry?.meshes).toEqual(src.meshes);
			if (label === "2.8")
				expect(dna.layers.map((l) => l.id)).toEqual([
					"desc",
					"defn",
					"bhvr",
					"geom",
					"twsw",
					"dsce",
				]);
		});

	it("skips layers it is not asked for", () => {
		const dna = readDna(writeDna28(arm()), {
			geometry: false,
			behavior: false,
		});
		expect(dna.geometry).toBeUndefined();
		expect(dna.behavior).toBeUndefined();
		expect(dna.definition.jointNames).toEqual([
			"root",
			"elbow",
			"hand",
			"thumb",
			"index",
		]);
	});

	it("refuses what is not a DNA file it can read", () => {
		expect(() => readDna(new TextEncoder().encode("GLTF1234"))).toThrow(
			/not a DNA file/,
		);
		const future = writeDna28(arm());
		future[6] = 9;
		expect(() => readDna(future)).toThrow(/2\.9 is not supported/);
		expect(() => readDna(writeDna28(arm()).subarray(0, 60))).toThrow(/ends at/);
	});
});

describe("eulerQuat", () => {
	it("matches OpenRigLogic's xyz conversion (x turns first)", () => {
		const s = spaceOf(descriptor({ rotationUnit: "radians" }), "cm");
		const [x, y, z] = [0.3, -0.7, 1.1];
		// tdm's euler_to_quat<rot_seq::xyz>.
		const [cx, cy, cz] = [Math.cos(x / 2), Math.cos(y / 2), Math.cos(z / 2)];
		const [sx, sy, sz] = [Math.sin(x / 2), Math.sin(y / 2), Math.sin(z / 2)];
		const expected = [
			sx * cy * cz - cx * sy * sz,
			cx * sy * cz + sx * cy * sz,
			cx * cy * sz - sx * sy * cz,
			cx * cy * cz + sx * sy * sz,
		];
		for (const [i, c] of eulerQuat(s, x, y, z).entries())
			expect(c).toBeCloseTo(expected[i] as number, 12);
	});
});

describe("dnaToGlb", () => {
	it("writes a valid skinned GLB with the neutral pose, one LOD and named blend shapes", async () => {
		const glb = dnaToGlb(readDna(writeDna28(arm())));
		expect(await validate(glb)).toEqual([]);
		const model = parseGLB(glb);
		// LOD 0: only the quad, a vertex per layout, two faces fanned into three triangles.
		expect(model.meshes).toHaveLength(1);
		const m = model.meshes[0]!;
		expect(m.positions.length / 3).toBe(5);
		expect(m.indices.length).toBe(9);
		expect(m.morphTargetNames).toEqual(["jawOpen"]);
		// The shape moves both copies of the first corner.
		const jaw = denseMorphDeltas(m.morphTargets![0]!, 5);
		expect([jaw[2], jaw[14], jaw[5]]).toEqual([2, 2, 0]);
		// UVs flip to glTF's v-down.
		expect(Array.from(m.uvs.slice(4, 6))).toEqual([1, 0]);
		// Six entries over five joints: the root's two add up (0.15), and with
		// five influences the vertex takes glTF's second set too.
		const set0 = Array.from(m.jointIndices!.slice(8, 12));
		const set1 = Array.from(m.jointIndices1!.slice(8, 12));
		expect(set0).toEqual([2, 1, 0, 3]);
		expect(set1).toEqual([4, 0, 0, 0]);
		const w = [
			...m.jointWeights!.slice(8, 12),
			...m.jointWeights1!.slice(8, 12),
		];
		for (const [k, x] of [0.4, 0.3, 0.15, 0.1, 0.05, 0, 0, 0].entries())
			expect(w[k]).toBeCloseTo(x, 6);

		// Joints at the neutral pose: each inverse bind matrix takes its joint's
		// rest position to the origin; the elbow rests turned 90° about z.
		const skin = model.skins![0]!;
		const names = skin.joints.map((j) => model.nodes![j]!.name);
		expect(names).toEqual(["root", "elbow", "hand", "thumb", "index"]);
		// The fingers sit in the hand's frame, which the elbow turned: its x is up, its y is -x.
		const rest: Record<string, [number, number, number]> = {
			root: [0, 0, 0],
			elbow: [0, 10, 0],
			hand: [0, 20, 0],
			thumb: [0, 22, 1],
			index: [0, 23, -1],
		};
		for (const [i, n] of names.entries())
			for (const c of transform(
				skin.inverseBindMatrices,
				i * 16,
				rest[n] as [number, number, number],
			))
				expect(c).toBeCloseTo(0, 5);
		const elbow = model.nodes![skin.joints[1]!]!;
		expect(elbow.rotation?.[2]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(model.nodes![skin.joints[2]!]!.translation?.[0]).toBeCloseTo(10, 5);
	});

	it("keeps four influences when asked, renormalized", async () => {
		const glb = dnaToGlb(readDna(writeDna28(arm())), { influences: 4 });
		expect(await validate(glb)).toEqual([]);
		const m = parseGLB(glb).meshes[0]!;
		expect(m.jointIndices1).toBeUndefined();
		const w = Array.from(m.jointWeights!.slice(8, 12));
		for (const [k, x] of [0.4, 0.3, 0.15, 0.1].entries())
			expect(w[k]).toBeCloseTo(x / 0.95, 6);
	});

	it("converts mirrored axes and meters, keeping faces turned outward", async () => {
		// x points to the viewer's left: a mirror image of glTF's axes.
		const dna = readDna(
			writeDna28(
				arm({
					coordinateSystem: ["left", "up", "front"],
					translationUnit: "m",
				}),
			),
		);
		const glb = dnaToGlb(dna);
		expect(await validate(glb)).toEqual([]);
		const m = parseGLB(glb).meshes[0]!;
		// Meters become centimeters, and x flips.
		expect(m.positions[0]).toBeCloseTo(500, 3);
		// Every triangle's winding agrees with its vertex normals.
		for (let t = 0; t < m.indices.length; t += 3) {
			const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
			const p = (i: number) => [
				m.positions[i * 3]!,
				m.positions[i * 3 + 1]!,
				m.positions[i * 3 + 2]!,
			];
			const [pa, pb, pc] = [p(a), p(b), p(c)];
			const u = pb.map((v, k) => v - pa[k]!);
			const v = pc.map((x, k) => x - pa[k]!);
			const nz = u[0]! * v[1]! - u[1]! * v[0]!;
			expect(Math.sign(nz)).toBe(Math.sign(m.normals![a * 3 + 2]!));
		}
	});

	it("writes the meshes of the asked LOD", () => {
		const dna = readDna(writeDna28(arm()));
		// LOD 1's only mesh is empty: the character is its skeleton alone.
		const model = parseGLB(dnaToGlb(dna, { lod: 1 }));
		expect(model.meshes).toHaveLength(0);
		expect(model.nodes?.map((n) => n.name)).toContain("hand");
		expect(() => dnaToGlb(dna, { lod: 2 })).toThrow(/LOD 2 is not in the file/);
	});
});
