import type {
	DrawMesh3DOpts,
	GPUMeshBuffers,
	Mesh3DData,
} from "@framefields/webgpu-renderers";

export interface MeshDraw {
	kind: "mesh";
	mesh: Mesh3DData;
	texture?: GPUTexture;
	opts: DrawMesh3DOpts;
	meshBuffers?: GPUMeshBuffers;
}

const TRANSFORMS = new Set([
	"position",
	"rotation",
	"scale",
	"modelMatrix",
	"normalMatrix",
	"bounds",
]);

/** Compare material state without treating different GPU resources as equal. */
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return (
			a.length === b.length && a.every((value, i) => sameValue(value, b[i]))
		);
	}
	if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
	if (
		Object.getPrototypeOf(a) !== Object.prototype ||
		Object.getPrototypeOf(b) !== Object.prototype
	)
		return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	return (
		keys.length === Object.keys(right).length &&
		keys.every(
			(key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]),
		)
	);
}

export function canInstanceMesh(item: MeshDraw): boolean {
	const o = item.opts;
	return (
		!item.meshBuffers &&
		!o.transparent &&
		!o.instanceBuffer &&
		(o.instanceCount ?? 1) === 1 &&
		!o.firstInstance &&
		!o.matrixInstances &&
		!o.isSkinned &&
		!o.skinningMatrices &&
		!o.audioDeform &&
		!o.morphWeights?.length &&
		o.material !== "glass" &&
		o.material !== "acrylic" &&
		o.material !== "frosted" &&
		(o.opacity ?? 1) >= 1 &&
		(o.colorTint?.[3] ?? 1) >= 1
	);
}

export function compatibleMeshDraws(a: MeshDraw, b: MeshDraw): boolean {
	if (
		!canInstanceMesh(a) ||
		!canInstanceMesh(b) ||
		a.mesh !== b.mesh ||
		a.texture !== b.texture
	)
		return false;
	const left = a.opts as Record<string, unknown>;
	const right = b.opts as Record<string, unknown>;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (!TRANSFORMS.has(key) && !sameValue(left[key], right[key])) return false;
	}
	return true;
}
