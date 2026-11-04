/**
 * Fits a shadow-casting light's view-projection around the scene: tight on
 * the casters (so the map's texels go where shadows are), deep enough to
 * cover every receiver (a floor far bigger than the casters still darkens).
 */
import { type Mat4, Matrix4Math } from "../math3d/matrix4.js";
import { type Vec3, Vector3Math } from "../math3d/vector3.js";

export interface Aabb {
	min: Vec3;
	max: Vec3;
}

export interface ShadowLight {
	type: "directional" | "spot" | "rect";
	/** World position (spot / rect); directional lights only use `direction`. */
	position: Vec3;
	/** Unit direction the light travels. */
	direction: Vec3;
	/** Spot cone half-angle in degrees (for rect lights, defaults to 65). */
	angle?: number;
	/** Maximum range of the light (world px). */
	radius?: number;
}

export interface ShadowFrustum {
	viewProj: Mat4;
	/** World px covered by one shadow-map texel (at the casters, for spots). */
	texelWorldSize: number;
}

export interface PointShadowFrusta {
	/** 6 viewProj matrices in order: +X, -X, +Y, -Y, +Z, -Z. */
	viewProjs: [Mat4, Mat4, Mat4, Mat4, Mat4, Mat4];
	near: number;
	far: number;
	texelWorldSize: number;
}

export function aabbCorners(box: Aabb): Vec3[] {
	const { min, max } = box;
	return [
		[min[0], min[1], min[2]],
		[max[0], min[1], min[2]],
		[min[0], max[1], min[2]],
		[max[0], max[1], min[2]],
		[min[0], min[1], max[2]],
		[max[0], min[1], max[2]],
		[min[0], max[1], max[2]],
		[max[0], max[1], max[2]],
	];
}

/** World-space bounds of a local box under a column-major model matrix. */
export function transformAabb(box: Aabb, m: ArrayLike<number>): Aabb {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const [x, y, z] of aabbCorners(box)) {
		const w = [
			m[0] * x + m[4] * y + m[8] * z + m[12],
			m[1] * x + m[5] * y + m[9] * z + m[13],
			m[2] * x + m[6] * y + m[10] * z + m[14],
		];
		for (let i = 0; i < 3; i++) {
			if (w[i] < min[i]) min[i] = w[i];
			if (w[i] > max[i]) max[i] = w[i];
		}
	}
	return { min, max };
}

function transformPoint(m: Mat4, p: Vec3): Vec3 {
	return [
		m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
		m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
		m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
	];
}

/** An up vector not parallel to `dir` (world y points down). */
function upFor(dir: Vec3): Vec3 {
	return Math.abs(dir[1]) > 0.98 ? [0, 0, 1] : [0, -1, 0];
}

export function fitShadowFrustum(
	light: ShadowLight,
	casters: Aabb[],
	receivers: Aabb[],
	mapSize: number,
): ShadowFrustum | null {
	if (casters.length === 0) return null;
	const dir = Vector3Math.normalize(light.direction);
	const casterPts = casters.flatMap(aabbCorners);
	const allPts = [...casterPts, ...receivers.flatMap(aabbCorners)];

	if (light.type === "directional") {
		const center: Vec3 = [0, 0, 0];
		for (const p of casterPts) {
			center[0] += p[0] / casterPts.length;
			center[1] += p[1] / casterPts.length;
			center[2] += p[2] / casterPts.length;
		}
		const eye = Vector3Math.subtract(
			center,
			Vector3Math.multiplyScalar(dir, 1),
		);
		const view = Matrix4Math.lookAt(eye, center, upFor(dir));
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const p of casterPts) {
			const v = transformPoint(view, p);
			minX = Math.min(minX, v[0]);
			maxX = Math.max(maxX, v[0]);
			minY = Math.min(minY, v[1]);
			maxY = Math.max(maxY, v[1]);
		}
		let minZ = Infinity;
		let maxZ = -Infinity;
		for (const p of allPts) {
			const z = transformPoint(view, p)[2];
			minZ = Math.min(minZ, z);
			maxZ = Math.max(maxZ, z);
		}
		// Room for blurred edges, and square texels.
		const half = Math.max(maxX - minX, maxY - minY) * 0.5 * 1.08 + 4;
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		const depthPad = Math.max(10, (maxZ - minZ) * 0.02);
		const proj = Matrix4Math.orthographic(
			cx - half,
			cx + half,
			cy - half,
			cy + half,
			minZ - depthPad,
			maxZ + depthPad,
		);
		return {
			viewProj: Matrix4Math.multiply(proj, view),
			texelWorldSize: (2 * half) / mapSize,
		};
	}

	const eye = light.position;
	const view = Matrix4Math.lookAt(eye, Vector3Math.add(eye, dir), upFor(dir));
	let casterNear = Infinity;
	let casterDist = 0;
	for (const p of casterPts) {
		const z = transformPoint(view, p)[2];
		if (z > 0) {
			casterNear = Math.min(casterNear, z);
			casterDist = Math.max(casterDist, z);
		}
	}
	let far = casterDist;
	for (const p of allPts) {
		const z = transformPoint(view, p)[2];
		if (z > 0) {
			far = Math.max(far, z);
		}
	}
	if (!Number.isFinite(casterNear) || far <= 0) return null;
	const near = Math.max(2, casterNear * 0.85);
	const volumetricReach = Math.min(light.radius ?? 2600, casterDist * 2.5);
	far = Math.max(far * 1.05 + 1, volumetricReach);
	const defaultAngle = light.type === "rect" ? 65 : 45;
	const fovRad =
		(Math.min(170, 2 * (light.angle ?? defaultAngle) + 4) * Math.PI) / 180;
	const proj = Matrix4Math.perspective(fovRad, 1, near, far);
	return {
		viewProj: Matrix4Math.multiply(proj, view),
		texelWorldSize:
			(2 * Math.tan(fovRad / 2) * Math.max(casterDist, near)) / mapSize,
	};
}

const POINT_CUBE_FACES: ReadonlyArray<{ dir: Vec3; up: Vec3 }> = [
	{ dir: [1, 0, 0], up: [0, -1, 0] }, // 0: +X
	{ dir: [-1, 0, 0], up: [0, -1, 0] }, // 1: -X
	{ dir: [0, 1, 0], up: [0, 0, 1] }, // 2: +Y
	{ dir: [0, -1, 0], up: [0, 0, -1] }, // 3: -Y
	{ dir: [0, 0, 1], up: [0, -1, 0] }, // 4: +Z
	{ dir: [0, 0, -1], up: [0, -1, 0] }, // 5: -Z
];

/**
 * Builds the 6-face 90-degree perspective frusta (+X, -X, +Y, -Y, +Z, -Z) for
 * an omnidirectional shadow-casting point light.
 */
export function fitPointShadowFrusta(
	position: Vec3,
	radius: number,
	casters: Aabb[],
	receivers: Aabb[],
	mapSize: number,
): PointShadowFrusta | null {
	if (casters.length === 0) return null;
	const casterPts = casters.flatMap(aabbCorners);
	const allPts = [...casterPts, ...receivers.flatMap(aabbCorners)];

	let minDist = Infinity;
	let maxDist = 0;
	let maxCasterDist = 0;
	for (const p of allPts) {
		const dx = p[0] - position[0];
		const dy = p[1] - position[1];
		const dz = p[2] - position[2];
		const dist = Math.hypot(dx, dy, dz);
		const maxAxis = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
		if (maxAxis > 1e-3) {
			minDist = Math.min(minDist, maxAxis);
		}
		maxDist = Math.max(maxDist, dist);
	}
	for (const p of casterPts) {
		const dx = p[0] - position[0];
		const dy = p[1] - position[1];
		const dz = p[2] - position[2];
		maxCasterDist = Math.max(maxCasterDist, Math.hypot(dx, dy, dz));
	}
	if (maxDist <= 0) return null;
	const near = Math.max(
		2,
		Math.min(25, Number.isFinite(minDist) ? minDist * 0.5 : 8),
	);
	const far = Math.max(
		near + 10,
		Math.min(Math.max(radius, 100), maxDist * 1.08 + 10),
	);
	const proj = Matrix4Math.perspective(Math.PI / 2, 1, near, far);
	const viewProjs = POINT_CUBE_FACES.map(({ dir, up }) => {
		const view = Matrix4Math.lookAt(
			position,
			Vector3Math.add(position, dir),
			up,
		);
		return Matrix4Math.multiply(proj, view);
	}) as [Mat4, Mat4, Mat4, Mat4, Mat4, Mat4];

	return {
		viewProjs,
		near,
		far,
		texelWorldSize: (2 * Math.max(maxCasterDist, near)) / mapSize,
	};
}
