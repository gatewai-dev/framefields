/**
 * Layer3D.scatter and wind for the compositor: where scattered instances
 * stand (computed once per scatter, then reused every frame) and the wind
 * a mesh sways in at a given frame.
 */
import type {
	Scatter3DSpec,
	WindConfig,
} from "@framefields/compositions/program";
import {
	getPrimitiveGeometry,
	type Mat4,
	Matrix4Math,
	type MeshWind,
	type Model3DData,
	type PrimitiveGeometryOptions,
	type Quat,
	rotateByQuat,
	scatterOnSurface,
	seatOnSurface,
} from "@framefields/webgpu-renderers";

/** The static node fields a scatter surface is placed by. */
export interface SurfaceNodeSpec {
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	scale?: number;
	scaleX?: number;
	scaleY?: number;
	scaleZ?: number;
	modelData?: unknown;
	primitive3d?: unknown;
	src?: string;
	modelFormat?: string;
	center?: boolean;
	normalizeSize?: number;
}

/** T · Rz · Ry · Rx · S: the transform the compositor draws a model with. */
export function nodeMatrix(n: SurfaceNodeSpec): Mat4 {
	const rad = Math.PI / 180;
	const s = n.scale ?? 1;
	let m = Matrix4Math.translate(n.x ?? 0, n.y ?? 0, n.z ?? 0);
	if (n.rotateZ)
		m = Matrix4Math.multiply(m, Matrix4Math.rotateZ(n.rotateZ * rad));
	if (n.rotateY)
		m = Matrix4Math.multiply(m, Matrix4Math.rotateY(n.rotateY * rad));
	if (n.rotateX)
		m = Matrix4Math.multiply(m, Matrix4Math.rotateX(n.rotateX * rad));
	return Matrix4Math.multiply(
		m,
		Matrix4Math.scale(
			s * (n.scaleX ?? 1),
			s * (n.scaleY ?? 1),
			s * (n.scaleZ ?? 1),
		),
	);
}

const isModel = (v: unknown): v is Model3DData =>
	typeof v === "object" && v !== null && "meshes" in v;

/** The surface's mesh: in memory, rebuilt from its primitive spec, or loaded. */
export async function surfaceModel(
	n: SurfaceNodeSpec,
	load: (src: string, n: SurfaceNodeSpec) => Promise<Model3DData | undefined>,
): Promise<Model3DData | undefined> {
	if (isModel(n.modelData)) return n.modelData;
	if (n.primitive3d)
		return getPrimitiveGeometry(n.primitive3d as PrimitiveGeometryOptions);
	if (n.src) return load(n.src, n);
	return undefined;
}

export interface ScatterTransform {
	x: number;
	y: number;
	z: number;
	rotation: [number, number, number, number];
	scale: number;
}

/**
 * A mesh variant's own node rotation and uniform scale, applied under each
 * instance's (a y-up glTF passed as `Layer.glb(src, { rotateX: 180 })`
 * stands up in a crowd or scatter as it would on its own).
 */
export interface VariantPre {
	q: Quat;
	s: number;
}

export const NO_PRE: VariantPre = { q: [0, 0, 0, 1], s: 1 };

export function composeQuat(a: Quat, b: Quat): Quat {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

/** The variant's lowest point after its own rotation and scale: the largest y (up is -y). */
export function variantBottom(model: Model3DData, pre: VariantPre): number {
	const b = model.bounds;
	if (!b) return 0;
	let bottom = Number.NEGATIVE_INFINITY;
	for (let k = 0; k < 8; k++) {
		const corner: [number, number, number] = [
			k & 1 ? b.max[0] : b.min[0],
			k & 2 ? b.max[1] : b.min[1],
			k & 4 ? b.max[2] : b.min[2],
		];
		bottom = Math.max(bottom, rotateByQuat(pre.q, corner)[1] * pre.s);
	}
	return bottom;
}

const cache = new WeakMap<object, { key: string; out: ScatterTransform[] }>();

/**
 * Instance transforms for a scatter: points on the surface, each seated on
 * its variant's base (instance i draws variant i % bottoms.length; bottoms
 * already include the variant's own rotation and scale).
 */
export function scatterTransforms(
	scatter: Scatter3DSpec,
	surface: Model3DData,
	bottoms: number[],
): ScatterTransform[] {
	const surfaceNode = scatter.surface as SurfaceNodeSpec;
	const key = JSON.stringify([bottoms, surface.bounds?.size]);
	const hit = cache.get(scatter);
	if (hit && hit.key === key) return hit.out;
	const { points } = scatterOnSurface(
		{ model: surface, matrix: nodeMatrix(surfaceNode) },
		scatter,
	);
	const n = Math.max(1, bottoms.length);
	const out = points.map((p, i) => {
		const [x, y, z] = seatOnSurface(p, bottoms[i % n] ?? 0, scatter.sink ?? 0);
		return { x, y, z, rotation: p.rotation, scale: p.scale };
	});
	cache.set(scatter, { key, out });
	return out;
}

/** The wind a mesh of `model` sways in at `seconds`, or undefined when calm. */
export function meshWind(
	wind: WindConfig | undefined,
	model: Model3DData,
	seconds: number,
): MeshWind | undefined {
	if (!wind) return undefined;
	const b = model.bounds;
	const height = b ? b.size[1] : 0;
	if (!b || height <= 0) return undefined;
	return {
		amplitudeDeg: wind.amplitudeDeg ?? 8,
		frequency: wind.frequency ?? 0.4,
		direction: wind.direction ?? [1, 0],
		waveScale: wind.waveScale ?? 600,
		time: seconds,
		baseY: b.max[1],
		height,
	};
}
