/**
 * 3D Vector mathematics for camera kinematics, scene projections, and spatial transforms.
 * Fully typed, pure functional routines with zero runtime allocations where possible.
 */

export type Vec3 = [number, number, number];

export const Vector3Math = {
	create(x = 0, y = 0, z = 0): Vec3 {
		return [x, y, z];
	},

	copy(v: Vec3): Vec3 {
		return [v[0], v[1], v[2]];
	},

	set(out: Vec3, x: number, y: number, z: number): Vec3 {
		out[0] = x;
		out[1] = y;
		out[2] = z;
		return out;
	},

	add(a: Vec3, b: Vec3): Vec3 {
		return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
	},

	subtract(a: Vec3, b: Vec3): Vec3 {
		return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	},

	multiplyScalar(v: Vec3, s: number): Vec3 {
		return [v[0] * s, v[1] * s, v[2] * s];
	},

	dot(a: Vec3, b: Vec3): number {
		return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	},

	cross(a: Vec3, b: Vec3): Vec3 {
		return [
			a[1] * b[2] - a[2] * b[1],
			a[2] * b[0] - a[0] * b[2],
			a[0] * b[1] - a[1] * b[0],
		];
	},

	lengthSq(v: Vec3): number {
		return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
	},

	length(v: Vec3): number {
		return Math.hypot(v[0], v[1], v[2]);
	},

	distance(a: Vec3, b: Vec3): number {
		return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
	},

	normalize(v: Vec3): Vec3 {
		const len = Math.hypot(v[0], v[1], v[2]);
		if (len === 0) return [0, 0, 0];
		const inv = 1 / len;
		return [v[0] * inv, v[1] * inv, v[2] * inv];
	},

	lerp(a: Vec3, b: Vec3, t: number): Vec3 {
		return [
			a[0] + (b[0] - a[0]) * t,
			a[1] + (b[1] - a[1]) * t,
			a[2] + (b[2] - a[2]) * t,
		];
	},

	equals(a: Vec3, b: Vec3, epsilon = 1e-6): boolean {
		return (
			Math.abs(a[0] - b[0]) <= epsilon &&
			Math.abs(a[1] - b[1]) <= epsilon &&
			Math.abs(a[2] - b[2]) <= epsilon
		);
	},
};
