/**
 * Realistic human bodies from MakeHuman's CC0 base mesh and shape targets:
 * sex, age, muscle, weight, proportions and ethnicity blend the macro
 * targets exactly as MakeHuman does, any other target (nose, jaw, torso,
 * …) adds by name, and the skeleton is placed from the shaped body, so
 * bones fit every build. The skeleton's main bones carry Mixamo names
 * (Hips, Spine, LeftArm, LeftForeArm, …), so clips, `pose`, `aim` and
 * retargeting drive it unchanged; twist, extra spine and face bones keep
 * MakeHuman's names. Skin weights are MakeHuman's painted weights.
 *
 * Assets download lazily on first use (see `HumanAssetStore`), only the
 * targets a body needs.
 *
 * ```ts
 * const elf = await human({ sex: 1, age: 0.55, muscle: 0.55, weight: 0.35, height: 184,
 *   targets: { "ears/l-ear-shape-pointed": 1, "ears/r-ear-shape-pointed": 1 } });
 * const doc = new GltfDocument();
 * const rig = doc.addSkeleton(elf.skeleton);
 * doc.addNode({ mesh: doc.addMesh({ name: "Body", primitives: [{ ...elf.body, material: skin }] }), skin: rig.skin });
 * ```
 */
import type {
	DriverSpec,
	MorphTargetSpec,
	PrimitiveSpec,
} from "../document.js";
import { Skeleton, type Vec3 } from "../skeleton.js";
import { subdivide } from "../subdivide.js";
import { ETHNIC_UNITS, FACE_SHAPES, halfWeight } from "./expressions.js";
import {
	type BaseMesh,
	fitProxy,
	type MhProxy,
	type MhSkeleton,
	parseBaseObj,
	parseObj,
	parseProxy,
	parseSkeleton,
	parseTarget,
	parseWeights,
	type Target,
} from "./makehuman.js";
import { HumanAssetStore } from "./store.js";

export interface HumanOptions {
	/** 0 female … 1 male. Default 0.5 (MakeHuman's androgynous middle). */
	sex?: number;
	/** 0 baby (1 yr), 0.1875 child (11), 0.5 adult (25), 1 old (90). Default 0.5. */
	age?: number;
	/** 0 … 1; 0.5 average. Default 0.5. */
	muscle?: number;
	/** 0 … 1; 0.5 average. Default 0.5. */
	weight?: number;
	/** 0 … 1 body proportions, 0.5 regular, 1 idealized. Default 0.5. */
	proportions?: number;
	/** Shares of each ethnic base, normalized. Default a third each. */
	ethnicity?: { african?: number; asian?: number; caucasian?: number };
	/** Final standing height, model units (cm). Default: the shaped body's own height. */
	height?: number;
	/**
	 * Extra targets by path under `targets/` without `.target`, with their
	 * weights: `{ "nose/nose-base-up": 0.6, "chin/chin-jut-in": 0.3 }`.
	 */
	targets?: Record<string, number>;
	/**
	 * Loop subdivision levels for the body and mouth (each multiplies the
	 * triangles by four; blend shapes and weights carry through exactly).
	 * 1 smooths faceting in close-ups. Default 0.
	 */
	subdivide?: number;
	/**
	 * Facial blend shapes on the body under ARKit names (`eyeBlinkLeft`,
	 * `jawOpen`, `mouthSmileRight`, …; see `FACE_SHAPES`). Default true.
	 */
	expressions?: boolean;
	/** Where the assets come from (default: a store on the shared cache). */
	store?: HumanAssetStore;
}

/** A skinned, UV-mapped part of a human. */
export type HumanPart = Required<
	Pick<
		PrimitiveSpec,
		"positions" | "normals" | "uvs" | "joints" | "weights" | "indices"
	>
>;

export interface HumanModel {
	skeleton: Skeleton;
	/** The skinned body with its facial blend shapes, ready for `GltfDocument.addMesh` (add a material). */
	body: HumanPart & { targets: MorphTargetSpec[] };
	/** Teeth and tongue, skinned to the head and jaw, with the expression shapes that move them. */
	mouth: HumanPart & { targets: MorphTargetSpec[] };
	/**
	 * Both eyeballs (sclera, iris, pupil), fitted to the shaped head and
	 * skinned to `LeftEye` / `RightEye`, so `lookAt` on those joints aims
	 * them. Give them a material with `eyeTexture` as its color texture.
	 */
	eyes: HumanPart;
	/**
	 * The clear corneas over the irises, skinned like `eyes`. Give them a
	 * transmissive material (`transmission`, `ior` ≈ 1.376, `volume.thickness`
	 * ≈ 0.3 cm, the depth of the chamber in front of the iris) and they
	 * refract the iris: it shifts with the viewing angle like a real eye's.
	 */
	cornea: HumanPart;
	/** MakeHuman's brown eye texture (PNG, CC0): sclera, iris and pupil, mapped to `eyes`' UVs. */
	eyeTexture: Uint8Array;
	/**
	 * Rig drivers that come with the body: the upper lids follow the eyes'
	 * up-and-down turn by 65%, the lower lids by 35%, so a gaze aimed with
	 * `lookAt` carries the lids with it. Write them with `GltfDocument.addDriver`
	 * (`addHuman` does).
	 */
	drivers: DriverSpec[];
	/** Model height after shaping and scaling, model units. */
	height: number;
}

/** Lid joints per side: MakeHuman's orbicularis03 (upper) and 04 (lower) pivot at the eyeball's center. */
const LID_DRIVERS: DriverSpec[] = (["L", "R"] as const).flatMap((side) => {
	const eye = side === "L" ? "LeftEye" : "RightEye";
	return [
		{ joint: `orbicularis03.${side}`, from: eye, rotate: { x: 0.65 } },
		{ joint: `orbicularis04.${side}`, from: eye, rotate: { x: 0.35 } },
	];
});

/** MakeHuman bone → Mixamo joint name, for the bones Mixamo has. */
const MIXAMO: Record<string, string> = {
	root: "Hips",
	"eye.L": "LeftEye",
	"eye.R": "RightEye",
	spine05: "Spine",
	spine03: "Spine1",
	spine01: "Spine2",
	neck01: "Neck",
	head: "Head",
};
for (const [side, S] of [
	["L", "Left"],
	["R", "Right"],
] as const) {
	Object.assign(MIXAMO, {
		[`clavicle.${side}`]: `${S}Shoulder`,
		[`upperarm01.${side}`]: `${S}Arm`,
		[`lowerarm01.${side}`]: `${S}ForeArm`,
		[`wrist.${side}`]: `${S}Hand`,
		[`upperleg01.${side}`]: `${S}UpLeg`,
		[`lowerleg01.${side}`]: `${S}Leg`,
		[`foot.${side}`]: `${S}Foot`,
	});
	["Thumb", "Index", "Middle", "Ring", "Pinky"].forEach((finger, i) => {
		for (let k = 1; k <= 3; k++)
			MIXAMO[`finger${i + 1}-${k}.${side}`] = `${S}Hand${finger}${k}`;
	});
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** MakeHuman's macro weights: each dimension splits into its named levels. */
function levels(o: HumanOptions) {
	const sex = clamp01(o.sex ?? 0.5);
	const age = clamp01(o.age ?? 0.5);
	const muscle = clamp01(o.muscle ?? 0.5);
	const weight = clamp01(o.weight ?? 0.5);
	const prop = clamp01(o.proportions ?? 0.5);
	const three = (v: number) => {
		const min = Math.max(0, 1 - v * 2);
		const max = Math.max(0, (v - 0.5) * 2);
		return { min, average: 1 - min - max, max };
	};
	let ages: Record<string, number>;
	if (age < 0.5) {
		const adult = Math.max(0, (age - 0.1875) * 3.2);
		ages = {
			baby: Math.max(0, 1 - age * 5.333),
			child: Math.max(0, Math.min(1, 5.333 * age) - adult),
			young: adult,
			old: 0,
		};
	} else
		ages = {
			baby: 0,
			child: 0,
			young: Math.max(0, 1 - (age - 0.5) * 2),
			old: Math.max(0, (age - 0.5) * 2),
		};
	const eth = o.ethnicity ?? {};
	const e = {
		african: eth.african ?? 1 / 3,
		asian: eth.asian ?? 1 / 3,
		caucasian: eth.caucasian ?? 1 / 3,
	};
	const eSum = e.african + e.asian + e.caucasian || 1;
	return {
		sexes: { female: 1 - sex, male: sex },
		ages,
		muscles: three(muscle),
		weights: three(weight),
		proportions: {
			uncommon: Math.max(0, 1 - prop * 2),
			ideal: Math.max(0, (prop - 0.5) * 2),
		},
		ethnic: {
			african: e.african / eSum,
			asian: e.asian / eSum,
			caucasian: e.caucasian / eSum,
		},
	};
}

/** Every macro target with a non-zero weight. */
export function macroTargets(o: HumanOptions): Map<string, number> {
	const L = levels(o);
	const out = new Map<string, number>();
	const put = (path: string, w: number) => {
		if (w > 1e-6) out.set(path, (out.get(path) ?? 0) + w);
	};
	const mw = (m: string) => (m === "average" ? "averagemuscle" : `${m}muscle`);
	const ww = (m: string) => (m === "average" ? "averageweight" : `${m}weight`);
	for (const [sex, ws] of Object.entries(L.sexes))
		for (const [age, wa] of Object.entries(L.ages))
			for (const [mus, wm] of Object.entries(L.muscles))
				for (const [wt, wwt] of Object.entries(L.weights)) {
					const w = ws * wa * wm * wwt;
					put(`macrodetails/universal-${sex}-${age}-${mw(mus)}-${ww(wt)}`, w);
					// Proportions exist for child, young and old; height targets are handled by scaling.
					if (age !== "baby")
						for (const [p, wp] of Object.entries(L.proportions))
							put(
								`macrodetails/proportions/${sex}-${age}-${mw(mus)}-${ww(wt)}-${p}proportions`,
								w * wp,
							);
				}
	for (const [race, wr] of Object.entries(L.ethnic))
		for (const [sex, ws] of Object.entries(L.sexes))
			for (const [age, wa] of Object.entries(L.ages))
				put(`macrodetails/${race}-${sex}-${age}`, wr * ws * wa);
	return out;
}

/** Applies weighted targets to a copy of the base positions. */
function shape(base: Float32Array, targets: [Target, number][]): Float32Array {
	const p = Float32Array.from(base);
	for (const [t, w] of targets)
		for (let i = 0; i < t.indices.length; i++) {
			const v = (t.indices[i] as number) * 3;
			p[v] = (p[v] as number) + (t.deltas[i * 3] as number) * w;
			p[v + 1] = (p[v + 1] as number) + (t.deltas[i * 3 + 1] as number) * w;
			p[v + 2] = (p[v + 2] as number) + (t.deltas[i * 3 + 2] as number) * w;
		}
	return p;
}

const cache = new WeakMap<
	HumanAssetStore,
	Promise<{
		base: BaseMesh;
		rig: MhSkeleton;
		weights: Map<string, [number, number][]>;
		eyes: {
			obj: ReturnType<typeof parseObj>;
			proxy: MhProxy;
			texture: Uint8Array;
		};
	}>
>();
const targetCache = new WeakMap<
	HumanAssetStore,
	Map<string, Promise<Target>>
>();

function baseAssets(store: HumanAssetStore) {
	let p = cache.get(store);
	if (!p) {
		p = Promise.all([
			store.text("3dobjs/base.obj"),
			store.text("rigs/default.mhskel"),
			store.text("rigs/default_weights.mhw"),
			store.text("eyes/high-poly/high-poly.obj"),
			store.text("eyes/high-poly/high-poly.mhclo"),
			store.ensure("eyes/materials/brown_eye.png"),
		]).then(([obj, skel, w, eyeObj, eyeClo, eyeTex]) => ({
			base: parseBaseObj(obj),
			rig: parseSkeleton(skel),
			weights: parseWeights(w),
			eyes: {
				obj: parseObj(eyeObj),
				proxy: parseProxy(eyeClo),
				texture: eyeTex,
			},
		}));
		cache.set(store, p);
	}
	return p;
}

function target(store: HumanAssetStore, path: string): Promise<Target> {
	let m = targetCache.get(store);
	if (!m) {
		m = new Map();
		targetCache.set(store, m);
	}
	let p = m.get(path);
	if (!p) {
		p = store.text(`targets/${path}.target`).then(parseTarget);
		m.set(path, p);
	}
	return p;
}

let defaultStore: HumanAssetStore | undefined;

/** Builds a shaped, rigged, skinned human. Model units are centimeters; feet on y = 0, facing +z. */
export async function human(options: HumanOptions = {}): Promise<HumanModel> {
	defaultStore ??= new HumanAssetStore();
	const store = options.store ?? defaultStore;
	const { base, rig, weights, eyes } = await baseAssets(store);
	const wanted = macroTargets(options);
	for (const [path, w] of Object.entries(options.targets ?? {}))
		if (w) wanted.set(path, (wanted.get(path) ?? 0) + w);
	const loaded = await Promise.all(
		[...wanted].map(
			async ([path, w]) => [await target(store, path), w] as [Target, number],
		),
	);
	const shaped = shape(base.positions, loaded);

	// Body vertices: every (vertex, uv) pair used by the body's faces.
	const corner = new Map<number, number>();
	const src: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const nUv = base.uvs.length / 2;
	const vertexOf = (v: number, vt: number) => {
		const key = v * nUv + vt;
		let i = corner.get(key);
		if (i === undefined) {
			i = src.length;
			corner.set(key, i);
			src.push(v);
			// glTF's v runs down from the top of the image.
			uvs.push(
				base.uvs[vt * 2] as number,
				1 - (base.uvs[vt * 2 + 1] as number),
			);
		}
		return i;
	};
	for (const f of base.faces) {
		const c = f.v.map((v, k) => vertexOf(v, f.vt[k] as number));
		for (let k = 1; k + 1 < c.length; k++)
			indices.push(c[0] as number, c[k] as number, c[k + 1] as number);
	}

	// Feet on y = 0, decimeters → centimeters, then the requested height.
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const v of src) {
		const y = shaped[v * 3 + 1] as number;
		minY = Math.min(minY, y);
		maxY = Math.max(maxY, y);
	}
	const natural = (maxY - minY) * 10;
	const scale = 10 * (options.height ? options.height / natural : 1);
	const at = (v: number): Vec3 => [
		(shaped[v * 3] as number) * scale,
		((shaped[v * 3 + 1] as number) - minY) * scale,
		(shaped[v * 3 + 2] as number) * scale,
	];
	const positions = src.flatMap((v) => at(v));
	const bodyNormals = vertexNormals(positions, indices, src);

	// Skeleton: each bone's head is the mean of its joint group on the shaped body.
	const skeleton = new Skeleton();
	const nameOf = (b: string) => MIXAMO[b] ?? b;
	const jointAt = (group: string): Vec3 => {
		const vs = rig.joints.get(group);
		if (!vs?.length)
			throw new Error(`human: rig joint "${group}" has no vertices`);
		const sum: Vec3 = [0, 0, 0];
		for (const v of vs) {
			const p = at(v);
			sum[0] += p[0];
			sum[1] += p[1];
			sum[2] += p[2];
		}
		return [sum[0] / vs.length, sum[1] / vs.length, sum[2] / vs.length];
	};
	// Eyes turn about their centers; MakeHuman's eye bones start at the back of the eyeball.
	const toModel = (x: number, y: number, z: number): Vec3 => [
		x * scale,
		(y - minY) * scale,
		z * scale,
	];
	const fittedEyes = fitEyes(eyes, shaped);
	const centers = eyeCenters(fittedEyes, toModel);
	const pivot: Record<string, Vec3> = {
		"eye.L": centers.left,
		"eye.R": centers.right,
	};
	for (const b of rig.bones)
		skeleton.add(nameOf(b.name), {
			at: pivot[b.name] ?? jointAt(b.head),
			...(b.parent ? { parent: nameOf(b.parent) } : {}),
		});

	// Painted weights, top four per vertex.
	const perVertex = new Map<number, [number, number][]>();
	rig.bones.forEach((b, j) => {
		for (const [v, w] of weights.get(b.name) ?? []) {
			let l = perVertex.get(v);
			if (!l) {
				l = [];
				perVertex.set(v, l);
			}
			l.push([j, w]);
		}
	});
	/** Top four painted weights per vertex, normalized. */
	const skinOf = (list: number[]) => {
		const joints = new Array<number>(list.length * 4).fill(0);
		const weights = new Array<number>(list.length * 4).fill(0);
		list.forEach((v, i) => {
			const l = (perVertex.get(v) ?? [[0, 1]])
				.sort((a, b) => b[1] - a[1])
				.slice(0, 4);
			const sum = l.reduce((t, x) => t + x[1], 0) || 1;
			l.forEach(([j, w], k) => {
				joints[i * 4 + k] = j;
				weights[i * 4 + k] = w / sum;
			});
		});
		return { joints, weights };
	};
	const { joints, weights: wts } = skinOf(src);

	// Teeth and tongue: helper geometry of the base mesh, skinned and shaped like the body.
	const mouthFaces = [...base.helpers.values()].flat();
	const mouthSrc: number[] = [];
	const mouthUvs: number[] = [];
	const mouthIndices: number[] = [];
	const mouthCorner = new Map<number, number>();
	for (const f of mouthFaces) {
		const c = f.v.map((v, k) => {
			const vt = f.vt[k] as number;
			const key = v * nUv + vt;
			let i = mouthCorner.get(key);
			if (i === undefined) {
				i = mouthSrc.length;
				mouthCorner.set(key, i);
				mouthSrc.push(v);
				mouthUvs.push(base.uvs[vt * 2] ?? 0, 1 - (base.uvs[vt * 2 + 1] ?? 0));
			}
			return i;
		});
		for (let k = 1; k + 1 < c.length; k++)
			mouthIndices.push(c[0] as number, c[k] as number, c[k + 1] as number);
	}
	const mouthPositions = mouthSrc.flatMap((v) => at(v));
	const mouthNormals = vertexNormals(mouthPositions, mouthIndices, mouthSrc);
	const mouthSkin = skinOf(mouthSrc);
	const expressions = options.expressions !== false;
	const ethnic = levels(options).ethnic;

	const subdivisions = Math.max(0, Math.floor(options.subdivide ?? 0));
	const smooth = <T extends HumanPart & { targets: MorphTargetSpec[] }>(
		part: T,
		weld: number[],
	): T =>
		subdivisions
			? { ...part, ...(subdivide(part, { levels: subdivisions, weld }) as T) }
			: part;
	const model = {
		skeleton,
		body: {
			positions,
			normals: bodyNormals,
			uvs,
			joints,
			weights: wts,
			indices,
			targets: expressions
				? await faceTargets(
						store,
						ethnic,
						base.positions,
						src,
						scale,
						positions,
						indices,
						bodyNormals,
					)
				: [],
		},
		mouth: {
			positions: mouthPositions,
			normals: mouthNormals,
			uvs: mouthUvs,
			joints: mouthSkin.joints,
			weights: mouthSkin.weights,
			indices: mouthIndices,
			// Only the shapes that move the teeth or tongue (jaw, lips).
			targets: expressions
				? (
						await faceTargets(
							store,
							ethnic,
							base.positions,
							mouthSrc,
							scale,
							mouthPositions,
							mouthIndices,
							mouthNormals,
						)
					).filter((t) => Array.from(t.positions).some((d) => d !== 0))
				: [],
		},
		eyes: eyeballs(eyes.obj, fittedEyes, toModel, skeleton, false),
		cornea: eyeballs(eyes.obj, fittedEyes, toModel, skeleton, true),
		eyeTexture: eyes.texture,
		drivers: LID_DRIVERS,
		height: natural * (scale / 10),
	};
	// Copies of a base vertex at UV seams weld into one surface point.
	return {
		...model,
		body: smooth(model.body, src),
		mouth: smooth(model.mouth, mouthSrc),
	};
}

/** The eye mesh fitted to the shaped head, with each vertex's shell marked. */
interface FittedEyes {
	fitted: Float32Array;
	/** Per vertex: part of a cornea shell (left out). */
	cornea: Uint8Array;
}

/**
 * Each eye in MakeHuman's mesh is two shells: the eyeball and, just
 * outside it, a clear cornea mapped to the texture's transparent corner.
 * Per side, the shell reaching further forward is the cornea.
 */
function fitEyes(
	eyes: { obj: ReturnType<typeof parseObj>; proxy: MhProxy },
	shaped: Float32Array,
): FittedEyes {
	const fitted = fitProxy(eyes.proxy, shaped);
	const nv = fitted.length / 3;
	const parent = Array.from({ length: nv }, (_, i) => i);
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x] as number] as number;
			x = parent[x] as number;
		}
		return x;
	};
	for (const f of eyes.obj.faces)
		for (const v of f.v) parent[find(v)] = find(f.v[0] as number);
	const shells = new Map<number, { maxZ: number; side: number }>();
	for (let v = 0; v < nv; v++) {
		const r = find(v);
		const sh = shells.get(r) ?? { maxZ: Number.NEGATIVE_INFINITY, side: 0 };
		sh.maxZ = Math.max(sh.maxZ, fitted[v * 3 + 2] as number);
		sh.side += fitted[v * 3] as number;
		shells.set(r, sh);
	}
	const corneaRoots = new Set<number>();
	for (const side of [-1, 1]) {
		const mine = [...shells].filter(([, sh]) => Math.sign(sh.side) === side);
		if (mine.length > 1) {
			mine.sort((a, b) => b[1].maxZ - a[1].maxZ);
			corneaRoots.add((mine[0] as [number, unknown])[0]);
		}
	}
	const cornea = new Uint8Array(nv);
	for (let v = 0; v < nv; v++) if (corneaRoots.has(find(v))) cornea[v] = 1;
	return { fitted, cornea };
}

/**
 * Each eyeball's center, model space: where the eye turns. The shell is
 * only the front of the ball, so its mean sits forward of the center; the
 * least-squares sphere through its vertices finds the real one.
 */
function eyeCenters(
	e: FittedEyes,
	toModel: (x: number, y: number, z: number) => Vec3,
) {
	const side = (sign: number): Vec3 => {
		const pts: Vec3[] = [];
		for (let v = 0; v < e.cornea.length; v++)
			if (!e.cornea[v] && Math.sign(e.fitted[v * 3] as number) === sign)
				pts.push(
					toModel(
						e.fitted[v * 3] as number,
						e.fitted[v * 3 + 1] as number,
						e.fitted[v * 3 + 2] as number,
					),
				);
		return sphereCenter(pts);
	};
	return { left: side(1), right: side(-1) };
}

/** Center of the least-squares sphere through points: |p|² = 2c·p + k, solved by normal equations. */
function sphereCenter(pts: Vec3[]): Vec3 {
	const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
	const b = [0, 0, 0, 0];
	for (const p of pts) {
		const row = [2 * p[0], 2 * p[1], 2 * p[2], 1];
		const rhs = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
		for (let i = 0; i < 4; i++) {
			b[i] = (b[i] as number) + (row[i] as number) * rhs;
			for (let j = 0; j < 4; j++)
				(A[i] as number[])[j] =
					((A[i] as number[])[j] as number) +
					(row[i] as number) * (row[j] as number);
		}
	}
	// Gaussian elimination with partial pivoting on the 4×4 system.
	const M = A.map((r, i) => [...r, b[i] as number]);
	for (let c = 0; c < 4; c++) {
		let piv = c;
		for (let r = c + 1; r < 4; r++)
			if (
				Math.abs((M[r] as number[])[c] as number) >
				Math.abs((M[piv] as number[])[c] as number)
			)
				piv = r;
		[M[c], M[piv]] = [M[piv] as number[], M[c] as number[]];
		const d = (M[c] as number[])[c] as number;
		if (Math.abs(d) < 1e-12) throw new Error("human: eye shell is degenerate");
		for (let r = 0; r < 4; r++) {
			if (r === c) continue;
			const f = ((M[r] as number[])[c] as number) / d;
			for (let k = c; k < 5; k++)
				(M[r] as number[])[k] =
					((M[r] as number[])[k] as number) -
					f * ((M[c] as number[])[k] as number);
		}
	}
	const x = M.map((r, i) => (r[4] as number) / (r[i] as number));
	return [x[0] as number, x[1] as number, x[2] as number];
}

/** The eyeballs (or their corneas) as a primitive, each moved by its eye joint. */
function eyeballs(
	obj: ReturnType<typeof parseObj>,
	e: FittedEyes,
	toModel: (x: number, y: number, z: number) => Vec3,
	skeleton: Skeleton,
	cornea: boolean,
): HumanPart {
	const leftEye = skeleton.joint("LeftEye").index;
	const rightEye = skeleton.joint("RightEye").index;
	const corner = new Map<number, number>();
	const positions: number[] = [];
	const uvs: number[] = [];
	const joints: number[] = [];
	const weights: number[] = [];
	const indices: number[] = [];
	const src: number[] = [];
	const nUv = obj.uvs.length / 2;
	const { fitted } = e;
	for (const f of obj.faces) {
		if (Boolean(e.cornea[f.v[0] as number]) !== cornea) continue;
		const c = f.v.map((v, k) => {
			const vt = f.vt[k] as number;
			const key = v * nUv + vt;
			let i = corner.get(key);
			if (i === undefined) {
				i = src.length;
				corner.set(key, i);
				src.push(v);
				positions.push(
					...toModel(
						fitted[v * 3] as number,
						fitted[v * 3 + 1] as number,
						fitted[v * 3 + 2] as number,
					),
				);
				uvs.push(
					obj.uvs[vt * 2] as number,
					1 - (obj.uvs[vt * 2 + 1] as number),
				);
				// The character's left is +x.
				joints.push(
					(fitted[v * 3] as number) > 0 ? leftEye : rightEye,
					0,
					0,
					0,
				);
				weights.push(1, 0, 0, 0);
			}
			return i;
		});
		for (let k = 1; k + 1 < c.length; k++)
			indices.push(c[0] as number, c[k] as number, c[k + 1] as number);
	}
	return {
		positions,
		normals: vertexNormals(positions, indices, src),
		uvs,
		joints,
		weights,
		indices,
	};
}
/** Smooth normals, averaged across UV seams (vertices with the same source vertex share one). */
function vertexNormals(
	positions: number[],
	indices: number[],
	src: number[],
): number[] {
	const acc = new Map<number, Vec3>();
	for (let t = 0; t < indices.length; t += 3) {
		const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]] as [
			number,
			number,
			number,
		];
		const p = (i: number): Vec3 => [
			positions[i * 3] as number,
			positions[i * 3 + 1] as number,
			positions[i * 3 + 2] as number,
		];
		const [pa, pb, pc] = [p(a), p(b), p(c)];
		const u: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
		const w: Vec3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
		const n: Vec3 = [
			u[1] * w[2] - u[2] * w[1],
			u[2] * w[0] - u[0] * w[2],
			u[0] * w[1] - u[1] * w[0],
		];
		for (const i of [a, b, c]) {
			const s = src[i] as number;
			const cur = acc.get(s) ?? [0, 0, 0];
			acc.set(s, [cur[0] + n[0], cur[1] + n[1], cur[2] + n[2]]);
		}
	}
	return src.flatMap((s) => {
		const n = acc.get(s) ?? [0, 1, 0];
		const l = Math.hypot(n[0], n[1], n[2]) || 1;
		return [n[0] / l, n[1] / l, n[2] / l];
	});
}

/**
 * The facial blend shapes on the body: each ARKit-named shape sums its
 * MakeHuman units (blended by ethnicity, halved for one side where the
 * unit is symmetric) into model units, with normal deltas so the shaded
 * surface follows the shape.
 */
async function faceTargets(
	store: HumanAssetStore,
	ethnic: Record<string, number>,
	basePositions: Float32Array,
	src: number[],
	scale: number,
	positions: number[],
	indices: number[],
	normals: number[],
): Promise<MorphTargetSpec[]> {
	const bodyOf = new Map<number, number[]>();
	src.forEach((v, i) => {
		const list = bodyOf.get(v);
		if (list) list.push(i);
		else bodyOf.set(v, [i]);
	});
	const n = src.length;
	const shapes = await Promise.all(
		Object.entries(FACE_SHAPES).map(async ([name, source]) => {
			const delta = new Float32Array(n * 3);
			for (const unit of source.units)
				for (const race of ETHNIC_UNITS) {
					const we = ethnic[race] ?? 0;
					if (we <= 0) continue;
					const t = await target(store, `expression/units/${race}/${unit}`);
					for (let k = 0; k < t.indices.length; k++) {
						const v = t.indices[k] as number;
						const w =
							we *
							scale *
							halfWeight(source.half, basePositions[v * 3] as number);
						if (!w) continue;
						for (const i of bodyOf.get(v) ?? [])
							for (let a = 0; a < 3; a++)
								delta[i * 3 + a] =
									(delta[i * 3 + a] as number) +
									(t.deltas[k * 3 + a] as number) * w;
					}
				}
			const moved = positions.map((p, i) => p + (delta[i] as number));
			const shaped = vertexNormals(moved, indices, src);
			const normalDelta = shaped.map((v, i) => v - (normals[i] as number));
			return { name, positions: delta, normals: normalDelta };
		}),
	);
	return shapes;
}
