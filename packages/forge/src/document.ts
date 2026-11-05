/**
 * A glTF 2.0 document built in code and written as one GLB: meshes with
 * named morph targets, PBR materials with Khronos extensions, textures,
 * a node tree, skins from a `Skeleton`, and animation clips. Every call
 * checks its input, so a mistake fails where it is made, not as a blank
 * model in a render.
 *
 * ```ts
 * const doc = new GltfDocument();
 * const rig = doc.addSkeleton(humanoidSkeleton({ height: 186, heads: 8 }));
 * const skin = doc.addMaterial({ color: "#e8d2b0", roughness: 0.55, sheen: { color: "#ffd9c0" } });
 * const body = doc.addMesh({ name: "Body", primitives: [{ positions, normals, joints, weights, indices, material: skin }] });
 * doc.addNode({ name: "Ithrael", mesh: body, skin: rig.skin });
 * fs.writeFileSync("ithrael.glb", doc.toGlb());
 * ```
 */

import { GlbBuilder } from "./glb-builder.js";
import {
	type MaterialSpec,
	materialJson,
	type TextureRef,
} from "./material.js";
import {
	quatConjugate,
	quatRotate,
	type Skeleton,
	type Vec3,
} from "./skeleton.js";
import { computeTangents } from "./tangents.js";

type Numbers = ArrayLike<number>;

export interface MorphTargetSpec {
	/** Written to `mesh.extras.targetNames` (the convention every DCC tool reads). */
	name: string;
	/** Per-vertex position deltas (3 per vertex). */
	positions: Numbers;
	/** Per-vertex normal deltas (3 per vertex). */
	normals?: Numbers;
}

export interface PrimitiveSpec {
	/** 3 per vertex. */
	positions: Numbers;
	/** 3 per vertex, unit length. */
	normals?: Numbers;
	/** 4 per vertex (xyz, handedness w). */
	tangents?: Numbers;
	/** 2 per vertex, glTF orientation (v down from the top of the image). */
	uvs?: Numbers;
	/** A second UV set (e.g. baked maps). */
	uvs1?: Numbers;
	/** Vertex color, linear RGBA, 4 per vertex. */
	colors?: Numbers;
	/**
	 * 4 joint indices per vertex, into the skin's joint list, or 8 (written
	 * as glTF's two sets, JOINTS_0 and JOINTS_1) for faces that need them.
	 */
	joints?: Numbers;
	/** 4 or 8 weights per vertex, like `joints`; normalized on write. */
	weights?: Numbers;
	/** Triangle (or line / point) indices; omit for an unindexed list. */
	indices?: Numbers;
	material?: MaterialRef;
	/** Default "triangles". */
	mode?: "triangles" | "lines" | "points";
	targets?: MorphTargetSpec[];
}

export interface MeshSpec {
	name?: string;
	primitives: PrimitiveSpec[];
	/** Default morph weights, one per target. */
	weights?: number[];
}

export interface NodeSpec {
	name?: string;
	mesh?: MeshRef;
	skin?: SkinRef;
	translation?: [number, number, number];
	/** Quaternion x, y, z, w. */
	rotation?: [number, number, number, number];
	scale?: [number, number, number];
	children?: NodeRef[];
	extras?: Record<string, unknown>;
}

export type AnimationPath = "translation" | "rotation" | "scale" | "weights";

export interface ChannelSpec {
	node: NodeRef;
	path: AnimationPath;
	/** Key times in seconds, increasing. */
	times: Numbers;
	/** 3 (translation, scale), 4 (rotation) or one per morph target (weights) per key. */
	values: Numbers;
	/** Default "linear". */
	interpolation?: "linear" | "step";
}

export interface AnimationSpec {
	name: string;
	channels: ChannelSpec[];
}

/**
 * A joint driven by another (framefields rigs read it from the scene's
 * `extras.framefields.drivers`): it turns by a share of the source joint's
 * turn from its rest, per local axis.
 */
export interface DriverSpec {
	joint: string;
	from: string;
	rotate: { x?: number; y?: number; z?: number };
}

export interface TextureSpec {
	/** Encoded image bytes. */
	image: Uint8Array;
	mimeType: "image/png" | "image/jpeg" | "image/webp";
	wrap?: "repeat" | "clamp" | "mirror";
	filter?: "linear" | "nearest";
}

export interface MeshRef {
	readonly mesh: number;
	readonly targetNames: readonly string[];
	readonly maxJoint: number;
}
export interface MaterialRef {
	readonly material: number;
}
export interface NodeRef {
	readonly node: number;
}
export interface SkinRef {
	readonly skin: number;
	readonly jointCount: number;
}

export interface SkeletonRefs {
	skin: SkinRef;
	/** The root joints' nodes (usually one: Hips). */
	roots: NodeRef[];
	/** Each joint's node, by joint name. */
	joints: ReadonlyMap<string, NodeRef>;
	/** Joint name → index in the skin (for `PrimitiveSpec.joints`). */
	jointIndex: ReadonlyMap<string, number>;
}

const PATH_SIZE: Record<Exclude<AnimationPath, "weights">, number> = {
	translation: 3,
	rotation: 4,
	scale: 3,
};

const WRAP = { repeat: 10497, clamp: 33071, mirror: 33648 } as const;
const FILTER = {
	linear: { magFilter: 9729, minFilter: 9987 },
	nearest: { magFilter: 9728, minFilter: 9984 },
} as const;
const MODE = { points: 0, lines: 1, triangles: 4 } as const;

function floats(name: string, data: Numbers, size: number, count?: number) {
	if (data.length % size !== 0)
		throw new Error(
			`${name}: length ${data.length} is not a multiple of ${size}`,
		);
	if (count !== undefined && data.length / size !== count)
		throw new Error(
			`${name}: ${data.length / size} entries for ${count} vertices`,
		);
	const out = Float32Array.from(data);
	for (let i = 0; i < out.length; i++)
		if (!Number.isFinite(out[i]))
			throw new Error(`${name}: value ${i} is not finite`);
	return out;
}

/** Weights normalized to sum 1 per vertex (glTF requires it). */
function normalizedWeights(
	data: Numbers,
	count: number,
	size: number,
): Float32Array {
	const w = floats("weights", data, size, count);
	for (let v = 0; v < count; v++) {
		const o = v * size;
		let sum = 0;
		for (let i = 0; i < size; i++) {
			if ((w[o + i] as number) < 0)
				throw new Error(`weights: vertex ${v} has a negative weight`);
			sum += w[o + i] as number;
		}
		if (sum <= 0) throw new Error(`weights: vertex ${v} has no weight`);
		for (let i = 0; i < size; i++) w[o + i] = (w[o + i] as number) / sum;
	}
	return w;
}

/** Columns `from … from + 3` of an `size`-wide table: one glTF influence set. */
function influenceSet<T extends Float32Array | Uint8Array | Uint16Array>(
	data: T,
	size: number,
	from: number,
): T {
	const count = data.length / size;
	const out = new (data.constructor as new (n: number) => T)(count * 4);
	for (let v = 0; v < count; v++)
		for (let k = 0; k < 4; k++)
			out[v * 4 + k] = data[v * size + from + k] as number;
	return out;
}

export class GltfDocument {
	private readonly bin = new GlbBuilder();
	private readonly materials: Record<string, unknown>[] = [];
	private readonly meshes: Record<string, unknown>[] = [];
	private readonly meshRefs: MeshRef[] = [];
	private readonly nodes: Record<string, unknown>[] = [];
	private readonly parents = new Map<number, number>();
	private readonly skins: Record<string, unknown>[] = [];
	private readonly skinRefs: SkinRef[] = [];
	private readonly animations: Record<string, unknown>[] = [];
	private readonly textures: Record<string, unknown>[] = [];
	private readonly images: Record<string, unknown>[] = [];
	private readonly samplers: Record<string, unknown>[] = [];
	private readonly extensions = new Set<string>();
	private readonly drivers: DriverSpec[] = [];

	addMaterial(spec: MaterialSpec): MaterialRef {
		const { json, extensions } = materialJson(spec);
		for (const e of extensions) this.extensions.add(e);
		for (const t of [
			spec.colorTexture,
			spec.metallicRoughnessTexture,
			spec.normalTexture,
			spec.occlusionTexture,
			spec.emissiveTexture,
		])
			if (t) this.checkTexture(t);
		this.materials.push(json);
		return { material: this.materials.length - 1 };
	}

	addTexture(spec: TextureSpec): TextureRef {
		const bufferView = this.bin.image(spec.image);
		this.images.push({ bufferView, mimeType: spec.mimeType });
		const wrap = WRAP[spec.wrap ?? "repeat"];
		this.samplers.push({
			...FILTER[spec.filter ?? "linear"],
			wrapS: wrap,
			wrapT: wrap,
		});
		this.textures.push({
			source: this.images.length - 1,
			sampler: this.samplers.length - 1,
		});
		return { texture: this.textures.length - 1 };
	}

	addMesh(spec: MeshSpec): MeshRef {
		if (!spec.primitives.length)
			throw new Error(`mesh ${spec.name ?? ""}: no primitives`);
		const names = spec.primitives[0]?.targets?.map((t) => t.name) ?? [];
		if (new Set(names).size !== names.length)
			throw new Error(`mesh ${spec.name ?? ""}: duplicate morph target names`);
		let maxJoint = -1;
		const primitives = spec.primitives.map((p, i) => {
			const label = `mesh ${spec.name ?? this.meshes.length} primitive ${i}`;
			const targets = p.targets?.map((t) => t.name) ?? [];
			if (targets.join("\0") !== names.join("\0"))
				throw new Error(
					`${label}: every primitive needs the same morph targets in the same order`,
				);
			const { json, maxJoint: mj } = this.primitive(p, label);
			maxJoint = Math.max(maxJoint, mj);
			return json;
		});
		if (spec.weights && spec.weights.length !== names.length)
			throw new Error(
				`mesh ${spec.name ?? ""}: ${spec.weights.length} default weights for ${names.length} targets`,
			);
		this.meshes.push({
			...(spec.name ? { name: spec.name } : {}),
			primitives,
			...(spec.weights ? { weights: spec.weights } : {}),
			...(names.length ? { extras: { targetNames: names } } : {}),
		});
		const ref: MeshRef = {
			mesh: this.meshes.length - 1,
			targetNames: names,
			maxJoint,
		};
		this.meshRefs.push(ref);
		return ref;
	}

	private primitive(p: PrimitiveSpec, label: string) {
		const positions = floats(`${label} positions`, p.positions, 3);
		const count = positions.length / 3;
		if (!count) throw new Error(`${label}: no vertices`);
		const attributes: Record<string, number> = {
			POSITION: this.bin.accessor(positions, "VEC3", {
				bounds: true,
				target: "vertex",
			}),
		};
		const vertex = (data: Float32Array, type: "VEC2" | "VEC3" | "VEC4") =>
			this.bin.accessor(data, type, { target: "vertex" });
		if (p.normals)
			attributes.NORMAL = vertex(
				floats(`${label} normals`, p.normals, 3, count),
				"VEC3",
			);
		const tangents = p.tangents ?? this.generatedTangents(p);
		if (tangents)
			attributes.TANGENT = vertex(
				floats(`${label} tangents`, tangents, 4, count),
				"VEC4",
			);
		if (p.uvs)
			attributes.TEXCOORD_0 = vertex(
				floats(`${label} uvs`, p.uvs, 2, count),
				"VEC2",
			);
		if (p.uvs1)
			attributes.TEXCOORD_1 = vertex(
				floats(`${label} uvs1`, p.uvs1, 2, count),
				"VEC2",
			);
		if (p.colors)
			attributes.COLOR_0 = vertex(
				floats(`${label} colors`, p.colors, 4, count),
				"VEC4",
			);
		let maxJoint = -1;
		if (p.joints || p.weights) {
			if (!p.joints || !p.weights)
				throw new Error(`${label}: joints and weights go together`);
			const size = p.joints.length / count;
			if (size !== 4 && size !== 8)
				throw new Error(
					`${label}: ${p.joints.length} joints for ${count} vertices (4 or 8 per vertex)`,
				);
			const j = floats(`${label} joints`, p.joints, size, count);
			for (const v of j) {
				if (!Number.isInteger(v) || v < 0)
					throw new Error(`${label}: joint index ${v} is not a whole number`);
				maxJoint = Math.max(maxJoint, v);
			}
			const joints = maxJoint < 256 ? Uint8Array.from(j) : Uint16Array.from(j);
			const weights = normalizedWeights(p.weights, count, size);
			for (let set = 0; set < size / 4; set++) {
				attributes[`JOINTS_${set}`] = this.bin.accessor(
					influenceSet(joints, size, set * 4),
					"VEC4",
					{ target: "vertex" },
				);
				attributes[`WEIGHTS_${set}`] = vertex(
					influenceSet(weights, size, set * 4),
					"VEC4",
				);
			}
		}
		const json: Record<string, unknown> = { attributes };
		if (p.indices) {
			const idx = Array.from(p.indices);
			if (!idx.length) throw new Error(`${label}: empty indices`);
			for (const v of idx)
				if (!Number.isInteger(v) || v < 0 || v >= count)
					throw new Error(`${label}: index ${v} outside 0..${count - 1}`);
			json.indices = this.bin.accessor(
				count <= 65535 ? Uint16Array.from(idx) : Uint32Array.from(idx),
				"SCALAR",
				{ target: "index" },
			);
		}
		if (p.material) {
			if (p.material.material >= this.materials.length)
				throw new Error(`${label}: unknown material`);
			json.material = p.material.material;
		}
		const mode = MODE[p.mode ?? "triangles"];
		if (mode !== 4) json.mode = mode;
		if (p.targets?.length) {
			json.targets = p.targets.map((t) => {
				const name = `${label} target ${t.name}`;
				const target: Record<string, number> = {
					POSITION: this.targetAccessor(
						floats(name, t.positions, 3, count),
						true,
					),
				};
				// Normal deltas that are all zero say nothing: leave them out.
				const normals =
					t.normals && floats(`${name} normals`, t.normals, 3, count);
				if (normals?.some((x) => x !== 0))
					target.NORMAL = this.targetAccessor(normals, false);
				return target;
			});
		}
		return { json, maxJoint };
	}

	/**
	 * Tangents for a normal-mapped triangle primitive that brings none, from
	 * the UV set its normal map reads (glTF viewers otherwise each make
	 * their own, and normal maps shade differently between them).
	 */
	private generatedTangents(p: PrimitiveSpec): Float32Array | undefined {
		if (!p.material || !p.normals || (p.mode ?? "triangles") !== "triangles")
			return undefined;
		const normal = this.materials[p.material.material]?.normalTexture as
			| { texCoord?: number }
			| undefined;
		if (!normal) return undefined;
		const uvs = normal.texCoord === 1 ? p.uvs1 : p.uvs;
		return uvs
			? computeTangents(p.positions, p.normals, uvs, p.indices)
			: undefined;
	}

	/** A morph target's deltas, sparse when they move under half the vertices. */
	private targetAccessor(deltas: Float32Array, bounds: boolean): number {
		const count = deltas.length / 3;
		const moved: number[] = [];
		for (let v = 0; v < count; v++)
			if (deltas[v * 3] || deltas[v * 3 + 1] || deltas[v * 3 + 2])
				moved.push(v);
		if (moved.length === 0 || moved.length * 2 >= count)
			return this.bin.accessor(deltas, "VEC3", { bounds, target: "vertex" });
		const values = new Float32Array(moved.length * 3);
		moved.forEach((v, i) => {
			values.set(deltas.subarray(v * 3, v * 3 + 3), i * 3);
		});
		return this.bin.sparseAccessor(
			count,
			"VEC3",
			Uint32Array.from(moved),
			values,
			{
				bounds,
			},
		);
	}

	addNode(spec: NodeSpec): NodeRef {
		const index = this.nodes.length;
		if (spec.skin && !spec.mesh)
			throw new Error(`node ${spec.name ?? index}: a skin needs a mesh`);
		if (spec.mesh && spec.skin && spec.mesh.maxJoint >= spec.skin.jointCount)
			throw new Error(
				`node ${spec.name ?? index}: mesh uses joint ${spec.mesh.maxJoint} but the skin has ${spec.skin.jointCount}`,
			);
		if (spec.mesh && !spec.skin && spec.mesh.maxJoint >= 0)
			throw new Error(
				`node ${spec.name ?? index}: skinned mesh without a skin`,
			);
		if (spec.rotation) {
			const [x, y, z, w] = spec.rotation;
			if (Math.abs(Math.hypot(x, y, z, w) - 1) > 1e-4)
				throw new Error(
					`node ${spec.name ?? index}: rotation is not a unit quaternion`,
				);
		}
		const children = spec.children?.map((c) => {
			if (this.parents.has(c.node))
				throw new Error(`node ${c.node} already has a parent`);
			this.parents.set(c.node, index);
			return c.node;
		});
		this.nodes.push({
			...(spec.name ? { name: spec.name } : {}),
			...(spec.mesh ? { mesh: spec.mesh.mesh } : {}),
			...(spec.skin ? { skin: spec.skin.skin } : {}),
			...(spec.translation ? { translation: spec.translation } : {}),
			...(spec.rotation ? { rotation: spec.rotation } : {}),
			...(spec.scale ? { scale: spec.scale } : {}),
			...(children?.length ? { children } : {}),
			...(spec.extras ? { extras: spec.extras } : {}),
		});
		return { node: index };
	}

	/**
	 * The skeleton's joints as a node tree (each translated from its parent,
	 * unrotated) and a skin whose inverse bind matrices undo each joint's
	 * rest position. Place the tree with `parent`, or leave it at the root.
	 */
	addSkeleton(
		skeleton: Skeleton,
		options: { parent?: NodeRef } = {},
	): SkeletonRefs {
		const joints = new Map<string, NodeRef>();
		const jointIndex = new Map<string, number>();
		const list = skeleton.joints;
		if (!list.length) throw new Error("skeleton: no joints");
		// Children are listed after parents; create nodes leaf-first so
		// `children` refers to nodes that exist.
		const nodeOf = new Map<string, NodeRef>();
		for (let i = list.length - 1; i >= 0; i--) {
			const j = list[i] as (typeof list)[number];
			const children = skeleton
				.children(j.name)
				.map((c) => nodeOf.get(c.name) as NodeRef);
			nodeOf.set(
				j.name,
				this.addNode({
					name: j.name,
					translation: skeleton.local(j.name),
					...(j.orient ? { rotation: skeleton.localRotation(j.name) } : {}),
					...(children.length ? { children } : {}),
					...(j.extras ? { extras: j.extras } : {}),
				}),
			);
		}
		const ibm = new Float32Array(list.length * 16);
		list.forEach((j, i) => {
			joints.set(j.name, nodeOf.get(j.name) as NodeRef);
			jointIndex.set(j.name, i);
			// The inverse of the joint's rest transform: Rᵀ, then −Rᵀ·at.
			const o = i * 16;
			const q = skeleton.orientation(j.name);
			const rt = [
				quatRotate(quatConjugate(q), [1, 0, 0]),
				quatRotate(quatConjugate(q), [0, 1, 0]),
				quatRotate(quatConjugate(q), [0, 0, 1]),
			];
			for (let c = 0; c < 3; c++)
				for (let r = 0; r < 3; r++)
					ibm[o + c * 4 + r] = ((rt[c] as Vec3)[r] as number) + 0; // no -0
			const t = quatRotate(quatConjugate(q), j.at);
			ibm[o + 12] = 0 - t[0];
			ibm[o + 13] = 0 - t[1];
			ibm[o + 14] = 0 - t[2];
			ibm[o + 15] = 1;
		});
		const roots = list
			.filter((j) => j.parent === undefined)
			.map((j) => nodeOf.get(j.name) as NodeRef);
		if (options.parent) {
			const parent = this.nodes[options.parent.node] as Record<string, unknown>;
			const kids = (parent.children as number[] | undefined) ?? [];
			for (const r of roots) {
				this.parents.set(r.node, options.parent.node);
				kids.push(r.node);
			}
			parent.children = kids;
		}
		this.skins.push({
			joints: list.map((j) => (nodeOf.get(j.name) as NodeRef).node),
			inverseBindMatrices: this.bin.accessor(ibm, "MAT4"),
			...(roots.length === 1 ? { skeleton: (roots[0] as NodeRef).node } : {}),
		});
		const skin: SkinRef = {
			skin: this.skins.length - 1,
			jointCount: list.length,
		};
		this.skinRefs.push(skin);
		return { skin, roots, joints, jointIndex };
	}

	addAnimation(spec: AnimationSpec): void {
		if (!spec.channels.length)
			throw new Error(`animation ${spec.name}: no channels`);
		const samplers: Record<string, unknown>[] = [];
		const channels = spec.channels.map((c, i) => {
			const label = `animation ${spec.name} channel ${i}`;
			const node = this.nodes[c.node.node];
			if (!node) throw new Error(`${label}: unknown node`);
			const times = floats(`${label} times`, c.times, 1);
			if (!times.length) throw new Error(`${label}: no keys`);
			for (let k = 1; k < times.length; k++)
				if ((times[k] as number) <= (times[k - 1] as number))
					throw new Error(`${label}: times must increase`);
			if ((times[0] as number) < 0) throw new Error(`${label}: negative time`);
			const size =
				c.path === "weights"
					? this.targetCount(node, label)
					: PATH_SIZE[c.path];
			const values = floats(`${label} values`, c.values, size, times.length);
			samplers.push({
				input: this.bin.accessor(times, "SCALAR", { bounds: true }),
				output: this.bin.accessor(
					values,
					c.path === "weights" ? "SCALAR" : size === 4 ? "VEC4" : "VEC3",
				),
				...(c.interpolation === "step" ? { interpolation: "STEP" } : {}),
			});
			return {
				sampler: samplers.length - 1,
				target: { node: c.node.node, path: c.path },
			};
		});
		this.animations.push({ name: spec.name, channels, samplers });
	}

	private targetCount(node: Record<string, unknown>, label: string): number {
		const mesh = node.mesh as number | undefined;
		const n =
			mesh === undefined ? 0 : (this.meshRefs[mesh]?.targetNames.length ?? 0);
		if (!n)
			throw new Error(`${label}: weights on a node without morph targets`);
		return n;
	}

	private checkTexture(t: TextureRef | { texture: TextureRef }) {
		const ref = typeof t.texture === "number" ? (t as TextureRef) : t.texture;
		if ((ref as TextureRef).texture >= this.textures.length)
			throw new Error("material: unknown texture");
	}

	/** Drives `joint` from `from` (eyelids following eyes, twist bones). Joints are matched by name at render time. */
	addDriver(spec: DriverSpec): void {
		const shares = Object.values(spec.rotate);
		if (!shares.length || shares.some((v) => !Number.isFinite(v)))
			throw new Error(
				`driver ${spec.joint}: give a finite share for at least one axis`,
			);
		this.drivers.push(spec);
	}

	/** The document's glTF JSON (without the binary chunk), for inspection. */
	json(): Record<string, unknown> {
		const roots = this.nodes
			.map((_, i) => i)
			.filter((i) => !this.parents.has(i));
		const out: Record<string, unknown> = {
			scene: 0,
			scenes: [
				{
					nodes: roots,
					...(this.drivers.length
						? { extras: { framefields: { drivers: this.drivers } } }
						: {}),
				},
			],
			nodes: this.nodes,
		};
		const put = (key: string, list: unknown[]) => {
			if (list.length) out[key] = list;
		};
		put("meshes", this.meshes);
		put("materials", this.materials);
		put("skins", this.skins);
		put("animations", this.animations);
		put("textures", this.textures);
		put("images", this.images);
		put("samplers", this.samplers);
		if (this.extensions.size) out.extensionsUsed = [...this.extensions].sort();
		return out;
	}

	/** The GLB file. */
	toGlb(): Uint8Array {
		return this.bin.build(this.json());
	}
}
