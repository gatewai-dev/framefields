/**
 * Cube-map cameras: a scene is drawn as six 90° faces around the eye, then
 * remapped into any lens, including ones no single perspective frustum can
 * hold (a full panorama, a fisheye past 180°, a relativistic observer).
 *
 * The engine's view matrix (`lookAt`) is right-handed while cube sampling is
 * left-handed, so every lookup direction goes through `CUBE_FLIP`, a
 * reflection of z. With it, the face drawn by `cubeFaceCameras()[i]` is exactly
 * what WebGPU returns for layer `i` of a cube texture.
 */

import type { Camera3DPose } from "./camera3d.js";
import { Matrix4Math } from "./matrix4.js";
import { type Vec3, Vector3Math } from "./vector3.js";

/** The picture a cube camera's lens draws. */
export type LensProjection = "perspective" | "equirectangular" | "fisheye";

/** The six faces in WebGPU layer order (+X, −X, +Y, −Y, +Z, −Z), in cube space. */
const CUBE_FACES: readonly { major: Vec3; s: Vec3; t: Vec3 }[] = [
	{ major: [1, 0, 0], s: [0, 0, -1], t: [0, -1, 0] },
	{ major: [-1, 0, 0], s: [0, 0, 1], t: [0, -1, 0] },
	{ major: [0, 1, 0], s: [1, 0, 0], t: [0, 0, 1] },
	{ major: [0, -1, 0], s: [1, 0, 0], t: [0, 0, -1] },
	{ major: [0, 0, 1], s: [1, 0, 0], t: [0, -1, 0] },
	{ major: [0, 0, -1], s: [-1, 0, 0], t: [0, -1, 0] },
];

/** World direction ↔ cube-space direction (a reflection, its own inverse). */
export const CUBE_FLIP = (v: Vec3): Vec3 => [v[0], v[1], -v[2]];

/**
 * The six cameras that draw a cube map around `eye`: 90° square frusta in
 * layer order. Their faces meet edge to edge, so the cube covers every
 * direction once.
 */
export function cubeFaceCameras(
	eye: Vec3,
	near: number,
	far: number,
): Camera3DPose[] {
	return CUBE_FACES.map(({ major, t }) => ({
		eye: [...eye] as Vec3,
		target: Vector3Math.add(eye, CUBE_FLIP(major)),
		up: CUBE_FLIP([-t[0], -t[1], -t[2]]),
		fov: 90,
		aspect: 1,
		near,
		far,
		zoom: 1,
	}));
}

/**
 * Where WebGPU samples a cube for world direction `dir`: the layer and its
 * (u, v), v down. The selection rule of the WebGPU (Vulkan) spec.
 */
export function cubeTexel(dir: Vec3): { face: number; u: number; v: number } {
	const c = CUBE_FLIP(dir);
	const ax = Math.abs(c[0]);
	const ay = Math.abs(c[1]);
	const az = Math.abs(c[2]);
	const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
	const face = axis * 2 + (c[axis] >= 0 ? 0 : 1);
	const { s, t } = CUBE_FACES[face];
	const ma = Math.abs(c[axis]);
	const sc = Vector3Math.dot(s, c);
	const tc = Vector3Math.dot(t, c);
	return { face, u: (sc / ma + 1) / 2, v: (tc / ma + 1) / 2 };
}

/** A camera's orthonormal frame: screen right, screen up and forward. */
export function cameraBasis(camera: Camera3DPose): {
	right: Vec3;
	up: Vec3;
	forward: Vec3;
} {
	const view = Matrix4Math.lookAt(camera.eye, camera.target, camera.up);
	return {
		right: [view[0], view[4], view[8]],
		up: [view[1], view[5], view[9]],
		forward: [view[2], view[6], view[10]],
	};
}

/** What a lens needs to turn an output pixel into a ray. */
export interface CubeLensOptions {
	projection: LensProjection;
	/**
	 * Perspective: vertical field of view. Fisheye: the full angle across the
	 * frame's height (equidistant, up to 360°). Ignored by equirectangular,
	 * which always shows the whole sphere.
	 */
	fov: number;
	/** Optical zoom (perspective and fisheye). */
	zoom: number;
}

/** Output pixels per radian at the centre of the view. */
export function lensCenterDensity(
	lens: CubeLensOptions,
	width: number,
	height: number,
): number {
	const half = (lens.fov * Math.PI) / 360;
	switch (lens.projection) {
		case "perspective":
			return ((height / 2) * lens.zoom) / Math.tan(half);
		case "fisheye":
			return ((height / 2) * lens.zoom) / half;
		case "equirectangular":
			return width / (2 * Math.PI);
	}
}

/**
 * Face size that matches the lens's pixel density at the centre of the view:
 * a face holds `size / 2` pixels per radian at its centre. Rounded up to a
 * power of two (so a moving lens reuses its targets) and clamped.
 */
export function defaultCubeFaceSize(
	lens: CubeLensOptions,
	width: number,
	height: number,
	maxSize: number,
): number {
	const wanted = 2 * lensCenterDensity(lens, width, height);
	const pow2 = 2 ** Math.ceil(Math.log2(Math.max(1, wanted)));
	return Math.min(maxSize, Math.max(64, pow2));
}
