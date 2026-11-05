/**
 * Parity with Epic's own DNA library. `fixtures/oracle.dna` was written by
 * OpenRigLogic 5.8's DNA writer (made-up data, see `fixtures/oracle.cpp`);
 * `fixtures/v21.dna` is the same character in the 2.1 layout. Each `.json`
 * is what Epic's reader reads from its file. `readDna` must read the same:
 * every field, every LOD view, every mesh.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dnaToGlb, readDna } from "./index.js";

const fixture = (name: string) => ({
	name,
	bytes: new Uint8Array(
		readFileSync(new URL(`../fixtures/${name}.dna`, import.meta.url)),
	),
	oracle: JSON.parse(
		readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"),
	),
});

const AXES = ["left", "right", "up", "down", "front", "back"];
const SEQUENCES = ["xyz", "xzy", "yxz", "yzx", "zxy", "zyx"];
const list = (a: ArrayLike<number>) => Array.from(a);
/** Float32 values as the oracle printed them (9 significant digits). */
const f = (a: ArrayLike<number>) =>
	Array.from(a, (x) => Number(x.toPrecision(9)));

describe.each([
	fixture("oracle"),
	fixture("v21"),
])("readDna against OpenRigLogic ($name)", ({ bytes, oracle }) => {
	const dna = readDna(bytes);
	const d = dna.descriptor;
	const def = dna.definition;
	const b = dna.behavior!;

	it("reads the descriptor", () => {
		expect([dna.version.generation, dna.version.version]).toEqual(
			oracle.version,
		);
		expect({
			name: d.name,
			archetype: d.archetype,
			gender: d.gender,
			age: d.age,
			metadata: d.metadata,
			translationUnit: d.translationUnit === "m" ? 1 : 0,
			rotationUnit: d.rotationUnit === "radians" ? 1 : 0,
			coordinateSystem: d.coordinateSystem.map((a) => AXES.indexOf(a)),
			rotationSequence: SEQUENCES.indexOf(d.rotationSequence),
			rotationSign: d.rotationSign,
			faceWindingOrder: d.faceWindingOrder === "cw" ? 1 : 0,
			lodCount: d.lodCount,
			maxLOD: d.maxLOD,
			complexity: d.complexity,
			dbName: d.dbName,
		}).toEqual({
			name: oracle.name,
			archetype: oracle.archetype,
			gender: oracle.gender,
			age: oracle.age,
			metadata: oracle.metadata,
			translationUnit: oracle.translationUnit,
			rotationUnit: oracle.rotationUnit,
			coordinateSystem: oracle.coordinateSystem,
			rotationSequence: oracle.rotationSequence,
			rotationSign: oracle.rotationSign,
			faceWindingOrder: oracle.faceWindingOrder,
			lodCount: oracle.lodCount,
			maxLOD: oracle.maxLOD,
			complexity: oracle.complexity,
			dbName: oracle.dbName,
		});
	});

	it("reads the definition, with each LOD's elements", () => {
		for (const key of [
			"guiControlNames",
			"rawControlNames",
			"jointNames",
			"blendShapeChannelNames",
			"animatedMapNames",
			"meshNames",
		] as const)
			expect(def[key]).toEqual(oracle[key]);
		const perLod = (m: { lods: Uint16Array; indices: Uint16Array[] }) =>
			Array.from({ length: d.lodCount }, (_, lod) =>
				list(m.indices[m.lods[lod] as number] ?? []),
			);
		expect(perLod(def.lodJointMapping)).toEqual(oracle.jointsPerLod);
		expect(perLod(def.lodBlendShapeMapping)).toEqual(oracle.blendShapesPerLod);
		expect(perLod(def.lodAnimatedMapMapping)).toEqual(
			oracle.animatedMapsPerLod,
		);
		expect(perLod(def.lodMeshMapping)).toEqual(oracle.meshesPerLod);
		const m = def.meshBlendShapeChannelMapping;
		expect(list(m.from).map((x, i) => [x, m.to[i]])).toEqual(
			oracle.meshBlendShapeChannelMapping,
		);
		// Epic's reader reports a root as its own parent.
		expect(list(def.jointHierarchy)).toEqual(oracle.parents);
		const t = def.neutralJointTranslations;
		const r = def.neutralJointRotations;
		expect([f(t.xs), f(t.ys), f(t.zs)]).toEqual(oracle.neutralTranslations);
		expect([f(r.xs), f(r.ys), f(r.zs)]).toEqual(oracle.neutralRotations);
	});

	it("reads the rig behavior", () => {
		const c = b.controls;
		expect({
			guiToRawInput: list(c.conditionals.inputIndices),
			guiToRawOutput: list(c.conditionals.outputIndices),
			guiToRawFrom: f(c.conditionals.fromValues),
			guiToRawTo: f(c.conditionals.toValues),
			guiToRawSlope: f(c.conditionals.slopeValues),
			guiToRawCut: f(c.conditionals.cutValues),
			psdCount: c.psdCount,
			psdRows: list(c.psds.rows),
			psdColumns: list(c.psds.columns),
			psdValues: f(c.psds.values),
			jointRowCount: b.joints.rowCount,
			jointColumnCount: b.joints.colCount,
			jointGroups: b.joints.jointGroups.map((g) => ({
				lods: list(g.lods),
				inputs: list(g.inputIndices),
				outputs: list(g.outputIndices),
				values: f(g.values),
				joints: list(g.jointIndices),
			})),
			blendShapeLods: list(b.blendShapeChannels.lods),
			blendShapeInputs: list(b.blendShapeChannels.inputIndices),
			blendShapeOutputs: list(b.blendShapeChannels.outputIndices),
			animatedMapLods: list(b.animatedMaps.lods),
			animatedMapInputs: list(b.animatedMaps.conditionals.inputIndices),
			animatedMapOutputs: list(b.animatedMaps.conditionals.outputIndices),
			animatedMapFrom: f(b.animatedMaps.conditionals.fromValues),
			animatedMapTo: f(b.animatedMaps.conditionals.toValues),
			animatedMapSlope: f(b.animatedMaps.conditionals.slopeValues),
			animatedMapCut: f(b.animatedMaps.conditionals.cutValues),
		}).toEqual(
			Object.fromEntries(
				[
					"guiToRawInput",
					"guiToRawOutput",
					"guiToRawFrom",
					"guiToRawTo",
					"guiToRawSlope",
					"guiToRawCut",
					"psdCount",
					"psdRows",
					"psdColumns",
					"psdValues",
					"jointRowCount",
					"jointColumnCount",
					"jointGroups",
					"blendShapeLods",
					"blendShapeInputs",
					"blendShapeOutputs",
					"animatedMapLods",
					"animatedMapInputs",
					"animatedMapOutputs",
					"animatedMapFrom",
					"animatedMapTo",
					"animatedMapSlope",
					"animatedMapCut",
				].map((k) => [k, oracle[k]]),
			),
		);
	});

	it("reads every mesh", () => {
		const meshes = dna.geometry!.meshes.map((m) => ({
			positions: [f(m.positions.xs), f(m.positions.ys), f(m.positions.zs)],
			uvs: [f(m.uvs.us), f(m.uvs.vs)],
			normals: [f(m.normals.xs), f(m.normals.ys), f(m.normals.zs)],
			layouts: [
				list(m.layouts.positions),
				list(m.layouts.uvs),
				list(m.layouts.normals),
			],
			faces: m.faces.map(list),
			maxInfluence: m.maximumInfluencePerVertex,
			skin: m.skinWeights.map((s) => [f(s.weights), list(s.jointIndices)]),
			targets: m.blendShapeTargets.map((t) => ({
				channel: t.channel,
				deltas: [f(t.deltas.xs), f(t.deltas.ys), f(t.deltas.zs)],
				vertices: list(t.vertexIndices),
			})),
		}));
		expect(meshes).toEqual(oracle.meshes);
	});

	it("reads the RBF, twist/swing and joint metadata layers", () => {
		const rbf = dna.rbf;
		const SOLVER = ["additive", "interpolative"];
		const DISTANCE = ["euclidean", "quaternion", "swingAngle", "twistAngle"];
		const NORMALIZE = ["onlyAboveOne", "always"];
		const FUNCTION = ["gaussian", "exponential", "linear", "cubic", "quintic"];
		const AXIS = ["x", "y", "z"];
		expect(dna.mlControlNames?.length ?? 0).toBe(oracle.mlControlCount);
		const perLod = rbf
			? Array.from({ length: d.lodCount }, (_, lod) =>
					list(
						rbf.lodSolverMapping.indices[
							rbf.lodSolverMapping.lods[lod] as number
						] ?? [],
					),
				)
			: oracle.rbfSolversPerLod.map(() => []);
		expect(perLod).toEqual(oracle.rbfSolversPerLod);
		expect(
			(rbf?.solvers ?? []).map((x) => ({
				name: x.name,
				rawControlIndices: list(x.rawControlIndices),
				poseIndices: list(x.poseIndices),
				rawControlValues: f(x.rawControlValues),
				radius: Number(x.radius.toPrecision(9)),
				weightThreshold: Number(x.weightThreshold.toPrecision(9)),
				solverType: SOLVER.indexOf(x.solverType),
				automaticRadius: x.automaticRadius ? 0 : 1,
				distanceMethod: DISTANCE.indexOf(x.distanceMethod),
				normalizeMethod: NORMALIZE.indexOf(x.normalizeMethod),
				functionType: FUNCTION.indexOf(x.functionType),
				twistAxis: AXIS.indexOf(x.twistAxis),
			})),
		).toEqual(oracle.rbfSolvers);
		expect(
			(rbf?.poses ?? []).map((p, i) => ({
				name: p.name,
				scale: Number(p.scale.toPrecision(9)),
				inputs: list(rbf?.poseControls[i]?.inputControlIndices ?? []),
				outputs: list(rbf?.poseControls[i]?.outputControlIndices ?? []),
				weights: f(rbf?.poseControls[i]?.outputControlWeights ?? []),
			})),
		).toEqual(oracle.rbfPoses);
		expect(rbf?.poseControlNames ?? []).toEqual(oracle.rbfPoseControlNames);
		const setups = (
			list_: {
				twistAxis: string;
				inputControlIndices: Uint16Array;
				outputJointIndices: Uint16Array;
				blendWeights: Float32Array;
			}[],
		) =>
			list_.map((x) => ({
				twistAxis: AXIS.indexOf(x.twistAxis),
				inputs: list(x.inputControlIndices),
				outputs: list(x.outputJointIndices),
				weights: f(x.blendWeights),
			}));
		expect(setups(dna.twistSwing?.twists ?? [])).toEqual(oracle.twists);
		expect(setups(dna.twistSwing?.swings ?? [])).toEqual(oracle.swings);
		const reps =
			dna.jointRepresentations ??
			def.jointNames.map(() => ({ rotation: "euler" }));
		expect(reps.map((r) => (r.rotation === "quaternion" ? 1 : 0))).toEqual(
			oracle.rotationRepresentations,
		);
	});

	it("converts Epic's file to a GLB", () => {
		// zyx order with a negative y sign, six influences on one vertex, two LODs.
		for (const lod of [0, 1])
			expect(dnaToGlb(dna, { lod }).byteLength).toBeGreaterThan(0);
	});
});
