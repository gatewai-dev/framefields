/**
 * Skin weights from the sculpt itself. A vertex is moved by every part
 * whose own surface reaches it, fading to nothing a `falloff` beyond that
 * surface: where two limbs blend smoothly they share the vertices of the
 * blend, a hard seam moves with whichever side it belongs to, and a rigid
 * part moves with its joint alone. A part spread over several joints (a
 * torso over the spine) shares out by distance to their bones. A few
 * passes of smoothing over the mesh then soften the seams, and each vertex
 * keeps its four strongest joints.
 */
import type { Skeleton, Vec3 } from "../skeleton.js";
import type { PreparedPart, SculptField } from "./field.js";

export interface SkinOptions {
	/** Smoothing passes over the mesh. Default 2. */
	smoothing?: number;
	/** The smallest falloff, model units (about 1.5 lattice cells). */
	minFalloff: number;
}

export interface SkinWeights {
	joints: Uint16Array;
	weights: Float32Array;
}

interface Bone {
	joint: number;
	a: Vec3;
	b: Vec3;
}

function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
	const bx = b[0] - a[0];
	const by = b[1] - a[1];
	const bz = b[2] - a[2];
	const l2 = bx * bx + by * by + bz * bz;
	const px = p[0] - a[0];
	const py = p[1] - a[1];
	const pz = p[2] - a[2];
	const t =
		l2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / l2)) : 0;
	return Math.hypot(px - bx * t, py - by * t, pz - bz * t);
}

/** Each joint's bone: from the joint to its first child (a point for leaves). */
function bones(skeleton: Skeleton): Bone[] {
	return skeleton.joints.map((j) => {
		const child = skeleton.children(j.name)[0];
		return { joint: j.index, a: j.at, b: child ? child.at : j.at };
	});
}

/** The joints (bones) each part moves with. */
export function partBones(field: SculptField, skeleton: Skeleton): Bone[][] {
	const all = bones(skeleton);
	return field.parts.map((p) => {
		const spec = p.part.joint;
		if (spec !== undefined) {
			const names = typeof spec === "string" ? [spec] : spec;
			if (!names.length)
				throw new Error(`sculpt: part ${label(p)} has an empty joint list`);
			return names.map((n) => {
				if (!skeleton.has(n))
					throw new Error(
						`sculpt: part ${label(p)} names unknown joint "${n}"`,
					);
				return all[skeleton.joint(n).index] as Bone;
			});
		}
		let best = all[0] as Bone;
		let bestD = Number.POSITIVE_INFINITY;
		for (const b of all) {
			const d = segmentDistance(p.anchor, b.a, b.b);
			if (d < bestD) {
				bestD = d;
				best = b;
			}
		}
		return [best];
	});
}

const label = (p: PreparedPart) => p.part.name ?? `#${p.index}`;

/** Adds `w` to joint `j` in a small sparse list. */
function accumulate(list: number[], j: number, w: number) {
	for (let i = 0; i < list.length; i += 2)
		if (list[i] === j) {
			list[i + 1] = (list[i + 1] as number) + w;
			return;
		}
	list.push(j, w);
}

/** Skin weights for mesh vertices (`positions`, triangles `indices`). */
export function skinWeights(
	field: SculptField,
	skeleton: Skeleton,
	positions: Float64Array,
	indices: Uint32Array,
	options: SkinOptions,
): SkinWeights {
	const nv = positions.length / 3;
	const partBone = partBones(field, skeleton);
	const unions = field.parts.filter((p) => p.op === "union");
	const falloff = unions.map(
		(p) => p.part.falloff ?? Math.max(p.k, options.minFalloff),
	);
	const lists: number[][] = new Array(nv);
	const fixed = new Uint8Array(nv);

	const share = (list: number[], p: PreparedPart, at: Vec3, w: number) => {
		const bs = partBone[p.index] as Bone[];
		if (bs.length === 1) {
			accumulate(list, (bs[0] as Bone).joint, w);
			return;
		}
		// Inverse fourth power of the distance to each bone: smooth, and near-exclusive close to a bone.
		const ws = bs.map((b) => 1 / (segmentDistance(at, b.a, b.b) ** 4 + 1e-6));
		const sum = ws.reduce((s, v) => s + v, 0);
		for (let i = 0; i < bs.length; i++)
			accumulate(list, (bs[i] as Bone).joint, (w * (ws[i] as number)) / sum);
	};

	for (let v = 0; v < nv; v++) {
		const at: Vec3 = [
			positions[v * 3] as number,
			positions[v * 3 + 1] as number,
			positions[v * 3 + 2] as number,
		];
		field.distance(at[0], at[1], at[2]);
		const owner = field.parts[field.owner] as PreparedPart;
		const list: number[] = [];
		if (owner.part.rigid) {
			share(list, owner, at, 1);
			fixed[v] = 1;
			lists[v] = list;
			continue;
		}
		unions.forEach((p, i) => {
			if (p.part.rigid && p !== owner) return;
			const f = falloff[i] as number;
			const bound =
				Math.hypot(
					at[0] - p.center[0],
					at[1] - p.center[1],
					at[2] - p.center[2],
				) - p.radius;
			if (bound > f) return;
			const e = p.distance(at[0], at[1], at[2]);
			if (e >= f) return;
			const t = e <= 0 ? 1 : 1 - e / f;
			share(list, p, at, t * t * (3 - 2 * t));
		});
		if (!list.length) share(list, owner, at, 1);
		lists[v] = list;
	}

	smooth(lists, fixed, indices, options.smoothing ?? 2);

	const joints = new Uint16Array(nv * 4);
	const weights = new Float32Array(nv * 4);
	for (let v = 0; v < nv; v++) {
		const list = lists[v] as number[];
		const pairs: [number, number][] = [];
		for (let i = 0; i < list.length; i += 2)
			pairs.push([list[i] as number, list[i + 1] as number]);
		pairs.sort((a, b) => b[1] - a[1]);
		const top = pairs.slice(0, 4);
		const sum = top.reduce((s, p) => s + p[1], 0) || 1;
		top.forEach(([j, w], i) => {
			joints[v * 4 + i] = j;
			weights[v * 4 + i] = w / sum;
		});
	}
	return { joints, weights };
}

/** Laplacian passes over the mesh's edges; rigid vertices stay fixed. */
function smooth(
	lists: number[][],
	fixed: Uint8Array,
	indices: Uint32Array,
	passes: number,
) {
	if (passes <= 0) return;
	const nv = lists.length;
	const adj: number[][] = Array.from({ length: nv }, () => []);
	for (let t = 0; t < indices.length; t += 3)
		for (let e = 0; e < 3; e++) {
			const a = indices[t + e] as number;
			const b = indices[t + ((e + 1) % 3)] as number;
			(adj[a] as number[]).push(b);
		}
	const normalize = (l: number[]) => {
		let s = 0;
		for (let i = 1; i < l.length; i += 2) s += l[i] as number;
		if (s > 0)
			for (let i = 1; i < l.length; i += 2) l[i] = (l[i] as number) / s;
	};
	for (const l of lists) normalize(l);
	for (let pass = 0; pass < passes; pass++) {
		const next: number[][] = new Array(nv);
		for (let v = 0; v < nv; v++) {
			const own = lists[v] as number[];
			const around = adj[v] as number[];
			if (fixed[v] || !around.length) {
				next[v] = own;
				continue;
			}
			const out: number[] = [];
			for (let i = 0; i < own.length; i += 2)
				accumulate(out, own[i] as number, 0.5 * (own[i + 1] as number));
			const w = 0.5 / around.length;
			for (const u of around) {
				const l = lists[u] as number[];
				for (let i = 0; i < l.length; i += 2)
					accumulate(out, l[i] as number, w * (l[i + 1] as number));
			}
			next[v] = out;
		}
		for (let v = 0; v < nv; v++) lists[v] = next[v] as number[];
	}
}
