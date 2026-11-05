/**
 * Reads a DNA file: the character description (name, units, axes), the
 * definition (controls, joints and their neutral pose, blend shape channels,
 * animated maps, meshes, LOD mappings), the rig behavior (pose-space
 * controls, joint matrices, blend shape and animated map mappings) and the
 * geometry (meshes with UVs, normals, skin weights and blend shape targets).
 *
 * File versions 2.1 (section table) and 2.2–2.8 (layer index) are read.
 * Layers this reader does not use yet (RBF, twist/swing, machine-learned
 * behavior, joint metadata) are listed by id and left unread.
 *
 * Based on OpenRigLogic's DNA library (MIT, Epic Games): the layout follows
 * its `DNA.h` serializers.
 */
import { ByteReader } from "./bytes.js";

export type AxisDirection = "left" | "right" | "up" | "down" | "front" | "back";
export type RotationSequence = "xyz" | "xzy" | "yxz" | "yzx" | "zxy" | "zyx";

export interface DnaDescriptor {
	name: string;
	archetype: number;
	gender: number;
	age: number;
	metadata: [string, string][];
	translationUnit: "cm" | "m";
	rotationUnit: "degrees" | "radians";
	/** Where each file axis points. */
	coordinateSystem: [AxisDirection, AxisDirection, AxisDirection];
	lodCount: number;
	maxLOD: number;
	complexity: string;
	dbName: string;
	/** Euler order of joint rotations (from file version 2.7; before it, xyz). */
	rotationSequence: RotationSequence;
	/** Per axis, 1 or -1: the direction a positive angle turns. */
	rotationSign: [number, number, number];
	faceWindingOrder: "ccw" | "cw";
}

/** For each LOD, a row of `indices`: the elements that LOD uses. */
export interface LodMapping {
	lods: Uint16Array;
	indices: Uint16Array[];
}

export interface DnaDefinition {
	lodJointMapping: LodMapping;
	lodBlendShapeMapping: LodMapping;
	lodAnimatedMapMapping: LodMapping;
	lodMeshMapping: LodMapping;
	guiControlNames: string[];
	rawControlNames: string[];
	jointNames: string[];
	blendShapeChannelNames: string[];
	animatedMapNames: string[];
	meshNames: string[];
	/** Pairs (mesh, blend shape channel). */
	meshBlendShapeChannelMapping: { from: Uint16Array; to: Uint16Array };
	/** Per joint, its parent (a root is its own parent). */
	jointHierarchy: Uint16Array;
	/** Per joint, translation from its parent, in the descriptor's unit. */
	neutralJointTranslations: Vec3Array;
	/** Per joint, Euler rotation relative to its parent, in the descriptor's unit and order. */
	neutralJointRotations: Vec3Array;
}

/** Three parallel arrays. */
export interface Vec3Array {
	xs: Float32Array;
	ys: Float32Array;
	zs: Float32Array;
}

/** Piecewise linear outputs: `output += slope · input + cut` where `from ≤ input ≤ to`. */
export interface ConditionalTable {
	inputIndices: Uint16Array;
	outputIndices: Uint16Array;
	fromValues: Float32Array;
	toValues: Float32Array;
	slopeValues: Float32Array;
	cutValues: Float32Array;
}

export interface JointGroup {
	lods: Uint16Array;
	inputIndices: Uint16Array;
	outputIndices: Uint16Array;
	/** Row-major, outputIndices × inputIndices. */
	values: Float32Array;
	jointIndices: Uint16Array;
}

export interface DnaBehavior {
	controls: {
		psdCount: number;
		/** GUI to raw controls. */
		conditionals: ConditionalTable;
		/** Pose-space controls: products of raw controls. */
		psds: { rows: Uint16Array; columns: Uint16Array; values: Float32Array };
	};
	joints: { rowCount: number; colCount: number; jointGroups: JointGroup[] };
	blendShapeChannels: {
		lods: Uint16Array;
		inputIndices: Uint16Array;
		outputIndices: Uint16Array;
	};
	animatedMaps: { lods: Uint16Array; conditionals: ConditionalTable };
}

export interface DnaMesh {
	positions: Vec3Array;
	uvs: { us: Float32Array; vs: Float32Array };
	normals: Vec3Array;
	/** Per vertex layout: position, UV and normal indices. */
	layouts: { positions: Uint32Array; uvs: Uint32Array; normals: Uint32Array };
	/** Polygons as layout indices. */
	faces: Uint32Array[];
	maximumInfluencePerVertex: number;
	/** Per position. */
	skinWeights: { weights: Float32Array; jointIndices: Uint16Array }[];
	blendShapeTargets: {
		deltas: Vec3Array;
		vertexIndices: Uint32Array;
		channel: number;
	}[];
}

export type TwistAxis = "x" | "y" | "z";

/** One RBF solver: how close the current joint rotations are to each of its poses. */
export interface RbfSolver {
	name: string;
	/** The raw controls it reads (usually joint quaternions, four per joint). */
	rawControlIndices: Uint16Array;
	/** Its poses (indices into `DnaRbf.poses`). */
	poseIndices: Uint16Array;
	/** Per pose, the raw control values that define it. */
	rawControlValues: Float32Array;
	/** Kernel width, in the descriptor's rotation unit. */
	radius: number;
	weightThreshold: number;
	solverType: "additive" | "interpolative";
	/** Radius from the mean distance between poses. */
	automaticRadius: boolean;
	distanceMethod: "euclidean" | "quaternion" | "swingAngle" | "twistAngle";
	normalizeMethod: "onlyAboveOne" | "always";
	functionType: "gaussian" | "exponential" | "linear" | "cubic" | "quintic";
	twistAxis: TwistAxis;
}

/** Pose-space correctives (body): RBF solvers whose pose weights drive controls. */
export interface DnaRbf {
	lodSolverMapping: LodMapping;
	solvers: RbfSolver[];
	poses: { name: string; scale: number }[];
	/** The controls poses write (after raw, PSD and ML controls). */
	poseControlNames: string[];
	/** Per pose: controls that gate it (multiplied), and the controls it writes with their weights. */
	poseControls: {
		inputControlIndices: Uint16Array;
		outputControlIndices: Uint16Array;
		outputControlWeights: Float32Array;
	}[];
}

/** A joint's rotation split into twist and swing, spread over other joints. */
export interface TwistSwingSetup {
	/** Per output joint: how far it stays from the full rotation (0 follows it, 1 stays still). */
	blendWeights: Float32Array;
	outputJointIndices: Uint16Array;
	/** The four raw controls holding the source joint's quaternion. */
	inputControlIndices: Uint16Array;
	twistAxis: TwistAxis;
}

export interface DnaFile {
	version: { generation: number; version: number };
	descriptor: DnaDescriptor;
	definition: DnaDefinition;
	behavior?: DnaBehavior;
	/** Machine-learned controls (their values are not evaluated yet; they sit between PSD and RBF controls). */
	mlControlNames?: string[];
	rbf?: DnaRbf;
	twistSwing?: { twists: TwistSwingSetup[]; swings: TwistSwingSetup[] };
	/** Per joint: how translation, rotation and scale are represented (rotation "quaternion" joints need RigLogic's quaternion path). */
	jointRepresentations?: {
		translation: "vector";
		rotation: "euler" | "quaternion";
		scale: "vector";
	}[];
	geometry?: { meshes: DnaMesh[] };
	/** Every layer in the file, by four-letter id and layer version. */
	layers: { id: string; version: string }[];
}

export interface ReadDnaOptions {
	/** Read the meshes. Default true. */
	geometry?: boolean;
	/** Read the rig behavior. Default true. */
	behavior?: boolean;
}

const AXES: AxisDirection[] = ["left", "right", "up", "down", "front", "back"];
const SEQUENCES: RotationSequence[] = [
	"xyz",
	"xzy",
	"yxz",
	"yzx",
	"zxy",
	"zyx",
];

export function readDna(
	bytes: Uint8Array,
	options: ReadDnaOptions = {},
): DnaFile {
	const r = new ByteReader(bytes);
	if (r.length < 7 || r.chars(3) !== "DNA")
		throw new Error("dna: not a DNA file (no DNA signature)");
	const generation = r.u16();
	const version = r.u16();
	if (generation !== 2)
		throw new Error(
			`dna: file generation ${generation} is not supported (2 is)`,
		);
	if (version < 1 || version > 8)
		throw new Error(
			`dna: file version 2.${version} is not supported (2.1 to 2.8 are)`,
		);
	return version === 1 ? readV21(r, options) : readLayered(r, version, options);
}

/** 2.2 and later: an index of layers by id, version, offset and size. */
function readLayered(
	r: ByteReader,
	version: number,
	options: ReadDnaOptions,
): DnaFile {
	const index = r.list((x) => ({
		id: x.u32(),
		version: x.u32(),
		offset: x.u32(),
		size: x.u32(),
	}));
	const name = (id: number) =>
		String.fromCharCode(
			id >>> 24,
			(id >>> 16) & 255,
			(id >>> 8) & 255,
			id & 255,
		);
	const at = (id: string) => {
		const entry = index.find((e) => name(e.id) === id);
		if (entry) r.seek(entry.offset);
		return entry;
	};
	if (!at("desc")) throw new Error("dna: no descriptor layer");
	const descriptor = readDescriptor(r);
	if (at("dsce")) Object.assign(descriptor, readDescriptorExt(r, version));
	if (!at("defn")) throw new Error("dna: no definition layer");
	const definition = readDefinition(r);
	const file: DnaFile = {
		version: { generation: 2, version },
		descriptor,
		definition,
		layers: index.map((e) => ({
			id: name(e.id),
			version: `${e.version >>> 16}.${e.version & 0xffff}`,
		})),
	};
	if (options.behavior !== false && at("bhvr")) {
		file.behavior = readBehavior(r);
		if (at("mlbh")) file.mlControlNames = r.list((x) => x.string());
		if (at("rbfb")) {
			const rbf = readRbf(r);
			if (at("rbfe")) readRbfExt(r, rbf);
			file.rbf = withPoseControls(rbf, file);
		}
		if (at("twsw"))
			file.twistSwing = {
				twists: r.list(readTwistSwing),
				swings: r.list(readTwistSwing),
			};
		if (at("jbmd")) {
			const listed = r.list((x) => {
				x.u16();
				const rotation: "euler" | "quaternion" =
					x.u16() === 1 ? "quaternion" : "euler";
				x.u16();
				return {
					translation: "vector" as const,
					rotation,
					scale: "vector" as const,
				};
			});
			// Joints the layer does not list are Euler, as RigLogic reads them.
			file.jointRepresentations = definition.jointNames.map(
				(_, j) =>
					listed[j] ?? {
						translation: "vector" as const,
						rotation: "euler" as const,
						scale: "vector" as const,
					},
			);
		}
	}
	if (options.geometry !== false && at("geom"))
		file.geometry = { meshes: r.list(readMesh) };
	return file;
}

/** 2.1: a table of section offsets, then the sections. */
function readV21(r: ByteReader, options: ReadDnaOptions): DnaFile {
	const [
		descriptorAt,
		definitionAt,
		,
		controlsAt,
		jointsAt,
		blendShapesAt,
		animatedMapsAt,
		geometryAt,
	] = Array.from({ length: 8 }, () => r.u32());
	r.seek(descriptorAt as number);
	const descriptor = readDescriptor(r);
	r.seek(definitionAt as number);
	const definition = readDefinition(r);
	const file: DnaFile = {
		version: { generation: 2, version: 1 },
		descriptor,
		definition,
		layers: [],
	};
	if (options.behavior !== false) {
		r.seek(controlsAt as number);
		const controls = readControls(r);
		r.seek(jointsAt as number);
		const joints = readJoints(r);
		r.seek(blendShapesAt as number);
		const blendShapeChannels = readBlendShapeChannels(r);
		r.seek(animatedMapsAt as number);
		const animatedMaps = readAnimatedMaps(r);
		file.behavior = { controls, joints, blendShapeChannels, animatedMaps };
	}
	if (options.geometry !== false) {
		r.seek(geometryAt as number);
		file.geometry = { meshes: r.list(readMeshV21) };
	}
	return file;
}

function readDescriptor(r: ByteReader): DnaDescriptor {
	const name = r.string();
	const archetype = r.u16();
	const gender = r.u16();
	const age = r.u16();
	const metadata = r.list((x) => [x.string(), x.string()] as [string, string]);
	const translationUnit = r.u16() === 1 ? "m" : "cm";
	const rotationUnit = r.u16() === 1 ? "radians" : "degrees";
	const axis = () => {
		const a = AXES[r.u16()];
		if (!a)
			throw new Error("dna: unknown axis direction in the coordinate system");
		return a;
	};
	const coordinateSystem: [AxisDirection, AxisDirection, AxisDirection] = [
		axis(),
		axis(),
		axis(),
	];
	return {
		name,
		archetype,
		gender,
		age,
		metadata,
		translationUnit,
		rotationUnit,
		coordinateSystem,
		lodCount: r.u16(),
		maxLOD: r.u16(),
		complexity: r.string(),
		dbName: r.string(),
		rotationSequence: "xyz",
		rotationSign: [1, 1, 1],
		faceWindingOrder: "ccw",
	};
}

/** Rotation order and signs; the face winding order from file version 2.8. */
function readDescriptorExt(
	r: ByteReader,
	version: number,
): Pick<
	DnaDescriptor,
	"rotationSequence" | "rotationSign" | "faceWindingOrder"
> {
	const sequence = SEQUENCES[r.u32()];
	if (!sequence) throw new Error("dna: unknown rotation sequence");
	const sign: [number, number, number] = [
		r.i32() < 0 ? -1 : 1,
		r.i32() < 0 ? -1 : 1,
		r.i32() < 0 ? -1 : 1,
	];
	const faceWindingOrder = version >= 8 && r.u8() === 1 ? "cw" : "ccw";
	return { rotationSequence: sequence, rotationSign: sign, faceWindingOrder };
}

function readLodMapping(r: ByteReader): LodMapping {
	return { lods: r.u16s(), indices: r.list((x) => x.u16s()) };
}

function readVec3Array(r: ByteReader): Vec3Array {
	return { xs: r.f32s(), ys: r.f32s(), zs: r.f32s() };
}

function readDefinition(r: ByteReader): DnaDefinition {
	const strings = () => r.list((x) => x.string());
	return {
		lodJointMapping: readLodMapping(r),
		lodBlendShapeMapping: readLodMapping(r),
		lodAnimatedMapMapping: readLodMapping(r),
		lodMeshMapping: readLodMapping(r),
		guiControlNames: strings(),
		rawControlNames: strings(),
		jointNames: strings(),
		blendShapeChannelNames: strings(),
		animatedMapNames: strings(),
		meshNames: strings(),
		meshBlendShapeChannelMapping: { from: r.u16s(), to: r.u16s() },
		jointHierarchy: r.u16s(),
		neutralJointTranslations: readVec3Array(r),
		neutralJointRotations: readVec3Array(r),
	};
}

function readConditionalTable(r: ByteReader): ConditionalTable {
	return {
		inputIndices: r.u16s(),
		outputIndices: r.u16s(),
		fromValues: r.f32s(),
		toValues: r.f32s(),
		slopeValues: r.f32s(),
		cutValues: r.f32s(),
	};
}

function readControls(r: ByteReader): DnaBehavior["controls"] {
	return {
		psdCount: r.u16(),
		conditionals: readConditionalTable(r),
		psds: { rows: r.u16s(), columns: r.u16s(), values: r.f32s() },
	};
}

function readJoints(r: ByteReader): DnaBehavior["joints"] {
	return {
		rowCount: r.u16(),
		colCount: r.u16(),
		jointGroups: r.list((x) => ({
			lods: x.u16s(),
			inputIndices: x.u16s(),
			outputIndices: x.u16s(),
			values: x.f32s(),
			jointIndices: x.u16s(),
		})),
	};
}

function readBlendShapeChannels(
	r: ByteReader,
): DnaBehavior["blendShapeChannels"] {
	return { lods: r.u16s(), inputIndices: r.u16s(), outputIndices: r.u16s() };
}

function readAnimatedMaps(r: ByteReader): DnaBehavior["animatedMaps"] {
	return { lods: r.u16s(), conditionals: readConditionalTable(r) };
}

function readBehavior(r: ByteReader): DnaBehavior {
	return {
		controls: readControls(r),
		joints: readJoints(r),
		blendShapeChannels: readBlendShapeChannels(r),
		animatedMaps: readAnimatedMaps(r),
	};
}

function readMeshBody(r: ByteReader): DnaMesh {
	return {
		positions: readVec3Array(r),
		uvs: { us: r.f32s(), vs: r.f32s() },
		normals: readVec3Array(r),
		layouts: { positions: r.u32s(), uvs: r.u32s(), normals: r.u32s() },
		faces: r.list((x) => x.u32s()),
		maximumInfluencePerVertex: r.u16(),
		skinWeights: r.list((x) => ({ weights: x.f32s(), jointIndices: x.u16s() })),
		blendShapeTargets: r.list((x) => ({
			deltas: readVec3Array(x),
			vertexIndices: x.u32s(),
			channel: x.u16(),
		})),
	};
}

/** 2.2 and later: the mesh's byte size, then the mesh. */
function readMesh(r: ByteReader): DnaMesh {
	const size = r.u32();
	const base = r.offset;
	const mesh = readMeshBody(r);
	r.seek(base + size);
	return mesh;
}

/** 2.1: the offset just past the mesh, then the mesh. */
function readMeshV21(r: ByteReader): DnaMesh {
	const end = r.u32();
	const mesh = readMeshBody(r);
	r.seek(end);
	return mesh;
}

const AXIS: TwistAxis[] = ["x", "y", "z"];
const SOLVER_TYPES: RbfSolver["solverType"][] = ["additive", "interpolative"];
const DISTANCES: RbfSolver["distanceMethod"][] = [
	"euclidean",
	"quaternion",
	"swingAngle",
	"twistAngle",
];
const NORMALIZE: RbfSolver["normalizeMethod"][] = ["onlyAboveOne", "always"];
const FUNCTIONS: RbfSolver["functionType"][] = [
	"gaussian",
	"exponential",
	"linear",
	"cubic",
	"quintic",
];

function pick<T>(list: readonly T[], i: number, what: string): T {
	const v = list[i];
	if (v === undefined) throw new Error(`dna: unknown ${what} ${i}`);
	return v;
}

/** The RBF layer: solvers, their LODs, and poses. */
function readRbf(r: ByteReader): DnaRbf {
	const lodSolverMapping = readLodMapping(r);
	const solvers = r.list((x): RbfSolver => {
		const size = x.u32();
		const base = x.offset;
		const solver: RbfSolver = {
			name: x.string(),
			rawControlIndices: x.u16s(),
			poseIndices: x.u16s(),
			rawControlValues: x.f32s(),
			radius: x.f32(),
			weightThreshold: x.f32(),
			solverType: pick(SOLVER_TYPES, x.u16(), "RBF solver type"),
			// AutomaticRadius: On is 0, Off is 1.
			automaticRadius: x.u16() === 0,
			distanceMethod: pick(DISTANCES, x.u16(), "RBF distance method"),
			normalizeMethod: pick(NORMALIZE, x.u16(), "RBF normalize method"),
			functionType: pick(FUNCTIONS, x.u16(), "RBF function type"),
			twistAxis: pick(AXIS, x.u16(), "twist axis"),
		};
		x.seek(base + size);
		return solver;
	});
	const poses = r.list((x) => ({ name: x.string(), scale: x.f32() }));
	return {
		lodSolverMapping,
		solvers,
		poses,
		poseControlNames: [],
		poseControls: [],
	};
}

/** The RBF extension layer: the controls poses write, and what gates them. */
function readRbfExt(r: ByteReader, rbf: DnaRbf): void {
	rbf.poseControlNames = r.list((x) => x.string());
	rbf.poseControls = r.list((x) => ({
		inputControlIndices: x.u16s(),
		outputControlIndices: x.u16s(),
		outputControlWeights: x.f32s(),
	}));
}

/** Without the extension, pose i writes control (raw + PSD + ML) + i, weight 1. */
function withPoseControls(rbf: DnaRbf, file: DnaFile): DnaRbf {
	if (rbf.poseControls.length || !rbf.poses.length) return rbf;
	const first =
		file.definition.rawControlNames.length +
		(file.behavior?.controls.psdCount ?? 0) +
		(file.mlControlNames?.length ?? 0);
	return {
		...rbf,
		poseControlNames: rbf.poses.map((p) => p.name),
		poseControls: rbf.poses.map((_, i) => ({
			inputControlIndices: new Uint16Array(0),
			outputControlIndices: Uint16Array.of(first + i),
			outputControlWeights: Float32Array.of(1),
		})),
	};
}

function readTwistSwing(r: ByteReader): TwistSwingSetup {
	return {
		blendWeights: r.f32s(),
		outputJointIndices: r.u16s(),
		inputControlIndices: r.u16s(),
		twistAxis: pick(AXIS, r.u16(), "twist axis"),
	};
}
