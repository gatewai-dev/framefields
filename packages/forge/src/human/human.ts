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
import type { PrimitiveSpec } from "../document.js";
import { Skeleton, type Vec3 } from "../skeleton.js";
import {
	type BaseMesh,
	type MhSkeleton,
	parseBaseObj,
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
	/** Where the assets come from (default: a store on the shared cache). */
	store?: HumanAssetStore;
}

export interface HumanModel {
	skeleton: Skeleton;
	/** The skinned body, ready for `GltfDocument.addMesh` (add a material). */
	body: Required<
		Pick<
			PrimitiveSpec,
			"positions" | "normals" | "uvs" | "joints" | "weights" | "indices"
		>
	>;
	/** Model height after shaping and scaling, model units. */
	height: number;
}

/** MakeHuman bone → Mixamo joint name, for the bones Mixamo has. */
const MIXAMO: Record<string, string> = {
	root: "Hips",
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
		]).then(([obj, skel, w]) => ({
			base: parseBaseObj(obj),
			rig: parseSkeleton(skel),
			weights: parseWeights(w),
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
	const { base, rig, weights } = await baseAssets(store);
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
	for (const b of rig.bones)
		skeleton.add(nameOf(b.name), {
			at: jointAt(b.head),
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
	const joints = new Array<number>(src.length * 4).fill(0);
	const wts = new Array<number>(src.length * 4).fill(0);
	src.forEach((v, i) => {
		const l = (perVertex.get(v) ?? [[0, 1]])
			.sort((a, b) => b[1] - a[1])
			.slice(0, 4);
		const sum = l.reduce((s, x) => s + x[1], 0) || 1;
		l.forEach(([j, w], k) => {
			joints[i * 4 + k] = j;
			wts[i * 4 + k] = w / sum;
		});
	});

	return {
		skeleton,
		body: {
			positions,
			normals: vertexNormals(positions, indices, src),
			uvs,
			joints,
			weights: wts,
			indices,
		},
		height: natural * (scale / 10),
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
