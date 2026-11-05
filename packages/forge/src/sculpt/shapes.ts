/**
 * Signed distance functions for sculpting characters, in a part's local
 * frame (glTF axes: +y up). Segment shapes (capsule, round cone, tube) run
 * between points, so a limb is written from joint to joint. Most follow
 * Inigo Quilez's exact distances; the ellipsoid is his close bound.
 */
import type { Vec3 } from "../skeleton.js";

export type Shape =
	| { shape: "sphere"; radius: number }
	/** Semi-axes along x, y, z. */
	| { shape: "ellipsoid"; radii: Vec3 }
	/** Full size; `radius` rounds the edges. */
	| { shape: "box"; size: Vec3; radius?: number }
	/** Along y, centered. */
	| { shape: "cylinder"; radius: number; height: number }
	| { shape: "capsule"; from: Vec3; to: Vec3; radius: number }
	/** A capsule whose radius changes from `from` to `to`: limbs, horns, fingers. */
	| { shape: "roundCone"; from: Vec3; to: Vec3; radii: [number, number] }
	/**
	 * A smooth tube through `points` (Catmull-Rom), radius per point or one
	 * for all: tails, braids, ribbons, cords.
	 */
	| { shape: "tube"; points: Vec3[]; radius: number | number[] }
	/** In the xz plane, around y. */
	| { shape: "torus"; radius: number; tube: number }
	/**
	 * A closed outline in the (radius, y) half-plane revolved around y:
	 * vases, helmets, pauldrons, buttons.
	 */
	| { shape: "lathe"; profile: [number, number][] };

/** A prepared shape: its distance function and a bounding sphere in the local frame. */
export interface ShapeField {
	distance(x: number, y: number, z: number): number;
	center: Vec3;
	radius: number;
}

const dot = (ax: number, ay: number, az: number, b: Vec3) =>
	ax * b[0] + ay * b[1] + az * b[2];

function segment(from: Vec3, to: Vec3, radius: number): ShapeField {
	const ba: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
	const len2 = dot(ba[0], ba[1], ba[2], ba) || 1e-12;
	return {
		distance(x, y, z) {
			const px = x - from[0];
			const py = y - from[1];
			const pz = z - from[2];
			const h = Math.min(1, Math.max(0, dot(px, py, pz, ba) / len2));
			return (
				Math.hypot(px - ba[0] * h, py - ba[1] * h, pz - ba[2] * h) - radius
			);
		},
		center: mid(from, to),
		radius: Math.sqrt(len2) / 2 + radius,
	};
}

const mid = (a: Vec3, b: Vec3): Vec3 => [
	(a[0] + b[0]) / 2,
	(a[1] + b[1]) / 2,
	(a[2] + b[2]) / 2,
];

/** Quilez's exact round cone between two spheres. */
function roundCone(a: Vec3, b: Vec3, r1: number, r2: number): ShapeField {
	const ba: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const l2 = dot(ba[0], ba[1], ba[2], ba);
	if (l2 < 1e-12) {
		const r = Math.max(r1, r2);
		return {
			distance: (x, y, z) => Math.hypot(x - a[0], y - a[1], z - a[2]) - r,
			center: a,
			radius: r,
		};
	}
	const rr = r1 - r2;
	const a2 = l2 - rr * rr;
	const il2 = 1 / l2;
	return {
		distance(x, y, z) {
			const pax = x - a[0];
			const pay = y - a[1];
			const paz = z - a[2];
			const yv = dot(pax, pay, paz, ba);
			const zv = yv - l2;
			const qx = pax * l2 - ba[0] * yv;
			const qy = pay * l2 - ba[1] * yv;
			const qz = paz * l2 - ba[2] * yv;
			const x2 = qx * qx + qy * qy + qz * qz;
			const y2 = yv * yv * l2;
			const z2 = zv * zv * l2;
			const k = Math.sign(rr) * rr * rr * x2;
			if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
			if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
			return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
		},
		center: mid(a, b),
		radius: Math.sqrt(l2) / 2 + Math.max(r1, r2),
	};
}

/** Catmull-Rom samples through `points`, with radii interpolated alongside. */
function tubeSamples(points: Vec3[], radius: number | number[]) {
	const radii = points.map((_, i) =>
		typeof radius === "number"
			? radius
			: (radius[i] ?? radius[radius.length - 1] ?? 1),
	);
	if (points.length < 2) throw new Error("tube: needs at least two points");
	const out: { p: Vec3; r: number }[] = [];
	const steps = 6;
	const at = (i: number) =>
		points[Math.min(points.length - 1, Math.max(0, i))] as Vec3;
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = at(i - 1);
		const p1 = at(i);
		const p2 = at(i + 1);
		const p3 = at(i + 2);
		for (let s = 0; s < steps; s++) {
			const t = s / steps;
			const t2 = t * t;
			const t3 = t2 * t;
			const c = (k: 0 | 1 | 2) =>
				0.5 *
				(2 * p1[k] +
					(-p0[k] + p2[k]) * t +
					(2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
					(-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
			const r =
				(radii[i] as number) +
				((radii[i + 1] as number) - (radii[i] as number)) * t;
			out.push({ p: [c(0), c(1), c(2)], r });
		}
	}
	out.push({ p: at(points.length - 1), r: radii[radii.length - 1] as number });
	return out;
}

function tube(points: Vec3[], radius: number | number[]): ShapeField {
	const samples = tubeSamples(points, radius);
	const cones: ShapeField[] = [];
	for (let i = 0; i + 1 < samples.length; i++) {
		const a = samples[i] as { p: Vec3; r: number };
		const b = samples[i + 1] as { p: Vec3; r: number };
		cones.push(roundCone(a.p, b.p, a.r, b.r));
	}
	const center = mid(points[0] as Vec3, points[points.length - 1] as Vec3);
	let radiusBound = 0;
	for (const s of samples)
		radiusBound = Math.max(
			radiusBound,
			Math.hypot(s.p[0] - center[0], s.p[1] - center[1], s.p[2] - center[2]) +
				s.r,
		);
	return {
		distance(x, y, z) {
			let d = Number.POSITIVE_INFINITY;
			for (const c of cones) {
				// A cone can't be nearer than its bounding sphere allows.
				const lb =
					Math.hypot(x - c.center[0], y - c.center[1], z - c.center[2]) -
					c.radius;
				if (lb >= d) continue;
				const e = c.distance(x, y, z);
				if (e < d) d = e;
			}
			return d;
		},
		center,
		radius: radiusBound,
	};
}

/** Signed distance to a closed polygon in 2D (Quilez). */
function polygon2d(v: [number, number][], px: number, py: number): number {
	const first = v[0] as [number, number];
	let d = (px - first[0]) ** 2 + (py - first[1]) ** 2;
	let s = 1;
	for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
		const vi = v[i] as [number, number];
		const vj = v[j] as [number, number];
		const ex = vj[0] - vi[0];
		const ey = vj[1] - vi[1];
		const wx = px - vi[0];
		const wy = py - vi[1];
		const h = Math.min(
			1,
			Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1e-12)),
		);
		const bx = wx - ex * h;
		const by = wy - ey * h;
		d = Math.min(d, bx * bx + by * by);
		const c1 = py >= vi[1];
		const c2 = py < vj[1];
		const c3 = ex * wy > ey * wx;
		if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
	}
	return s * Math.sqrt(d);
}

/** The shape's distance field and bounds in its local frame. */
export function shapeField(s: Shape): ShapeField {
	switch (s.shape) {
		case "sphere":
			return {
				distance: (x, y, z) => Math.hypot(x, y, z) - s.radius,
				center: [0, 0, 0],
				radius: s.radius,
			};
		case "ellipsoid": {
			const [a, b, c] = s.radii;
			return {
				distance(x, y, z) {
					const k0 = Math.hypot(x / a, y / b, z / c);
					const k1 = Math.hypot(x / (a * a), y / (b * b), z / (c * c));
					return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b, c);
				},
				center: [0, 0, 0],
				radius: Math.max(a, b, c),
			};
		}
		case "box": {
			const r = Math.max(0, s.radius ?? 0);
			const [hx, hy, hz] = [
				s.size[0] / 2 - r,
				s.size[1] / 2 - r,
				s.size[2] / 2 - r,
			];
			return {
				distance(x, y, z) {
					const qx = Math.abs(x) - hx;
					const qy = Math.abs(y) - hy;
					const qz = Math.abs(z) - hz;
					return (
						Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
						Math.min(Math.max(qx, qy, qz), 0) -
						r
					);
				},
				center: [0, 0, 0],
				radius: Math.hypot(s.size[0], s.size[1], s.size[2]) / 2,
			};
		}
		case "cylinder":
			return {
				distance(x, y, z) {
					const dr = Math.hypot(x, z) - s.radius;
					const dy = Math.abs(y) - s.height / 2;
					return (
						Math.min(Math.max(dr, dy), 0) +
						Math.hypot(Math.max(dr, 0), Math.max(dy, 0))
					);
				},
				center: [0, 0, 0],
				radius: Math.hypot(s.radius, s.height / 2),
			};
		case "capsule":
			return segment(s.from, s.to, s.radius);
		case "roundCone":
			return roundCone(s.from, s.to, s.radii[0], s.radii[1]);
		case "tube":
			return tube(s.points, s.radius);
		case "torus":
			return {
				distance: (x, y, z) =>
					Math.hypot(Math.hypot(x, z) - s.radius, y) - s.tube,
				center: [0, 0, 0],
				radius: s.radius + s.tube,
			};
		case "lathe": {
			if (s.profile.length < 3)
				throw new Error("lathe: profile needs three points");
			let radius = 0;
			for (const [r, y] of s.profile)
				radius = Math.max(radius, Math.hypot(r, y));
			return {
				distance: (x, y, z) => polygon2d(s.profile, Math.hypot(x, z), y),
				center: [0, 0, 0],
				radius,
			};
		}
	}
}
