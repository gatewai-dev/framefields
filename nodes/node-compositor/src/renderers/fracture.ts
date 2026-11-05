/**
 * Voronoi destruction in the compositor: a model node with `fracture3d`
 * draws its fractured twin (one joint per piece) posed from the physics
 * track; without a track the pieces rest in place and it looks whole.
 */
import type { Fracture3DSpec } from "@framefields/compositions/program";
import {
	fractureModel,
	type Mat4,
	Matrix4Math,
	type Model3DData,
	trsMatrix,
	type Vec3,
} from "@framefields/webgpu-renderers";

/**
 * Whether the pieces are all still where they started at `frame` (or there
 * is no track): the layer looks whole, and its cut faces, hidden inside,
 * need not draw (where pieces meet, a cut face can tie the surface's depth).
 */
export function fractureWhole(
	model: Model3DData,
	spec: Fracture3DSpec,
	frame: number,
): boolean {
	const track = spec.track;
	const stride = (model.nodes?.length ?? 0) * 7;
	if (!track?.length || !stride) return true;
	const frames = Math.floor(track.length / stride);
	const at = Math.min(Math.max(Math.ceil(frame), 0), frames - 1) * stride;
	for (let i = 0; i < stride; i++) if (track[at + i] !== track[i]) return false;
	return true;
}

/** The fractured model for a node's source model (cached per model and spec). */
export function fracturedModel(
	model: Model3DData,
	spec: Fracture3DSpec,
): Model3DData {
	return fractureModel(model, spec).model;
}

type Quat = [number, number, number, number];

function poseAt(track: number[], at: number): { p: Vec3; q: Quat } {
	return {
		p: [track[at]!, track[at + 1]!, track[at + 2]!],
		q: [track[at + 3]!, track[at + 4]!, track[at + 5]!, track[at + 6]!],
	};
}

function blend(
	a: { p: Vec3; q: Quat },
	b: { p: Vec3; q: Quat },
	t: number,
): { p: Vec3; q: Quat } {
	if (t <= 0) return a;
	const sign = a.q.reduce((s, v, i) => s + v * b.q[i]!, 0) < 0 ? -1 : 1;
	const q = a.q.map((v, i) => v + (b.q[i]! * sign - v) * t) as Quat;
	const len = Math.hypot(...q) || 1;
	return {
		p: a.p.map((v, i) => v + (b.p[i]! - v) * t) as Vec3,
		q: q.map((v) => v / len) as Quat,
	};
}

/**
 * Model-space matrices of the pieces' nodes at `frame`. The track is in the
 * layer's parent space (physics reads the layer's own x/y/z, as for any
 * body), and `layerProps` is the layer's matrix in that space, L. A piece
 * at pose (p, q) has node matrix L⁻¹ · T(p) · R(q) · S, so with its inverse
 * bind T(−centroid) a vertex lands at parent · (p + q · S · (v − centroid)):
 * pieces fly in their group, like other bodies. Undefined without a track.
 */
export function fracturePose(
	model: Model3DData,
	spec: Fracture3DSpec,
	frame: number,
	layerProps: Mat4,
	scale: Vec3,
): Mat4[] | undefined {
	const track = spec.track;
	const pieces = model.nodes?.length ?? 0;
	const stride = pieces * 7;
	if (!track?.length || !stride || track.length % stride !== 0)
		return undefined;
	const frames = track.length / stride;
	const f = Math.min(Math.max(frame, 0), frames - 1);
	const f0 = Math.floor(f);
	const f1 = Math.min(frames - 1, f0 + 1);
	const toModel = Matrix4Math.invert(layerProps) ?? Matrix4Math.identity();
	const out: Mat4[] = [];
	for (let i = 0; i < pieces; i++) {
		const { p, q } = blend(
			poseAt(track, f0 * stride + i * 7),
			poseAt(track, f1 * stride + i * 7),
			f - f0,
		);
		out.push(Matrix4Math.multiply(toModel, trsMatrix(p, q, scale)));
	}
	return out;
}
