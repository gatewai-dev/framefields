/**
 * Column-major 4x4 matrix mathematics for WebGPU 3D rendering and camera projections.
 * Memory layout matches WGSL `mat4x4<f32>`:
 * [ 0,  4,  8, 12 ]
 * [ 1,  5,  9, 13 ]
 * [ 2,  6, 10, 14 ]
 * [ 3,  7, 11, 15 ]
 */

import { type Vec3, Vector3Math } from "./vector3.js";

export type Mat4 = [
	number,
	number,
	number,
	number, // col 0
	number,
	number,
	number,
	number, // col 1
	number,
	number,
	number,
	number, // col 2
	number,
	number,
	number,
	number, // col 3
];

export const Matrix4Math = {
	identity(): Mat4 {
		return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	},

	copy(m: Mat4): Mat4 {
		return [...m] as Mat4;
	},

	multiply(a: Mat4, b: Mat4): Mat4 {
		const out = new Array(16) as Mat4;
		for (let row = 0; row < 4; row++) {
			for (let col = 0; col < 4; col++) {
				out[col * 4 + row] =
					a[0 * 4 + row] * b[col * 4 + 0] +
					a[1 * 4 + row] * b[col * 4 + 1] +
					a[2 * 4 + row] * b[col * 4 + 2] +
					a[3 * 4 + row] * b[col * 4 + 3];
			}
		}
		return out;
	},

	translate(tx: number, ty: number, tz = 0): Mat4 {
		return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
	},

	scale(sx: number, sy: number, sz = 1): Mat4 {
		return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
	},

	rotateX(rad: number): Mat4 {
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
	},

	rotateY(rad: number): Mat4 {
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
	},

	rotateZ(rad: number): Mat4 {
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	},

	rotateAxis(axis: Vec3, rad: number): Mat4 {
		const norm = Vector3Math.normalize(axis);
		const x = norm[0];
		const y = norm[1];
		const z = norm[2];
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		const t = 1 - c;

		return [
			t * x * x + c,
			t * x * y + s * z,
			t * x * z - s * y,
			0,
			t * x * y - s * z,
			t * y * y + c,
			t * y * z + s * x,
			0,
			t * x * z + s * y,
			t * y * z - s * x,
			t * z * z + c,
			0,
			0,
			0,
			0,
			1,
		];
	},

	/**
	 * Computes LookAt view matrix from camera eye, target, and up vector.
	 */
	lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, -1, 0]): Mat4 {
		let f = Vector3Math.subtract(target, eye);
		if (Vector3Math.lengthSq(f) === 0) {
			f = [0, 0, 1];
		} else {
			f = Vector3Math.normalize(f);
		}

		let r = Vector3Math.cross(f, up);
		if (Vector3Math.lengthSq(r) === 0) {
			r = [1, 0, 0];
		} else {
			r = Vector3Math.normalize(r);
		}

		const u = Vector3Math.cross(r, f);

		return [
			r[0],
			u[0],
			f[0],
			0,
			r[1],
			u[1],
			f[1],
			0,
			r[2],
			u[2],
			f[2],
			0,
			-Vector3Math.dot(r, eye),
			-Vector3Math.dot(u, eye),
			-Vector3Math.dot(f, eye),
			1,
		];
	},

	/**
	 * Perspective projection matrix for WebGPU NDC depth range [0, 1].
	 * @param fovYRad Vertical field of view in radians.
	 * @param aspect Width / Height aspect ratio.
	 * @param near Near clipping plane (e.g. 1.0).
	 * @param far Far clipping plane (e.g. 10000.0).
	 */
	perspective(fovYRad: number, aspect: number, near: number, far: number): Mat4 {
		const f = 1.0 / Math.tan(fovYRad / 2.0);
		const rangeInv = 1.0 / (far - near);

		return [
			f / aspect,
			0,
			0,
			0,
			0,
			f,
			0,
			0,
			0,
			0,
			far * rangeInv,
			1, // W_clip = Z_eye
			0,
			0,
			-near * far * rangeInv,
			0,
		];
	},

	/**
	 * Orthographic projection matrix for WebGPU NDC depth range [0, 1].
	 */
	orthographic(
		left: number,
		right: number,
		bottom: number,
		top: number,
		near: number,
		far: number,
	): Mat4 {
		const lr = 1.0 / (right - left);
		const bt = 1.0 / (top - bottom);
		const nf = 1.0 / (far - near);

		return [
			2 * lr,
			0,
			0,
			0,
			0,
			2 * bt,
			0,
			0,
			0,
			0,
			nf,
			0,
			-(right + left) * lr,
			-(top + bottom) * bt,
			-near * nf,
			1,
		];
	},

	/**
	 * Inverts a 4x4 matrix using standard Cramer's rule. Returns null if singular.
	 */
	invert(m: Mat4): Mat4 | null {
		const inv = new Array(16) as Mat4;

		inv[0] =
			m[5] * m[10] * m[15] -
			m[5] * m[11] * m[14] -
			m[9] * m[6] * m[15] +
			m[9] * m[7] * m[14] +
			m[13] * m[6] * m[11] -
			m[13] * m[7] * m[10];

		inv[4] =
			-m[4] * m[10] * m[15] +
			m[4] * m[11] * m[14] +
			m[8] * m[6] * m[15] -
			m[8] * m[7] * m[14] -
			m[12] * m[6] * m[11] +
			m[12] * m[7] * m[10];

		inv[8] =
			m[4] * m[9] * m[15] -
			m[4] * m[11] * m[13] -
			m[8] * m[5] * m[15] +
			m[8] * m[7] * m[13] +
			m[12] * m[5] * m[11] -
			m[12] * m[7] * m[9];

		inv[12] =
			-m[4] * m[9] * m[14] +
			m[4] * m[10] * m[13] +
			m[8] * m[5] * m[14] -
			m[8] * m[6] * m[13] -
			m[12] * m[5] * m[10] +
			m[12] * m[6] * m[9];

		inv[1] =
			-m[1] * m[10] * m[15] +
			m[1] * m[11] * m[14] +
			m[9] * m[2] * m[15] -
			m[9] * m[3] * m[14] -
			m[13] * m[2] * m[11] +
			m[13] * m[3] * m[10];

		inv[5] =
			m[0] * m[10] * m[15] -
			m[0] * m[11] * m[14] -
			m[8] * m[2] * m[15] +
			m[8] * m[3] * m[14] +
			m[12] * m[2] * m[11] -
			m[12] * m[3] * m[10];

		inv[9] =
			-m[0] * m[9] * m[15] +
			m[0] * m[11] * m[13] +
			m[8] * m[1] * m[15] -
			m[8] * m[3] * m[13] -
			m[12] * m[1] * m[11] +
			m[12] * m[3] * m[9];

		inv[13] =
			m[0] * m[9] * m[14] -
			m[0] * m[10] * m[13] -
			m[8] * m[1] * m[14] +
			m[8] * m[2] * m[13] +
			m[12] * m[1] * m[10] -
			m[12] * m[2] * m[9];

		inv[2] =
			m[1] * m[6] * m[15] -
			m[1] * m[7] * m[14] -
			m[5] * m[2] * m[15] +
			m[5] * m[3] * m[14] +
			m[13] * m[2] * m[7] -
			m[13] * m[3] * m[6];

		inv[6] =
			-m[0] * m[6] * m[15] +
			m[0] * m[7] * m[14] +
			m[4] * m[2] * m[15] -
			m[4] * m[3] * m[14] -
			m[12] * m[2] * m[7] +
			m[12] * m[3] * m[6];

		inv[10] =
			m[0] * m[5] * m[15] -
			m[0] * m[7] * m[13] -
			m[4] * m[1] * m[15] +
			m[4] * m[3] * m[13] +
			m[12] * m[1] * m[7] -
			m[12] * m[3] * m[5];

		inv[14] =
			-m[0] * m[5] * m[14] +
			m[0] * m[6] * m[13] +
			m[4] * m[1] * m[14] -
			m[4] * m[2] * m[13] -
			m[12] * m[1] * m[6] +
			m[12] * m[2] * m[5];

		inv[3] =
			-m[1] * m[6] * m[11] +
			m[1] * m[7] * m[10] +
			m[5] * m[2] * m[11] -
			m[5] * m[3] * m[10] -
			m[9] * m[2] * m[7] +
			m[9] * m[3] * m[6];

		inv[7] =
			m[0] * m[6] * m[11] -
			m[0] * m[7] * m[10] -
			m[4] * m[2] * m[11] +
			m[4] * m[3] * m[10] +
			m[8] * m[2] * m[7] -
			m[8] * m[3] * m[6];

		inv[11] =
			-m[0] * m[5] * m[11] +
			m[0] * m[7] * m[9] +
			m[4] * m[1] * m[11] -
			m[4] * m[3] * m[9] -
			m[8] * m[1] * m[7] +
			m[8] * m[3] * m[5];

		inv[15] =
			m[0] * m[5] * m[10] -
			m[0] * m[6] * m[9] -
			m[4] * m[1] * m[10] +
			m[4] * m[2] * m[9] +
			m[8] * m[1] * m[6] -
			m[8] * m[2] * m[5];

		let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
		if (Math.abs(det) < 1e-12) {
			return null;
		}

		det = 1.0 / det;
		for (let i = 0; i < 16; i++) {
			inv[i] *= det;
		}

		return inv;
	},

	transpose(m: Mat4): Mat4 {
		return [
			m[0],
			m[4],
			m[8],
			m[12],
			m[1],
			m[5],
			m[9],
			m[13],
			m[2],
			m[6],
			m[10],
			m[14],
			m[3],
			m[7],
			m[11],
			m[15],
		];
	},

	/**
	 * Projects a 3D point through a 4x4 matrix with perspective division.
	 */
	projectPoint(m: Mat4, p: Vec3): Vec3 {
		const x = p[0];
		const y = p[1];
		const z = p[2];

		const X = m[0] * x + m[4] * y + m[8] * z + m[12];
		const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
		const Z = m[2] * x + m[6] * y + m[10] * z + m[14];
		const W = m[3] * x + m[7] * y + m[11] * z + m[15];

		const wInv = Math.abs(W) > 1e-6 ? 1.0 / W : 1.0;
		return [X * wInv, Y * wInv, Z * wInv];
	},

	/**
	 * Projects a 2D rectangle (0,0, w, h) through a 4x4 matrix into 4 3D points.
	 */
	projectRectangle(
		m: Mat4,
		width: number,
		height: number,
	): [Vec3, Vec3, Vec3, Vec3] {
		return [
			Matrix4Math.projectPoint(m, [0, 0, 0]),
			Matrix4Math.projectPoint(m, [width, 0, 0]),
			Matrix4Math.projectPoint(m, [width, height, 0]),
			Matrix4Math.projectPoint(m, [0, height, 0]),
		];
	},

	toFloat32Array(m: Mat4): Float32Array {
		return new Float32Array(m);
	},
};
