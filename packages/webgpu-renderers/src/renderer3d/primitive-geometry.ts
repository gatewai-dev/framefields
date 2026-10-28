import type { Material3D, Mesh3DData, Model3DData } from "../loaders/types.js";
import { parseHexOrRgbColor } from "./text-extruder.js";

/**
 * Procedural solids built as real meshes (one draw call each), centered on
 * the origin in the 3D world's convention: x right, y down, z away from a
 * default camera. "Top" is therefore -y.
 */
interface PrimitiveSurface {
	/** Diffuse color (hex or rgb()). Default white, so a node `color` tints it. */
	color?: string;
	material?: "lit" | "unlit" | "toon";
	shininess?: number;
	roughness?: number;
	metallic?: number;
}

export interface RoundedBoxGeometryOptions extends PrimitiveSurface {
	type: "roundedBox";
	width: number;
	height: number;
	depth: number;
	/** Corner and edge radius, clamped to half the smallest side. Default 0 (a sharp box). */
	radius?: number;
	/** Segments per rounded quarter (default 4). */
	segments?: number;
	/**
	 * Scale of the top (-y) face against the bottom along x and z: 0.9 draws
	 * a keycap-like frustum. Default 1.
	 */
	taper?: number;
}

export interface SphereGeometryOptions extends PrimitiveSurface {
	type: "sphere";
	radius: number;
	/** Segments around the equator (default 32); rings are half of it. */
	segments?: number;
}

export interface CylinderGeometryOptions extends PrimitiveSurface {
	type: "cylinder";
	/** Radius of the top (-y) cap; defaults to `radius`. */
	radiusTop?: number;
	/** Radius of the bottom (+y) cap; defaults to `radius`. */
	radiusBottom?: number;
	radius?: number;
	height: number;
	/** Segments around (default 32). */
	segments?: number;
	/** Leave the caps off (a tube). */
	openEnded?: boolean;
}

export interface ShardGeometryOptions extends PrimitiveSurface {
	type: "shard";
	/** Approximate bounding radius (or half-extent if size is not set). Default 50. */
	radius?: number;
	/** Optional non-uniform half-extents [hx, hy, hz]; overrides radius per axis. */
	size?: [number, number, number];
	/** Number of clipping half-space planes carving the polyhedron (4..48). Default 14. */
	facets?: number;
	/** Deterministic PRNG seed for plane normals and depths. Default 1. */
	seed?: number;
	/** How unevenly planes cut toward the center, 0..0.85 (0 = regular polyhedron, 0.5 = jagged). Default 0.35. */
	irregularity?: number;
}

export type PrimitiveGeometryOptions =
	| RoundedBoxGeometryOptions
	| SphereGeometryOptions
	| CylinderGeometryOptions
	| ShardGeometryOptions;

class MeshBuilder {
	positions: number[] = [];
	normals: number[] = [];
	uvs: number[] = [];
	indices: number[] = [];

	vertex(p: number[], n: number[], uv: [number, number]): number {
		this.positions.push(p[0]!, p[1]!, p[2]!);
		this.normals.push(n[0]!, n[1]!, n[2]!);
		this.uvs.push(uv[0], uv[1]);
		return this.positions.length / 3 - 1;
	}

	/**
	 * Joins a (cols+1) x (rows+1) vertex grid that starts at `base` into
	 * quads. Front faces wind so that cross(row step, column step) points
	 * out; `flip` reverses that for grids laid out the other way round.
	 */
	grid(base: number, cols: number, rows: number, flip = false): void {
		for (let j = 0; j < rows; j++) {
			for (let i = 0; i < cols; i++) {
				const a = base + j * (cols + 1) + i;
				const b = a + 1;
				const c = a + cols + 1;
				const d = c + 1;
				if (flip) this.indices.push(a, b, c, b, d, c);
				else this.indices.push(a, c, b, b, c, d);
			}
		}
	}

	build(name: string): Mesh3DData {
		const count = this.positions.length / 3;
		return {
			id: `${name}-mesh`,
			name,
			positions: new Float32Array(this.positions),
			normals: new Float32Array(this.normals),
			uvs: new Float32Array(this.uvs),
			indices:
				count > 65535
					? new Uint32Array(this.indices)
					: new Uint16Array(this.indices),
			materialName: `${name}-material`,
		};
	}
}

function normalize(v: number[]): number[] {
	const len = Math.hypot(v[0]!, v[1]!, v[2]!);
	return len > 1e-12 ? [v[0]! / len, v[1]! / len, v[2]! / len] : [0, 0, 0];
}

/**
 * 1D samples across a side of half-extent `e` whose ends round off with
 * radius `r`: arc-spaced through each rounded zone, nothing in between, so
 * the flat middle of a face is a single quad.
 */
function edgeSamples(e: number, r: number, segments: number): number[] {
	if (r <= 0) return [-e, e];
	const inner = e - r;
	const out: number[] = [];
	for (let i = 0; i <= segments; i++) {
		out.push(-inner - r * Math.cos(((i / segments) * Math.PI) / 2));
	}
	for (let i = inner > 1e-9 ? 0 : 1; i <= segments; i++) {
		out.push(inner + r * Math.sin(((i / segments) * Math.PI) / 2));
	}
	return out;
}

function roundedBox(o: RoundedBoxGeometryOptions, mb: MeshBuilder): void {
	const hx = o.width / 2;
	const hy = o.height / 2;
	const hz = o.depth / 2;
	const r = Math.max(0, Math.min(o.radius ?? 0, hx, hy, hz));
	const seg = Math.max(1, Math.round(o.segments ?? 4));
	const taper = o.taper ?? 1;
	const ix = hx - r;
	const iy = hy - r;
	const iz = hz - r;
	const sx = edgeSamples(hx, r, seg);
	const sy = edgeSamples(hy, r, seg);
	const sz = edgeSamples(hz, r, seg);

	// Taper scales x and z linearly from 1 at the bottom (+y) to `taper` at
	// the top (-y); normals follow through the inverse transpose of that map.
	const slope = o.height > 0 ? (1 - taper) / o.height : 0;
	const scaleAt = (y: number) => taper + slope * (y + hy);
	const place = (surface: number[], faceNormal: number[]) => {
		const inner = [
			Math.max(-ix, Math.min(ix, surface[0]!)),
			Math.max(-iy, Math.min(iy, surface[1]!)),
			Math.max(-iz, Math.min(iz, surface[2]!)),
		];
		let n =
			r > 0
				? normalize([
						surface[0]! - inner[0]!,
						surface[1]! - inner[1]!,
						surface[2]! - inner[2]!,
					])
				: faceNormal;
		if (n[0] === 0 && n[1] === 0 && n[2] === 0) n = faceNormal;
		const p = [
			inner[0]! + n[0]! * r,
			inner[1]! + n[1]! * r,
			inner[2]! + n[2]! * r,
		];
		if (taper === 1) return { p, n };
		const s = scaleAt(p[1]!);
		return {
			p: [p[0]! * s, p[1]!, p[2]! * s],
			n: normalize([
				n[0]! / s,
				n[1]! - (p[0]! * slope * n[0]!) / s - (p[2]! * slope * n[2]!) / s,
				n[2]! / s,
			]),
		};
	};

	// Each face: a fixed axis at ±extent, and two in-plane axes with samples.
	const faces: Array<{
		axis: 0 | 1 | 2;
		sign: 1 | -1;
		u: 0 | 1 | 2;
		v: 0 | 1 | 2;
	}> = [
		{ axis: 2, sign: -1, u: 0, v: 1 }, // front (-z)
		{ axis: 2, sign: 1, u: 0, v: 1 }, // back (+z)
		{ axis: 0, sign: -1, u: 2, v: 1 }, // left
		{ axis: 0, sign: 1, u: 2, v: 1 }, // right
		{ axis: 1, sign: -1, u: 0, v: 2 }, // top (-y)
		{ axis: 1, sign: 1, u: 0, v: 2 }, // bottom
	];
	const half = [hx, hy, hz];
	const samples = [sx, sy, sz];
	for (const f of faces) {
		const us = samples[f.u]!;
		const vs = samples[f.v]!;
		const faceNormal = [0, 0, 0];
		faceNormal[f.axis] = f.sign;
		const base = mb.positions.length / 3;
		for (let j = 0; j < vs.length; j++) {
			for (let i = 0; i < us.length; i++) {
				const surface = [0, 0, 0];
				surface[f.axis] = f.sign * half[f.axis]!;
				surface[f.u] = us[i]!;
				surface[f.v] = vs[j]!;
				const { p, n } = place(surface, faceNormal);
				mb.vertex(p, n, [
					(us[i]! / half[f.u]! + 1) / 2,
					(vs[j]! / half[f.v]! + 1) / 2,
				]);
			}
		}
		// cross(v axis, u axis) is +axis when (v, u) runs x→y→z→x; outward
		// needs it along the face normal, so the other faces wind the other way.
		const cyclic = (f.v + 1) % 3 === f.u;
		mb.grid(base, us.length - 1, vs.length - 1, (cyclic ? 1 : -1) !== f.sign);
	}
}

function sphere(o: SphereGeometryOptions, mb: MeshBuilder): void {
	const seg = Math.max(3, Math.round(o.segments ?? 32));
	const rings = Math.max(2, Math.round(seg / 2));
	for (let j = 0; j <= rings; j++) {
		const phi = (j / rings) * Math.PI;
		for (let i = 0; i <= seg; i++) {
			const theta = (i / seg) * Math.PI * 2;
			const n = [
				Math.sin(phi) * Math.cos(theta),
				-Math.cos(phi),
				Math.sin(phi) * Math.sin(theta),
			];
			mb.vertex([n[0]! * o.radius, n[1]! * o.radius, n[2]! * o.radius], n, [
				i / seg,
				j / rings,
			]);
		}
	}
	mb.grid(0, seg, rings);
}

function cylinder(o: CylinderGeometryOptions, mb: MeshBuilder): void {
	const seg = Math.max(3, Math.round(o.segments ?? 32));
	const rTop = o.radiusTop ?? o.radius ?? 50;
	const rBottom = o.radiusBottom ?? o.radius ?? 50;
	const hy = o.height / 2;
	// Side normals lean by the cone's slope.
	const lean = o.height > 0 ? (rBottom - rTop) / o.height : 0;
	for (let j = 0; j <= 1; j++) {
		const rr = j === 0 ? rTop : rBottom;
		const y = j === 0 ? -hy : hy;
		for (let i = 0; i <= seg; i++) {
			const theta = (i / seg) * Math.PI * 2;
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			mb.vertex([c * rr, y, s * rr], normalize([c, -lean, s]), [i / seg, j]);
		}
	}
	mb.grid(0, seg, 1);
	if (o.openEnded) return;
	for (const [y, rr, ny] of [
		[-hy, rTop, -1],
		[hy, rBottom, 1],
	] as const) {
		if (rr <= 0) continue;
		const center = mb.vertex([0, y, 0], [0, ny, 0], [0.5, 0.5]);
		const ring = mb.positions.length / 3;
		for (let i = 0; i <= seg; i++) {
			const theta = (i / seg) * Math.PI * 2;
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			mb.vertex([c * rr, y, s * rr], [0, ny, 0], [(c + 1) / 2, (s + 1) / 2]);
		}
		for (let i = 0; i < seg; i++) {
			// Wound to face -y on the top cap; the bottom cap turns over.
			if (ny < 0) mb.indices.push(center, ring + i, ring + i + 1);
			else mb.indices.push(center, ring + i + 1, ring + i);
		}
	}
}

function shard(o: ShardGeometryOptions, mb: MeshBuilder): void {
	const r = o.radius ?? 50;
	const hx = (o.size ? o.size[0] : r) || 50;
	const hy = (o.size ? o.size[1] : r) || 50;
	const hz = (o.size ? o.size[2] : r) || 50;
	const maxR = Math.max(hx, hy, hz);
	const facets = Math.max(4, Math.min(64, Math.round(o.facets ?? 14)));
	const seed = Math.round(o.seed ?? 1) >>> 0;
	const irregularity = Math.max(0, Math.min(0.85, o.irregularity ?? 0.35));

	// Simple PCG random generator
	let state = BigInt(seed) * 6364136223846793005n + 1442695040888963407n;
	const rnd = (): number => {
		state = state * 6364136223846793005n + 1442695040888963407n;
		const xorshifted = Number(((state >> 18n) ^ state) >> 27n) >>> 0;
		const rot = Number(state >> 59n) >>> 0;
		const res = (xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31));
		return (res >>> 0) / 4294967296;
	};

	type V3 = [number, number, number];
	type Polygon = V3[];

	const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	const dot3 = (a: V3, b: V3): number =>
		a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const cross3 = (a: V3, b: V3): V3 => [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];

	// Start with bounding box of size [2*hx, 2*hy, 2*hz] as 6 rectangular faces
	// Each face is an array of CCW vertices facing outward
	let faces: Polygon[] = [
		[
			[-hx, -hy, -hz],
			[hx, -hy, -hz],
			[hx, hy, -hz],
			[-hx, hy, -hz],
		], // front (-z)
		[
			[hx, -hy, hz],
			[-hx, -hy, hz],
			[-hx, hy, hz],
			[hx, hy, hz],
		], // back (+z)
		[
			[-hx, -hy, hz],
			[-hx, -hy, -hz],
			[-hx, hy, -hz],
			[-hx, hy, hz],
		], // left (-x)
		[
			[hx, -hy, -hz],
			[hx, -hy, hz],
			[hx, hy, hz],
			[hx, hy, -hz],
		], // right (+x)
		[
			[-hx, -hy, hz],
			[hx, -hy, hz],
			[hx, -hy, -hz],
			[-hx, -hy, -hz],
		], // top (-y)
		[
			[-hx, hy, -hz],
			[hx, hy, -hz],
			[hx, hy, hz],
			[-hx, hy, hz],
		], // bottom (+y)
	];

	// Clip against `facets` random half-spaces: n · x <= d
	// Using Fibonacci sphere distribution + jitter
	const phi = (1 + Math.sqrt(5)) / 2;
	for (let i = 0; i < facets; i++) {
		const theta = (2 * Math.PI * i) / phi + (rnd() - 0.5) * 0.4;
		const zNorm = 1 - (2 * (i + 0.5)) / facets;
		const radiusAtZ = Math.sqrt(Math.max(0, 1 - zNorm * zNorm));
		let n: V3 = [
			Math.cos(theta) * radiusAtZ,
			Math.sin(theta) * radiusAtZ,
			zNorm,
		];
		// Jitter normal slightly
		n[0] += (rnd() - 0.5) * 0.2;
		n[1] += (rnd() - 0.5) * 0.2;
		n[2] += (rnd() - 0.5) * 0.2;
		const len = Math.hypot(n[0], n[1], n[2]);
		if (len < 1e-6) continue;
		n = [n[0] / len, n[1] / len, n[2] / len];

		// Scale distance according to bounding box dimensions
		const supportR = Math.hypot(n[0] * hx, n[1] * hy, n[2] * hz);
		const d = supportR * (1 - irregularity * (0.2 + 0.8 * rnd()));

		// Sutherland-Hodgman 3D convex clipping
		const nextFaces: Polygon[] = [];
		const capVertices: V3[] = [];

		for (const face of faces) {
			const clipped: V3[] = [];
			const numV = face.length;
			for (let j = 0; j < numV; j++) {
				const p1 = face[j]!;
				const p2 = face[(j + 1) % numV]!;
				const dist1 = dot3(n, p1) - d;
				const dist2 = dot3(n, p2) - d;

				if (dist1 <= 1e-5) {
					clipped.push(p1);
				}
				if (
					(dist1 > 1e-5 && dist2 < -1e-5) ||
					(dist1 < -1e-5 && dist2 > 1e-5)
				) {
					const t = dist1 / (dist1 - dist2);
					const intersection: V3 = [
						p1[0] + (p2[0] - p1[0]) * t,
						p1[1] + (p2[1] - p1[1]) * t,
						p1[2] + (p2[2] - p1[2]) * t,
					];
					clipped.push(intersection);
					capVertices.push(intersection);
				}
			}
			if (clipped.length >= 3) {
				nextFaces.push(clipped);
			}
		}

		if (capVertices.length >= 3) {
			// Cluster / deduplicate vertices close to each other
			const uniqueCap: V3[] = [];
			for (const pt of capVertices) {
				let duplicate = false;
				for (const u of uniqueCap) {
					if (Math.hypot(pt[0] - u[0], pt[1] - u[1], pt[2] - u[2]) < 1e-3) {
						duplicate = true;
						break;
					}
				}
				if (!duplicate) uniqueCap.push(pt);
			}

			if (uniqueCap.length >= 3) {
				// Compute center of cap
				let cx = 0;
				let cy = 0;
				let cz = 0;
				for (const u of uniqueCap) {
					cx += u[0];
					cy += u[1];
					cz += u[2];
				}
				const c: V3 = [
					cx / uniqueCap.length,
					cy / uniqueCap.length,
					cz / uniqueCap.length,
				];

				// Tangent vectors on cutting plane
				const up: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
				const tangentX = normalize(cross3(up, n)) as V3;
				const tangentY = cross3(n, tangentX);

				// Sort vertices CCW with respect to outward normal n
				uniqueCap.sort((vA, vB) => {
					const aA = Math.atan2(
						dot3(sub3(vA, c), tangentY),
						dot3(sub3(vA, c), tangentX),
					);
					const aB = Math.atan2(
						dot3(sub3(vB, c), tangentY),
						dot3(sub3(vB, c), tangentX),
					);
					return aA - aB;
				});

				nextFaces.push(uniqueCap);
			}
		}

		if (nextFaces.length >= 4) {
			faces = nextFaces;
		}
	}

	// Compute bounding box center
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const face of faces) {
		for (const pt of face) {
			if (pt[0] < minX) minX = pt[0];
			if (pt[0] > maxX) maxX = pt[0];
			if (pt[1] < minY) minY = pt[1];
			if (pt[1] > maxY) maxY = pt[1];
			if (pt[2] < minZ) minZ = pt[2];
			if (pt[2] > maxZ) maxZ = pt[2];
		}
	}
	const center: V3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];

	// Center faces on origin
	for (const face of faces) {
		for (let j = 0; j < face.length; j++) {
			const pt = face[j]!;
			face[j] = [pt[0] - center[0], pt[1] - center[1], pt[2] - center[2]];
		}
	}

	// Triangulate each face into MeshBuilder with flat-shaded face normals
	for (const face of faces) {
		if (face.length < 3) continue;

		// Compute true face normal
		let fn: V3 = [0, 0, 0];
		for (let j = 0; j < face.length; j++) {
			const curr = face[j]!;
			const next = face[(j + 1) % face.length]!;
			fn[0] += (curr[1] - next[1]) * (curr[2] + next[2]);
			fn[1] += (curr[2] - next[2]) * (curr[0] + next[0]);
			fn[2] += (curr[0] - next[0]) * (curr[1] + next[1]);
		}
		const fnLen = Math.hypot(fn[0], fn[1], fn[2]);
		if (fnLen < 1e-6) continue;
		fn = [fn[0] / fnLen, fn[1] / fnLen, fn[2] / fnLen];

		// Check winding with respect to center (origin)
		const faceCenter: V3 = [
			face.reduce((s, p) => s + p[0], 0) / face.length,
			face.reduce((s, p) => s + p[1], 0) / face.length,
			face.reduce((s, p) => s + p[2], 0) / face.length,
		];
		if (dot3(fn, faceCenter) < 0) {
			// Flip winding if normal pointed inward
			face.reverse();
			fn = [-fn[0], -fn[1], -fn[2]];
		}

		// Local face UV basis
		const up: V3 = Math.abs(fn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
		const tx = normalize(cross3(up, fn)) as V3;
		const ty = cross3(fn, tx);

		// Project face vertices to [0, 1] UVs
		const uvs: [number, number][] = face.map((pt) => [
			0.5 + dot3(pt, tx) / (2 * maxR),
			0.5 + dot3(pt, ty) / (2 * maxR),
		]);

		const baseIdx = mb.positions.length / 3;
		for (let j = 0; j < face.length; j++) {
			mb.vertex(face[j]!, fn, uvs[j]!);
		}

		// Fan triangulation
		for (let j = 1; j < face.length - 1; j++) {
			mb.indices.push(baseIdx, baseIdx + j, baseIdx + j + 1);
		}
	}
}

/** Builds a procedural solid as a single-mesh Model3DData. */
export function generatePrimitiveGeometry(
	options: PrimitiveGeometryOptions,
): Model3DData {
	const mb = new MeshBuilder();
	if (options.type === "roundedBox") roundedBox(options, mb);
	else if (options.type === "sphere") sphere(options, mb);
	else if (options.type === "cylinder") cylinder(options, mb);
	else if (options.type === "shard") shard(options, mb);
	else {
		throw new Error(
			`Unknown 3D primitive: ${(options as { type?: string }).type}`,
		);
	}

	const name = options.type;
	const mesh = mb.build(name);
	const material: Material3D = {
		name: `${name}-material`,
		diffuseColor: parseHexOrRgbColor(options.color ?? "#ffffff"),
		shading: options.material ?? "lit",
		shininess: options.shininess ?? 32,
		roughness: options.roughness,
		metallic: options.metallic,
	};

	const min: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	const pos = mesh.positions;
	for (let i = 0; i < pos.length; i += 3) {
		for (let k = 0; k < 3; k++) {
			const v = pos[i + k]!;
			if (v < min[k]!) min[k] = v;
			if (v > max[k]!) max[k] = v;
		}
	}
	const size: [number, number, number] = [
		max[0] - min[0],
		max[1] - min[1],
		max[2] - min[2],
	];
	return {
		name: `primitive-${name}`,
		meshes: [mesh],
		materials: { [material.name]: material },
		animations: [],
		bounds: {
			min,
			max,
			center: [
				(min[0] + max[0]) / 2,
				(min[1] + max[1]) / 2,
				(min[2] + max[2]) / 2,
			],
			size,
			boundingSphereRadius: Math.hypot(...size) / 2,
		},
	};
}

const primitiveCache = new Map<string, Model3DData>();

/**
 * Like generatePrimitiveGeometry, but identical options return the same
 * Model3DData, so a hundred equal keycaps upload one vertex buffer.
 */
export function getPrimitiveGeometry(
	options: PrimitiveGeometryOptions,
): Model3DData {
	const key = JSON.stringify(options);
	let model = primitiveCache.get(key);
	if (!model) {
		model = generatePrimitiveGeometry(options);
		if (primitiveCache.size > 512) primitiveCache.clear();
		primitiveCache.set(key, model);
	}
	return model;
}
