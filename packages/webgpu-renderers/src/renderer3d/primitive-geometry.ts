import earcut from "earcut";
import type { Material3D, Mesh3DData, Model3DData } from "../loaders/types.js";
import { Path3D } from "../math3d/path3d.js";
import type { Vec3 } from "../math3d/vector3.js";
import { sampleSvgArc } from "../renderer2d/path-geometry.js";
import {
	type Contour,
	type CurveFlattening,
	computeContourSignedArea,
	organizeGlyphPolygons,
	type Point2D,
	parseHexOrRgbColor,
} from "./text-extruder.js";

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
	/** Leave the caps off (a thin open cylinder). */
	openEnded?: boolean;
	/** Render each lateral side as a flat-shaded facet instead of smooth-shaded (default false). */
	flatShaded?: boolean;
}

export interface TorusGeometryOptions extends PrimitiveSurface {
	type: "torus";
	/** Major radius from the torus center to the center of the tube (default 60). */
	radius?: number;
	/** Minor radius of the circular tube cross-section (default 20). */
	tube?: number;
	/** Segments around the tube cross-section (default 24). */
	radialSegments?: number;
	/** Segments around the main ring (default 48). */
	tubularSegments?: number;
	/** Central sweep angle in degrees (default 360). */
	arc?: number;
}

export interface CapsuleGeometryOptions extends PrimitiveSurface {
	type: "capsule";
	/** Radius of the cylinder body and hemispherical end caps (default 30). */
	radius?: number;
	/** Straight cylinder length between the hemisphere centers; total height is `length + 2 * radius` (default 60). */
	length?: number;
	/** Latitude rings per hemisphere cap (default 12). */
	capSegments?: number;
	/** Segments around the circumference (default 32). */
	radialSegments?: number;
}

export interface RingGeometryOptions extends PrimitiveSurface {
	type: "ring";
	/** Inner hole radius (default 30). */
	innerRadius?: number;
	/** Outer rim radius (default 60). */
	outerRadius?: number;
	/** Thick-walled depth along z (or y when `extrude` > 0); 0 or omitted builds a 2-sided flat annulus with front/back faces. */
	depth?: number;
	/** Segments around the ring (default 48). */
	thetaSegments?: number;
	/** Concentric radial subdivisions across the ring face (default 1). */
	phiSegments?: number;
	/** Start angle in degrees (default 0). */
	thetaStart?: number;
	/** Sweep angle in degrees (default 360). */
	thetaLength?: number;
}

export interface PolyhedronGeometryOptions extends PrimitiveSurface {
	type: "polyhedron";
	/** Base Platonic solid. Default "icosahedron". */
	shape?:
		| "tetrahedron"
		| "octahedron"
		| "dodecahedron"
		| "icosahedron"
		| "icosphere";
	/** Bounding sphere radius (default 50). */
	radius?: number;
	/** Geodesic subdivision levels (0..5): 0 keeps the base solid, >0 subdivides and projects onto the sphere. */
	detail?: number;
	/** Flat-shade each triangle facet (default true for polyhedra, false when `shape` is "icosphere" and `flatShaded` is omitted). */
	flatShaded?: boolean;
}

export interface ExtrudeShapeGeometryOptions extends PrimitiveSurface {
	type: "extrude";
	/** SVG path string (`M ... Z`, including holes/multiple subpaths) or one or more 2D point contours (`[x, y]` or `{x, y}`). */
	shape?:
		| string
		| Array<[number, number] | Point2D>
		| Array<Array<[number, number] | Point2D>>;
	/** Alias for `shape` when passing an SVG path string (`M ... Z`). */
	d?: string;
	/** Outer 2D contour (`[x, y]` or `{x, y}`) when not using `shape` or `d`. */
	contour?: Array<[number, number] | Point2D>;
	/** Optional inner hole contours (`[[x, y], ...][]`). */
	holes?: Array<Array<[number, number] | Point2D>>;
	/** Extrusion thickness along Z (default 20). */
	depth?: number;
	/** Optional bevel thickness along Z at front and back caps (default 0). */
	bevelThickness?: number;
	/** Optional bevel radial inset/outset in XY (default `bevelThickness`). */
	bevelSize?: number;
	/** Bevel steps (default 1 when bevelThickness > 0). */
	bevelSegments?: number;
	/** Color of the side walls and bevels; defaults to `color`. */
	bevelColor?: string;
	/** Fixed straight segments per curve. */
	curveSegments?: number;
	/** Max curve chord error in px (default 0.25). */
	curveTolerance?: number;
	/** Center the extruded 2D outline around (0, 0) in local XY (default true). */
	center?: boolean;
}

export interface LatheGeometryOptions extends PrimitiveSurface {
	type: "lathe";
	/**
	 * Profile curve in the XY plane revolved around the Y axis, as `[[r, y], ...]`
	 * (or `{x, y}`) or an SVG path string. `x` (radius >= 0) is distance from the Y axis.
	 */
	points: string | Array<[number, number] | Point2D>;
	/** Circumferential segments around the Y axis (default 32). */
	segments?: number;
	/** Start angle in degrees (default 0). */
	phiStart?: number;
	/** Sweep angle in degrees (default 360). */
	phiLength?: number;
	/** Cap the top and bottom openings when the profile starts/ends away from r = 0 (default false). */
	capped?: boolean;
	/** Alias for `capped`. */
	closed?: boolean;
	/** Flat-shade longitudinal segments (default false). */
	flatShaded?: boolean;
}

export type TubePathSpec =
	| {
			kind: "catmullRom";
			points: Vec3[];
			tension?: number;
			closed?: boolean;
			samplesPerSegment?: number;
	  }
	| {
			kind: "bezier";
			segments: Array<{ p0: Vec3; p1: Vec3; p2: Vec3; p3: Vec3 }>;
			samplesPerSegment?: number;
	  }
	| {
			kind: "helix";
			center?: Vec3;
			radius: number;
			pitch: number;
			turns: number;
			axis?: "x" | "y" | "z";
			samplesPerTurn?: number;
	  }
	| {
			kind: "circle";
			center?: Vec3;
			radius: number;
			startAngleDeg?: number;
			endAngleDeg?: number;
			samples?: number;
	  }
	| Vec3[];

export interface TubeGeometryOptions extends PrimitiveSurface {
	type: "tube";
	/** 3D path specification or array of 3D waypoints `[x, y, z]`. */
	path: TubePathSpec;
	/** Outer radius of the tube (default 12). */
	radius?: number;
	/** Optional inner radius for a thick-walled hollow pipe (0 = solid tube with end caps). */
	innerRadius?: number;
	/** Optional end-to-end radius taper `[radiusStart, radiusEnd]`. */
	radiusTaper?: [number, number];
	/** Segments along the 3D path (default 64). */
	tubularSegments?: number;
	/** Segments around the circular cross-section (default 16). */
	radialSegments?: number;
	/** Close the tube loop smoothly from end to start (default false). */
	closed?: boolean;
	/** Cap the ends when not closed (default true). */
	capped?: boolean;
}

export interface Line3DGeometryOptions extends PrimitiveSurface {
	type: "line3d";
	/** 3D polyline points `[x, y, z]` or a `TubePathSpec` curve. */
	points: TubePathSpec;
	/** Optional per-vertex CSS colors matching `points`. */
	colors?: string[];
	/** Connect consecutive points (`"strip"`, default) or pairs `(0,1), (2,3), ...` (`"segments"`). */
	mode?: "strip" | "segments";
	/** Close the polyline back to point 0 (default false). */
	closed?: boolean;
	/** Optional dash length in world px for dashed 3D diagram lines. */
	dashSize?: number;
	/** Gap length between dashes in world px (default `dashSize`). */
	gapSize?: number;
}

export interface Points3DGeometryOptions extends PrimitiveSurface {
	type: "points3d";
	/** 3D point coordinates `[x, y, z]` or a `TubePathSpec` curve. */
	points: TubePathSpec;
	/** Optional per-point CSS colors. */
	colors?: string[];
	/**
	 * Point radius in world px. When > 0 (default 0 = native GPU `point-list` pixels),
	 * each point is tessellated into a low-poly icosahedral dot of radius `pointSize`
	 * so diagram nodes have real 3D thickness and perspective size.
	 */
	pointSize?: number;
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
	| TorusGeometryOptions
	| CapsuleGeometryOptions
	| RingGeometryOptions
	| PolyhedronGeometryOptions
	| ExtrudeShapeGeometryOptions
	| LatheGeometryOptions
	| TubeGeometryOptions
	| Line3DGeometryOptions
	| Points3DGeometryOptions
	| ShardGeometryOptions;

class MeshBuilder {
	positions: number[] = [];
	normals: number[] = [];
	uvs: number[] = [];
	colors: number[] = [];
	indices: number[] = [];
	topology?: "triangle-list" | "line-list" | "point-list";

	vertex(
		p: number[],
		n: number[],
		uv: [number, number],
		color?: [number, number, number, number],
	): number {
		this.positions.push(p[0]!, p[1]!, p[2]!);
		this.normals.push(n[0]!, n[1]!, n[2]!);
		this.uvs.push(uv[0], uv[1]);
		if (color) {
			this.colors.push(color[0], color[1], color[2], color[3]);
		}
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
		const mesh: Mesh3DData = {
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
		if (this.topology) mesh.topology = this.topology;
		if (this.colors.length === count * 4 && this.colors.length > 0) {
			mesh.colors = new Float32Array(this.colors);
		}
		return mesh;
	}
}

type V3 = [number, number, number];

function normalize(v: number[]): V3 {
	const len = Math.hypot(v[0]!, v[1]!, v[2]!);
	return len > 1e-12 ? [v[0]! / len, v[1]! / len, v[2]! / len] : [0, 0, 0];
}

function sub3(a: V3, b: V3): V3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot3(a: V3, b: V3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: V3, b: V3): V3 {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
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
		let n: number[] =
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
	const rTop = Math.max(0, o.radiusTop ?? o.radius ?? 50);
	const rBottom = Math.max(0, o.radiusBottom ?? o.radius ?? 50);
	const hy = o.height / 2;

	if (o.flatShaded) {
		for (let i = 0; i < seg; i++) {
			const theta0 = (i / seg) * Math.PI * 2;
			const theta1 = ((i + 1) / seg) * Math.PI * 2;
			const c0 = Math.cos(theta0);
			const s0 = Math.sin(theta0);
			const c1 = Math.cos(theta1);
			const s1 = Math.sin(theta1);

			const t0: V3 = [c0 * rTop, -hy, s0 * rTop];
			const t1: V3 = [c1 * rTop, -hy, s1 * rTop];
			const b0: V3 = [c0 * rBottom, hy, s0 * rBottom];
			const b1: V3 = [c1 * rBottom, hy, s1 * rBottom];

			// Outward normal of the quad facet (or triangle when rTop === 0).
			const edgeV = sub3(b0, t0);
			const edgeU = rBottom >= rTop ? sub3(b1, b0) : sub3(t1, t0);
			const fn = normalize(cross3(edgeV, edgeU));

			const u0 = i / seg;
			const u1 = (i + 1) / seg;
			if (rTop <= 1e-6) {
				const apex = mb.vertex([0, -hy, 0], fn, [(u0 + u1) / 2, 0]);
				const vB0 = mb.vertex(b0, fn, [u0, 1]);
				const vB1 = mb.vertex(b1, fn, [u1, 1]);
				mb.indices.push(apex, vB0, vB1);
			} else if (rBottom <= 1e-6) {
				const vT0 = mb.vertex(t0, fn, [u0, 0]);
				const vT1 = mb.vertex(t1, fn, [u1, 0]);
				const apex = mb.vertex([0, hy, 0], fn, [(u0 + u1) / 2, 1]);
				mb.indices.push(vT0, apex, vT1);
			} else {
				const base = mb.vertex(t0, fn, [u0, 0]);
				mb.vertex(t1, fn, [u1, 0]);
				mb.vertex(b0, fn, [u0, 1]);
				mb.vertex(b1, fn, [u1, 1]);
				mb.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
			}
		}
	} else {
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
	}

	if (o.openEnded) return;
	for (const [y, rr, ny] of [
		[-hy, rTop, -1],
		[hy, rBottom, 1],
	] as const) {
		if (rr <= 1e-6) continue;
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

/**
 * Torus centered at origin lying in the XY plane (so its hole faces a default
 * camera looking along +Z), with major radius `radius` and tube radius `tube`.
 */
function torus(o: TorusGeometryOptions, mb: MeshBuilder): void {
	const R = Math.max(1e-3, o.radius ?? 60);
	const r = Math.max(1e-3, o.tube ?? 20);
	const radialSegments = Math.max(3, Math.round(o.radialSegments ?? 24));
	const tubularSegments = Math.max(3, Math.round(o.tubularSegments ?? 48));
	const arcDeg = o.arc ?? 360;
	const arcRad = (arcDeg * Math.PI) / 180;
	const base = mb.positions.length / 3;

	for (let j = 0; j <= radialSegments; j++) {
		const v = (j / radialSegments) * Math.PI * 2;
		const cv = Math.cos(v);
		const sv = Math.sin(v);
		for (let i = 0; i <= tubularSegments; i++) {
			const u = (i / tubularSegments) * arcRad;
			const cu = Math.cos(u);
			const su = Math.sin(u);
			const x = (R + r * cv) * cu;
			const y = (R + r * cv) * su;
			const z = r * sv;
			const nx = cv * cu;
			const ny = cv * su;
			const nz = sv;
			mb.vertex([x, y, z], normalize([nx, ny, nz]), [
				i / tubularSegments,
				j / radialSegments,
			]);
		}
	}
	// ∂p/∂v × ∂p/∂u points along (-cv cu, -cv su, -sv), so flip = true winds outward.
	mb.grid(base, tubularSegments, radialSegments, true);

	// Cap open ends when arc < 360°.
	if (Math.abs(arcRad) < Math.PI * 2 - 1e-4) {
		for (const [u, sign] of [
			[0, -1],
			[arcRad, 1],
		] as const) {
			const cu = Math.cos(u);
			const su = Math.sin(u);
			// Tangent at angle u is (-su, cu, 0); cap normal points in sign * tangent.
			const capN: V3 = [-su * sign, cu * sign, 0];
			const center = mb.vertex([R * cu, R * su, 0], capN, [0.5, 0.5]);
			const ring = mb.positions.length / 3;
			for (let j = 0; j <= radialSegments; j++) {
				const v = (j / radialSegments) * Math.PI * 2;
				const cv = Math.cos(v);
				const sv = Math.sin(v);
				mb.vertex([(R + r * cv) * cu, (R + r * cv) * su, r * sv], capN, [
					(cv + 1) / 2,
					(sv + 1) / 2,
				]);
			}
			for (let j = 0; j < radialSegments; j++) {
				// (p_j - center) × (p_{j+1} - center) points along (su, -cu, 0) = -tangent (sign < 0).
				if (sign < 0) mb.indices.push(center, ring + j, ring + j + 1);
				else mb.indices.push(center, ring + j + 1, ring + j);
			}
		}
	}
}

/**
 * Capsule aligned along the Y axis: a cylinder of height `length` and radius `radius`
 * capped by top (-y) and bottom (+y) hemispheres of radius `radius`.
 */
function capsule(o: CapsuleGeometryOptions, mb: MeshBuilder): void {
	const r = Math.max(1e-3, o.radius ?? 30);
	const length = Math.max(0, o.length ?? 60);
	const hy = length / 2;
	const capSeg = Math.max(2, Math.round(o.capSegments ?? 12));
	const radSeg = Math.max(3, Math.round(o.radialSegments ?? 32));

	// Build profile rings from top pole (y = -hy - r) down to bottom pole (y = +hy + r).
	const rings: Array<{
		y: number;
		rRing: number;
		ny: number;
		nr: number;
		v: number;
	}> = [];
	const totalArc = Math.PI * r + length;

	for (let j = 0; j <= capSeg; j++) {
		const phi = ((j / capSeg) * Math.PI) / 2; // 0 at top pole, pi/2 at top equator
		const s = Math.sin(phi);
		const c = Math.cos(phi);
		rings.push({
			y: -hy - r * c,
			rRing: r * s,
			ny: -c,
			nr: s,
			v: (phi * r) / (totalArc || 1),
		});
	}
	for (let j = 0; j <= capSeg; j++) {
		if (j === 0 && length <= 1e-6) continue;
		const phi = Math.PI / 2 + ((j / capSeg) * Math.PI) / 2; // pi/2 at bottom equator, pi at bottom pole
		const s = Math.sin(phi);
		const c = Math.cos(phi);
		rings.push({
			y: hy - r * c,
			rRing: r * s,
			ny: -c,
			nr: s,
			v:
				((Math.PI / 2) * r + length + (phi - Math.PI / 2) * r) /
				(totalArc || 1),
		});
	}

	const base = mb.positions.length / 3;
	for (const ring of rings) {
		for (let i = 0; i <= radSeg; i++) {
			const theta = (i / radSeg) * Math.PI * 2;
			const ct = Math.cos(theta);
			const st = Math.sin(theta);
			const n = normalize([ring.nr * ct, ring.ny, ring.nr * st]);
			mb.vertex([ring.rRing * ct, ring.y, ring.rRing * st], n, [
				i / radSeg,
				ring.v,
			]);
		}
	}
	mb.grid(base, radSeg, rings.length - 1, false);
}

/**
 * Flat or thick-walled annulus (ring) in the XY plane facing -Z (front) and +Z (back).
 * Always builds a closed two-sided or solid manifold so it works with single-sided culling.
 */
function ring(o: RingGeometryOptions, mb: MeshBuilder): void {
	const rInner = Math.max(0, o.innerRadius ?? 30);
	const rOuter = Math.max(rInner + 1e-3, o.outerRadius ?? 60);
	const hz = Math.max(0, o.depth ?? 0) / 2;
	const thetaSeg = Math.max(3, Math.round(o.thetaSegments ?? 48));
	const phiSeg = Math.max(1, Math.round(o.phiSegments ?? 1));
	const thetaStart = ((o.thetaStart ?? 0) * Math.PI) / 180;
	const thetaLength = ((o.thetaLength ?? 360) * Math.PI) / 180;

	// Front face (-z, normal [0, 0, -1]) and back face (+z, normal [0, 0, 1])
	for (const [z, nz, flip] of [
		[-hz, -1, false],
		[hz, 1, true],
	] as const) {
		const base = mb.positions.length / 3;
		for (let j = 0; j <= phiSeg; j++) {
			const radius = rInner + ((rOuter - rInner) * j) / phiSeg;
			for (let i = 0; i <= thetaSeg; i++) {
				const theta = thetaStart + (i / thetaSeg) * thetaLength;
				const c = Math.cos(theta);
				const s = Math.sin(theta);
				const x = radius * c;
				const y = radius * s;
				mb.vertex(
					[x, y, z],
					[0, 0, nz],
					[(x / rOuter + 1) / 2, (y / rOuter + 1) / 2],
				);
			}
		}
		// ∂p/∂j = (c, s, 0), ∂p/∂i = (-s, c, 0) -> ∂p/∂j × ∂p/∂i = (0, 0, +1).
		// So for front face (nz = -1) we need flip = true, for back face (nz = +1) flip = false.
		mb.grid(base, thetaSeg, phiSeg, !flip);
	}

	// If depth > 0, stitch outer rim, inner hole wall, and any open sector ends.
	if (hz > 0) {
		// Outer rim (outward normal [cos θ, sin θ, 0])
		const outerBase = mb.positions.length / 3;
		for (const [z, v] of [
			[-hz, 0],
			[hz, 1],
		] as const) {
			for (let i = 0; i <= thetaSeg; i++) {
				const theta = thetaStart + (i / thetaSeg) * thetaLength;
				const c = Math.cos(theta);
				const s = Math.sin(theta);
				mb.vertex([rOuter * c, rOuter * s, z], [c, s, 0], [i / thetaSeg, v]);
			}
		}
		mb.grid(outerBase, thetaSeg, 1, true);

		// Inner hole wall (outward normal [-cos θ, -sin θ, 0])
		if (rInner > 1e-6) {
			const innerBase = mb.positions.length / 3;
			for (const [z, v] of [
				[-hz, 0],
				[hz, 1],
			] as const) {
				for (let i = 0; i <= thetaSeg; i++) {
					const theta = thetaStart + (i / thetaSeg) * thetaLength;
					const c = Math.cos(theta);
					const s = Math.sin(theta);
					mb.vertex(
						[rInner * c, rInner * s, z],
						[-c, -s, 0],
						[i / thetaSeg, v],
					);
				}
			}
			mb.grid(innerBase, thetaSeg, 1, false);
		}

		// Sector end caps when thetaLength < 360°
		if (Math.abs(thetaLength) < Math.PI * 2 - 1e-4) {
			for (const [theta, sign] of [
				[thetaStart, -1],
				[thetaStart + thetaLength, 1],
			] as const) {
				const c = Math.cos(theta);
				const s = Math.sin(theta);
				const capN: V3 = [-s * sign, c * sign, 0];
				const p0 = mb.vertex([rInner * c, rInner * s, -hz], capN, [0, 0]);
				const p1 = mb.vertex([rOuter * c, rOuter * s, -hz], capN, [1, 0]);
				const p2 = mb.vertex([rInner * c, rInner * s, hz], capN, [0, 1]);
				const p3 = mb.vertex([rOuter * c, rOuter * s, hz], capN, [1, 1]);
				if (sign > 0) mb.indices.push(p0, p2, p1, p1, p2, p3);
				else mb.indices.push(p0, p1, p2, p1, p3, p2);
			}
		}
	}
}

/**
 * Platonic solids (tetrahedron, octahedron, dodecahedron, icosahedron) and
 * geodesic icosphere with configurable subdivision `detail`.
 */
function polyhedron(o: PolyhedronGeometryOptions, mb: MeshBuilder): void {
	const shape = o.shape ?? "icosahedron";
	const radius = Math.max(1e-3, o.radius ?? 50);
	const detail = Math.max(
		0,
		Math.min(5, Math.round(o.detail ?? (shape === "icosphere" ? 2 : 0))),
	);
	const flatShaded = o.flatShaded ?? shape !== "icosphere";

	let baseVerts: V3[] = [];
	let baseFaces: number[][] = [];

	if (shape === "tetrahedron") {
		baseVerts = [
			[1, 1, 1],
			[-1, -1, 1],
			[-1, 1, -1],
			[1, -1, -1],
		];
		baseFaces = [
			[2, 1, 0],
			[0, 3, 2],
			[1, 3, 0],
			[2, 3, 1],
		];
	} else if (shape === "octahedron") {
		baseVerts = [
			[1, 0, 0],
			[-1, 0, 0],
			[0, 1, 0],
			[0, -1, 0],
			[0, 0, 1],
			[0, 0, -1],
		];
		baseFaces = [
			[0, 2, 4],
			[0, 4, 3],
			[0, 3, 5],
			[0, 5, 2],
			[1, 2, 5],
			[1, 5, 3],
			[1, 3, 4],
			[1, 4, 2],
		];
	} else if (shape === "dodecahedron") {
		const t = (1 + Math.sqrt(5)) / 2;
		const r = 1 / t;
		baseVerts = [
			// (±1, ±1, ±1)
			[-1, -1, -1],
			[-1, -1, 1],
			[-1, 1, -1],
			[-1, 1, 1],
			[1, -1, -1],
			[1, -1, 1],
			[1, 1, -1],
			[1, 1, 1],
			// (0, ±1/φ, ±φ)
			[0, -r, -t],
			[0, -r, t],
			[0, r, -t],
			[0, r, t],
			// (±1/φ, ±φ, 0)
			[-r, -t, 0],
			[-r, t, 0],
			[r, -t, 0],
			[r, t, 0],
			// (±φ, 0, ±1/φ)
			[-t, 0, -r],
			[t, 0, -r],
			[-t, 0, r],
			[t, 0, r],
		];
		// 12 pentagonal faces (when detail === 0 and flatShaded, keep each pentagon planar!)
		const pentagons: number[][] = [
			[3, 11, 7, 15, 13],
			[7, 19, 17, 6, 15],
			[17, 4, 8, 10, 6],
			[8, 0, 16, 2, 10],
			[0, 12, 1, 18, 16],
			[6, 10, 2, 13, 15],
			[2, 16, 18, 3, 13],
			[18, 1, 9, 11, 3],
			[4, 14, 12, 0, 8],
			[11, 9, 5, 19, 7],
			[19, 5, 14, 4, 17],
			[1, 12, 14, 5, 9],
		];
		if (detail === 0 && flatShaded) {
			const unitVerts = baseVerts.map((v) => normalize(v));
			for (const pent of pentagons) {
				const pts = pent.map((idx) => unitVerts[idx]!);
				const center: V3 = [
					pts.reduce((s, p) => s + p[0], 0) / 5,
					pts.reduce((s, p) => s + p[1], 0) / 5,
					pts.reduce((s, p) => s + p[2], 0) / 5,
				];
				let fn = normalize(
					cross3(sub3(pts[1]!, pts[0]!), sub3(pts[2]!, pts[0]!)),
				);
				if (dot3(fn, center) < 0) {
					pts.reverse();
					fn = [-fn[0], -fn[1], -fn[2]];
				}
				const base = mb.positions.length / 3;
				for (const p of pts) {
					const u = 0.5 + Math.atan2(p[2], p[0]) / (2 * Math.PI);
					const v = Math.acos(Math.max(-1, Math.min(1, -p[1]))) / Math.PI;
					mb.vertex([p[0] * radius, p[1] * radius, p[2] * radius], fn, [u, v]);
				}
				for (let k = 1; k < pts.length - 1; k++) {
					mb.indices.push(base, base + k, base + k + 1);
				}
			}
			return;
		}
		for (const p of pentagons) {
			baseFaces.push(
				[p[0]!, p[1]!, p[2]!],
				[p[0]!, p[2]!, p[3]!],
				[p[0]!, p[3]!, p[4]!],
			);
		}
	} else {
		// icosahedron or icosphere
		const t = (1 + Math.sqrt(5)) / 2;
		baseVerts = [
			[-1, t, 0],
			[1, t, 0],
			[-1, -t, 0],
			[1, -t, 0],
			[0, -1, t],
			[0, 1, t],
			[0, -1, -t],
			[0, 1, -t],
			[t, 0, -1],
			[t, 0, 1],
			[-t, 0, -1],
			[-t, 0, 1],
		];
		baseFaces = [
			[0, 11, 5],
			[0, 5, 1],
			[0, 1, 7],
			[0, 7, 10],
			[0, 10, 11],
			[1, 5, 9],
			[5, 11, 4],
			[11, 10, 2],
			[10, 7, 6],
			[7, 1, 8],
			[3, 9, 4],
			[3, 4, 2],
			[3, 2, 6],
			[3, 6, 8],
			[3, 8, 9],
			[4, 9, 5],
			[2, 4, 11],
			[6, 2, 10],
			[8, 6, 7],
			[9, 8, 1],
		];
	}

	const verts: V3[] = baseVerts.map((v) => normalize(v));
	let tris: [number, number, number][] = baseFaces.map((f) => [
		f[0]!,
		f[1]!,
		f[2]!,
	]);

	// Subdivide each triangle into 4 per level and project onto unit sphere.
	for (let d = 0; d < detail; d++) {
		const midCache = new Map<string, number>();
		const midpoint = (a: number, b: number): number => {
			const key = a < b ? `${a}_${b}` : `${b}_${a}`;
			const existing = midCache.get(key);
			if (existing !== undefined) return existing;
			const va = verts[a]!;
			const vb = verts[b]!;
			const idx = verts.length;
			verts.push(normalize([va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]]));
			midCache.set(key, idx);
			return idx;
		};
		const nextTris: [number, number, number][] = [];
		for (const [i0, i1, i2] of tris) {
			const m01 = midpoint(i0, i1);
			const m12 = midpoint(i1, i2);
			const m20 = midpoint(i2, i0);
			nextTris.push(
				[i0, m01, m20],
				[i1, m12, m01],
				[i2, m20, m12],
				[m01, m12, m20],
			);
		}
		tris = nextTris;
	}

	const uvOf = (n: V3): [number, number] => [
		0.5 + Math.atan2(n[2], n[0]) / (2 * Math.PI),
		Math.acos(Math.max(-1, Math.min(1, -n[1]))) / Math.PI,
	];

	if (flatShaded) {
		for (const [i0, i1, i2] of tris) {
			const a = verts[i0]!;
			let b = verts[i1]!;
			let c = verts[i2]!;
			const centroid: V3 = [
				(a[0] + b[0] + c[0]) / 3,
				(a[1] + b[1] + c[1]) / 3,
				(a[2] + b[2] + c[2]) / 3,
			];
			let fn = normalize(cross3(sub3(b, a), sub3(c, a)));
			if (dot3(fn, centroid) < 0) {
				const tmp = b;
				b = c;
				c = tmp;
				fn = [-fn[0], -fn[1], -fn[2]];
			}
			const base = mb.positions.length / 3;
			mb.vertex([a[0] * radius, a[1] * radius, a[2] * radius], fn, uvOf(a));
			mb.vertex([b[0] * radius, b[1] * radius, b[2] * radius], fn, uvOf(b));
			mb.vertex([c[0] * radius, c[1] * radius, c[2] * radius], fn, uvOf(c));
			mb.indices.push(base, base + 1, base + 2);
		}
	} else {
		const base = mb.positions.length / 3;
		for (const n of verts) {
			mb.vertex([n[0] * radius, n[1] * radius, n[2] * radius], n, uvOf(n));
		}
		for (const [i0, i1, i2] of tris) {
			const a = verts[i0]!;
			const b = verts[i1]!;
			const c = verts[i2]!;
			const centroid: V3 = [
				(a[0] + b[0] + c[0]) / 3,
				(a[1] + b[1] + c[1]) / 3,
				(a[2] + b[2] + c[2]) / 3,
			];
			const fn = cross3(sub3(b, a), sub3(c, a));
			if (dot3(fn, centroid) < 0) {
				mb.indices.push(base + i0, base + i2, base + i1);
			} else {
				mb.indices.push(base + i0, base + i1, base + i2);
			}
		}
	}
}

/**
 * Parses an SVG path string (supporting M, L, H, V, C, S, Q, T, A, Z and multiple subpaths)
 * into closed 2D contours with adaptive or fixed curve flattening.
 */
function parseSvgPathToContours(
	d: string,
	flattening: CurveFlattening,
): Contour[] {
	const contours: Contour[] = [];
	if (!d || typeof d !== "string") return contours;

	const tokens: Array<string | number> = [];
	const regex = /([a-df-z])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
	let match: RegExpExecArray | null = regex.exec(d);
	while (match !== null) {
		if (match[1]) tokens.push(match[1]);
		else if (match[2]) tokens.push(Number.parseFloat(match[2]));
		match = regex.exec(d);
	}

	let cursor = 0;
	let current: Point2D = { x: 0, y: 0 };
	let subpathStart: Point2D = { x: 0, y: 0 };
	let lastCubicControl: Point2D | null = null;
	let lastQuadControl: Point2D | null = null;
	let contour: Contour = [];

	const finishContour = () => {
		if (contour.length >= 2) {
			const first = contour[0]!;
			const last = contour[contour.length - 1]!;
			if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-4) {
				contour.pop();
			}
			if (contour.length >= 2) {
				contours.push(contour);
			}
		}
		contour = [];
	};

	const segCount = (maxSecondDeriv: number): number => {
		if (flattening.segments !== undefined)
			return Math.max(1, flattening.segments);
		const n = Math.ceil(
			Math.sqrt(maxSecondDeriv / (8 * Math.max(1e-3, flattening.tolerance))),
		);
		return Math.min(64, Math.max(1, n));
	};

	const addQuad = (p0: Point2D, cp: Point2D, end: Point2D) => {
		const n = segCount(
			2 * Math.hypot(p0.x - 2 * cp.x + end.x, p0.y - 2 * cp.y + end.y),
		);
		for (let s = 1; s <= n; s++) {
			const t = s / n;
			const mt = 1 - t;
			contour.push({
				x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * end.x,
				y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * end.y,
			});
		}
	};

	const addCubic = (p0: Point2D, cp1: Point2D, cp2: Point2D, end: Point2D) => {
		const n = segCount(
			6 *
				Math.max(
					Math.hypot(p0.x - 2 * cp1.x + cp2.x, p0.y - 2 * cp1.y + cp2.y),
					Math.hypot(cp1.x - 2 * cp2.x + end.x, cp1.y - 2 * cp2.y + end.y),
				),
		);
		for (let s = 1; s <= n; s++) {
			const t = s / n;
			const mt = 1 - t;
			contour.push({
				x:
					mt * mt * mt * p0.x +
					3 * mt * mt * t * cp1.x +
					3 * mt * t * t * cp2.x +
					t * t * t * end.x,
				y:
					mt * mt * mt * p0.y +
					3 * mt * mt * t * cp1.y +
					3 * mt * t * t * cp2.y +
					t * t * t * end.y,
			});
		}
	};

	const getNum = (): number =>
		cursor < tokens.length && typeof tokens[cursor] === "number"
			? (tokens[cursor++] as number)
			: 0;

	while (cursor < tokens.length) {
		const cmdToken = tokens[cursor++];
		if (typeof cmdToken !== "string") continue;
		const isRel = cmdToken === cmdToken.toLowerCase();
		const upper = cmdToken.toUpperCase();

		switch (upper) {
			case "M": {
				finishContour();
				let first = true;
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x = getNum();
					let y = getNum();
					if (isRel) {
						x += current.x;
						y += current.y;
					}
					current = { x, y };
					if (first) {
						subpathStart = current;
						contour = [current];
						first = false;
					} else {
						contour.push(current);
					}
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "L": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x = getNum();
					let y = getNum();
					if (isRel) {
						x += current.x;
						y += current.y;
					}
					current = { x, y };
					contour.push(current);
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "H": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x = getNum();
					if (isRel) x += current.x;
					current = { x, y: current.y };
					contour.push(current);
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "V": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let y = getNum();
					if (isRel) y += current.y;
					current = { x: current.x, y };
					contour.push(current);
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "C": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x1 = getNum();
					let y1 = getNum();
					let x2 = getNum();
					let y2 = getNum();
					let x = getNum();
					let y = getNum();
					if (isRel) {
						x1 += current.x;
						y1 += current.y;
						x2 += current.x;
						y2 += current.y;
						x += current.x;
						y += current.y;
					}
					const cp1 = { x: x1, y: y1 };
					const cp2 = { x: x2, y: y2 };
					const end = { x, y };
					addCubic(current, cp1, cp2, end);
					current = end;
					lastCubicControl = cp2;
				}
				lastQuadControl = null;
				break;
			}
			case "S": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x2 = getNum();
					let y2 = getNum();
					let x = getNum();
					let y = getNum();
					if (isRel) {
						x2 += current.x;
						y2 += current.y;
						x += current.x;
						y += current.y;
					}
					const cp1: Point2D = lastCubicControl
						? {
								x: 2 * current.x - lastCubicControl.x,
								y: 2 * current.y - lastCubicControl.y,
							}
						: current;
					const cp2 = { x: x2, y: y2 };
					const end = { x, y };
					addCubic(current, cp1, cp2, end);
					current = end;
					lastCubicControl = cp2;
				}
				lastQuadControl = null;
				break;
			}
			case "Q": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x1 = getNum();
					let y1 = getNum();
					let x = getNum();
					let y = getNum();
					if (isRel) {
						x1 += current.x;
						y1 += current.y;
						x += current.x;
						y += current.y;
					}
					const cp = { x: x1, y: y1 };
					const end = { x, y };
					addQuad(current, cp, end);
					current = end;
					lastQuadControl = cp;
				}
				lastCubicControl = null;
				break;
			}
			case "T": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					let x = getNum();
					let y = getNum();
					if (isRel) {
						x += current.x;
						y += current.y;
					}
					const cp: Point2D = lastQuadControl
						? {
								x: 2 * current.x - lastQuadControl.x,
								y: 2 * current.y - lastQuadControl.y,
							}
						: current;
					const end = { x, y };
					addQuad(current, cp, end);
					current = end;
					lastQuadControl = cp;
				}
				lastCubicControl = null;
				break;
			}
			case "A": {
				while (cursor < tokens.length && typeof tokens[cursor] === "number") {
					const rx = getNum();
					const ry = getNum();
					const rot = getNum();
					const largeArc = getNum() !== 0;
					const sweep = getNum() !== 0;
					let x = getNum();
					let y = getNum();
					if (isRel) {
						x += current.x;
						y += current.y;
					}
					const end = { x, y };
					const segs = sampleSvgArc(current, rx, ry, rot, largeArc, sweep, end);
					for (const s of segs) {
						contour.push(s.p1);
					}
					current = end;
				}
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "Z": {
				finishContour();
				current = subpathStart;
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
		}
	}
	finishContour();
	return contours;
}

function toPoint2D(p: [number, number] | Point2D): Point2D {
	return Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y };
}

function normalizeContoursInput(
	o: Pick<ExtrudeShapeGeometryOptions, "shape" | "d" | "contour" | "holes">,
	flattening: CurveFlattening,
): Contour[] {
	const raw = o.shape ?? o.d ?? o.contour;
	let contours: Contour[] = [];
	if (typeof raw === "string") {
		contours = parseSvgPathToContours(raw, flattening).filter(
			(c) => c.length >= 3,
		);
	} else if (Array.isArray(raw) && raw.length > 0) {
		const first = raw[0];
		const isNested =
			Array.isArray(first) &&
			first.length > 0 &&
			(Array.isArray(first[0]) ||
				(typeof first[0] === "object" && first[0] !== null && "x" in first[0]));
		if (isNested) {
			contours = (raw as Array<Array<[number, number] | Point2D>>)
				.map((c) => c.map(toPoint2D))
				.filter((c) => c.length >= 3);
		} else {
			const single = (raw as Array<[number, number] | Point2D>).map(toPoint2D);
			if (single.length >= 3) contours = [single];
		}
	}
	if (Array.isArray(o.holes)) {
		for (const hole of o.holes) {
			const mapped = hole.map(toPoint2D);
			if (mapped.length >= 3) contours.push(mapped);
		}
	}
	return contours;
}

/** Side-wall segments meeting at more than 30° keep a crisp hard edge. */
const SIDE_CREASE_COS = Math.cos((30 * Math.PI) / 180);

/**
 * Extrudes any 2D outline (SVG path string with subpaths/holes, or polygon contour arrays)
 * into a 3D solid mesh with optional front/back bevels and crease-aware smooth/hard side normals.
 */
function buildExtrudedShapeModel(o: ExtrudeShapeGeometryOptions): Model3DData {
	const depth = Math.max(1e-3, o.depth ?? 20);
	const halfDepth = depth / 2;
	const bevelThickness = Math.max(
		0,
		Math.min(halfDepth * 0.49, o.bevelThickness ?? 0),
	);
	const bevelSize = Math.max(0, o.bevelSize ?? bevelThickness);
	const bevelSegments =
		bevelThickness > 0 || bevelSize > 0
			? Math.max(1, Math.round(o.bevelSegments ?? 2))
			: 0;
	const flattening: CurveFlattening = {
		segments: o.curveSegments,
		tolerance: Math.max(1e-3, o.curveTolerance ?? 0.25),
	};

	const rawContours = normalizeContoursInput(o, flattening);
	const polygons = organizeGlyphPolygons({
		contours: rawContours,
		simplified: false,
	});

	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const poly of polygons) {
		for (const p of poly.outer) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
		for (const hole of poly.holes) {
			for (const p of hole) {
				if (p.x < minX) minX = p.x;
				if (p.x > maxX) maxX = p.x;
				if (p.y < minY) minY = p.y;
				if (p.y > maxY) maxY = p.y;
			}
		}
	}
	if (!Number.isFinite(minX)) {
		minX = maxX = minY = maxY = 0;
	}
	if (o.center ?? true) {
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		for (const poly of polygons) {
			for (const p of poly.outer) {
				p.x -= cx;
				p.y -= cy;
			}
			for (const hole of poly.holes) {
				for (const p of hole) {
					p.x -= cx;
					p.y -= cy;
				}
			}
		}
		minX -= cx;
		maxX -= cx;
		minY -= cy;
		maxY -= cy;
	}
	const w = maxX - minX;
	const h = maxY - minY;

	const frontMb = new MeshBuilder();
	const sideMb = new MeshBuilder();
	const useSeparateSideMaterial =
		o.bevelColor !== undefined && o.bevelColor !== o.color;
	const wallMb = useSeparateSideMaterial ? sideMb : frontMb;

	// Clean contour and compute outward 2D edge & vertex miter normals
	const cleanContour = (contour: Contour) => {
		const pts = contour.filter((p, k) => {
			const next = contour[(k + 1) % contour.length]!;
			return Math.hypot(next.x - p.x, next.y - p.y) >= 1e-5;
		});
		const count = pts.length;
		if (count < 3) return null;
		const edgeLengths: number[] = [];
		const edgeNormals = pts.map((p, k) => {
			const next = pts[(k + 1) % count]!;
			const len = Math.hypot(next.x - p.x, next.y - p.y);
			edgeLengths.push(len);
			// For CCW outer contour (signedArea > 0) or CW hole (signedArea < 0),
			// (dy, -dx)/len points outward from the filled solid.
			return { x: (next.y - p.y) / len, y: -(next.x - p.x) / len };
		});
		const miterNormals = pts.map((_, k) => {
			const nPrev = edgeNormals[(k - 1 + count) % count]!;
			const nNext = edgeNormals[k]!;
			const sx = nPrev.x + nNext.x;
			const sy = nPrev.y + nNext.y;
			const len = Math.hypot(sx, sy);
			if (len < 1e-6) return nNext;
			// Clamp miter length so acute corners don't shoot out
			const dot = (sx / len) * nNext.x + (sy / len) * nNext.y;
			const scale = Math.min(2.0, 1 / Math.max(0.35, dot));
			return { x: (sx / len) * scale, y: (sy / len) * scale };
		});
		return { pts, edgeLengths, edgeNormals, miterNormals };
	};

	const addSideWallWithProfile = (contour: Contour) => {
		const info = cleanContour(contour);
		if (!info) return;
		const { pts, edgeLengths, edgeNormals, miterNormals } = info;
		const count = pts.length;
		const perimeter = edgeLengths.reduce((a, b) => a + b, 0) || 1;

		// Build Z-profile slices from front (-halfDepth) to back (+halfDepth):
		// Each slice has z, outset (radial offset along 2D outward normal), and (nr, nz) normal tilt.
		interface Slice {
			z: number;
			inset: number; // radial shift along outward normal (negative = inset at cap)
			nr: number;
			nz: number;
			v: number;
		}
		const slices: Slice[] = [];
		if (bevelSegments <= 0) {
			slices.push(
				{ z: -halfDepth, inset: 0, nr: 1, nz: 0, v: 0 },
				{ z: halfDepth, inset: 0, nr: 1, nz: 0, v: 1 },
			);
		} else {
			const totalRows = bevelSegments * 2 + 1;
			let row = 0;
			for (let b = 0; b <= bevelSegments; b++) {
				const a = ((b / bevelSegments) * Math.PI) / 2; // 0 at cap, pi/2 at wall
				slices.push({
					z: -halfDepth + bevelThickness * (1 - Math.cos(a)),
					inset: -bevelSize * (1 - Math.sin(a)),
					nr: Math.sin(a),
					nz: -Math.cos(a),
					v: row++ / totalRows,
				});
			}
			for (let b = 0; b <= bevelSegments; b++) {
				const a = ((b / bevelSegments) * Math.PI) / 2; // 0 at wall, pi/2 at back cap
				slices.push({
					z: halfDepth - bevelThickness * (1 - Math.sin(a)),
					inset: -bevelSize * (1 - Math.cos(a)),
					nr: Math.cos(a),
					nz: Math.sin(a),
					v: row++ / totalRows,
				});
			}
		}

		const numSlices = slices.length;
		const addColumn = (
			p: Point2D,
			miter: Point2D,
			n2d: Point2D,
			u: number,
		): number => {
			const base = wallMb.positions.length / 3;
			for (const s of slices) {
				const px = p.x + miter.x * s.inset;
				const py = p.y + miter.y * s.inset;
				const n3 = normalize([n2d.x * s.nr, n2d.y * s.nr, s.nz]);
				wallMb.vertex([px, py, s.z], n3, [u, s.v]);
			}
			return base;
		};

		const startColumn: number[] = [];
		const endColumn: number[] = [];
		let along = 0;
		for (let k = 0; k < count; k++) {
			const incoming = edgeNormals[(k - 1 + count) % count]!;
			const outgoing = edgeNormals[k]!;
			const miter = miterNormals[k]!;
			const u = along / perimeter;
			const sx = incoming.x + outgoing.x;
			const sy = incoming.y + outgoing.y;
			const smooth =
				incoming.x * outgoing.x + incoming.y * outgoing.y >= SIDE_CREASE_COS;
			const averaged = smooth
				? { x: sx / Math.hypot(sx, sy), y: sy / Math.hypot(sx, sy) }
				: null;
			if (averaged && k > 0) {
				startColumn[k] = endColumn[k] = addColumn(pts[k]!, miter, averaged, u);
			} else {
				endColumn[k] = addColumn(
					pts[k]!,
					miter,
					averaged ?? incoming,
					k === 0 ? 1 : u,
				);
				startColumn[k] = addColumn(pts[k]!, miter, averaged ?? outgoing, u);
			}
			along += edgeLengths[k]!;
		}

		for (let k = 0; k < count; k++) {
			const colA = startColumn[k]!;
			const colB = endColumn[(k + 1) % count]!;
			for (let s = 0; s < numSlices - 1; s++) {
				const a0 = colA + s;
				const a1 = colA + s + 1;
				const b0 = colB + s;
				const b1 = colB + s + 1;
				wallMb.indices.push(a0, b0, a1, b0, b1, a1);
			}
		}
	};

	for (const poly of polygons) {
		const outer = poly.outer;
		if (computeContourSignedArea(outer) < 0) outer.reverse();
		for (const hole of poly.holes) {
			if (computeContourSignedArea(hole) > 0) hole.reverse();
		}

		const outerInfo = cleanContour(outer);
		if (!outerInfo) continue;
		const holeInfos = poly.holes
			.map(cleanContour)
			.filter((x): x is NonNullable<typeof x> => x !== null);

		const capInset = -bevelSize;
		const earcutCoords: number[] = [];
		const holeIndices: number[] = [];

		for (let k = 0; k < outerInfo.pts.length; k++) {
			const p = outerInfo.pts[k]!;
			const m = outerInfo.miterNormals[k]!;
			earcutCoords.push(p.x + m.x * capInset, p.y + m.y * capInset);
		}
		for (const hInfo of holeInfos) {
			holeIndices.push(earcutCoords.length / 2);
			for (let k = 0; k < hInfo.pts.length; k++) {
				const p = hInfo.pts[k]!;
				const m = hInfo.miterNormals[k]!;
				earcutCoords.push(p.x + m.x * capInset, p.y + m.y * capInset);
			}
		}

		const triangles = earcut(earcutCoords, holeIndices, 2);
		const vertCount = earcutCoords.length / 2;

		// Front cap (-halfDepth, normal -z)
		const frontBase = frontMb.positions.length / 3;
		for (let v = 0; v < vertCount; v++) {
			const vx = earcutCoords[v * 2]!;
			const vy = earcutCoords[v * 2 + 1]!;
			frontMb.vertex(
				[vx, vy, -halfDepth],
				[0, 0, -1],
				[(vx - minX) / (w || 1), (vy - minY) / (h || 1)],
			);
		}
		for (let t = 0; t < triangles.length; t += 3) {
			frontMb.indices.push(
				frontBase + triangles[t]!,
				frontBase + triangles[t + 2]!,
				frontBase + triangles[t + 1]!,
			);
		}

		// Back cap (+halfDepth, normal +z)
		const backBase = frontMb.positions.length / 3;
		for (let v = 0; v < vertCount; v++) {
			const vx = earcutCoords[v * 2]!;
			const vy = earcutCoords[v * 2 + 1]!;
			frontMb.vertex(
				[vx, vy, halfDepth],
				[0, 0, 1],
				[(vx - minX) / (w || 1), (vy - minY) / (h || 1)],
			);
		}
		for (let t = 0; t < triangles.length; t += 3) {
			frontMb.indices.push(
				backBase + triangles[t]!,
				backBase + triangles[t + 1]!,
				backBase + triangles[t + 2]!,
			);
		}

		addSideWallWithProfile(outer);
		for (const hole of poly.holes) {
			addSideWallWithProfile(hole);
		}
	}

	const meshes: Mesh3DData[] = [];
	const materials: Record<string, Material3D> = {};

	const frontMesh = frontMb.build("extrude-front");
	frontMesh.materialName = "extrude-front-material";
	meshes.push(frontMesh);
	materials["extrude-front-material"] = {
		name: "extrude-front-material",
		diffuseColor: parseHexOrRgbColor(o.color ?? "#ffffff"),
		shading: o.material ?? "lit",
		shininess: o.shininess ?? 32,
		roughness: o.roughness,
		metallic: o.metallic,
	};

	if (useSeparateSideMaterial && sideMb.indices.length > 0) {
		const sideMesh = sideMb.build("extrude-side");
		sideMesh.materialName = "extrude-side-material";
		meshes.push(sideMesh);
		materials["extrude-side-material"] = {
			name: "extrude-side-material",
			diffuseColor: parseHexOrRgbColor(o.bevelColor ?? o.color ?? "#ffffff"),
			shading: o.material ?? "lit",
			shininess: o.shininess ?? 32,
			roughness: o.roughness,
			metallic: o.metallic,
		};
	}

	return finalizeModel3DData("extrude", meshes, materials);
}

/**
 * Revolves a 2D profile `(r, y)` around the Y axis (`x = r cos φ, y = y, z = r sin φ`).
 */
function lathe(o: LatheGeometryOptions, mb: MeshBuilder): void {
	const rawPoints: Point2D[] =
		typeof o.points === "string"
			? (parseSvgPathToContours(o.points, { tolerance: 0.25 })[0] ?? [])
			: o.points.map(toPoint2D);
	if (rawPoints.length < 2) return;

	// Ensure profile runs so outward normal points away from the Y axis:
	// If the profile goes bottom (+y) to top (-y) without closing, reverse it so it runs top (-y) to bottom (+y),
	// or compute outward orientation from the profile centroid.
	const pts = rawPoints.map((p) => ({ x: Math.max(0, p.x), y: p.y }));
	const isClosedLoop =
		pts.length >= 3 &&
		Math.hypot(
			pts[pts.length - 1]!.x - pts[0]!.x,
			pts[pts.length - 1]!.y - pts[0]!.y,
		) < 1e-4;

	if (isClosedLoop) {
		// In (r, y) plane, outward normal for segment (dr, dy) is (dy, -dr); for that to point outward
		// from the loop interior, signedArea in (r, y) must be > 0.
		if (computeContourSignedArea(pts) < 0) pts.reverse();
	} else if (pts[0]!.y > pts[pts.length - 1]!.y) {
		// Open profile: ensure it runs from top (-y) to bottom (+y) so (dy, -dr) has nr = dy >= 0 (outward +r).
		pts.reverse();
	}

	const seg = Math.max(3, Math.round(o.segments ?? 32));
	const phiStart = ((o.phiStart ?? 0) * Math.PI) / 180;
	const phiLength = ((o.phiLength ?? 360) * Math.PI) / 180;
	const count = pts.length;

	// Arc length along profile for V coordinate and 2D profile normals (nr, ny)
	const segLens: number[] = [];
	const segNormals: Point2D[] = [];
	let totalLen = 0;
	for (let j = 0; j < count - 1; j++) {
		const a = pts[j]!;
		const b = pts[j + 1]!;
		const dr = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dr, dy);
		segLens.push(len);
		totalLen += len;
		segNormals.push(
			len > 1e-8 ? { x: dy / len, y: -dr / len } : { x: 1, y: 0 },
		);
	}

	const vCoords: number[] = [0];
	let acc = 0;
	for (const len of segLens) {
		acc += len;
		vCoords.push(totalLen > 0 ? acc / totalLen : 0);
	}

	if (o.flatShaded) {
		for (let j = 0; j < count - 1; j++) {
			const pA = pts[j]!;
			const pB = pts[j + 1]!;
			const n2 = segNormals[j]!;
			for (let i = 0; i < seg; i++) {
				const phi0 = phiStart + (i / seg) * phiLength;
				const phi1 = phiStart + ((i + 1) / seg) * phiLength;
				const phiMid = (phi0 + phi1) / 2;
				const fn = normalize([
					n2.x * Math.cos(phiMid),
					n2.y,
					n2.x * Math.sin(phiMid),
				]);
				const c0 = Math.cos(phi0);
				const s0 = Math.sin(phi0);
				const c1 = Math.cos(phi1);
				const s1 = Math.sin(phi1);
				const base = mb.positions.length / 3;
				mb.vertex([pA.x * c0, pA.y, pA.x * s0], fn, [i / seg, vCoords[j]!]);
				mb.vertex([pA.x * c1, pA.y, pA.x * s1], fn, [
					(i + 1) / seg,
					vCoords[j]!,
				]);
				mb.vertex([pB.x * c0, pB.y, pB.x * s0], fn, [i / seg, vCoords[j + 1]!]);
				mb.vertex([pB.x * c1, pB.y, pB.x * s1], fn, [
					(i + 1) / seg,
					vCoords[j + 1]!,
				]);
				mb.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
			}
		}
	} else {
		// Smooth-shaded vertex normals along the profile with crease splitting at sharp corners (> 30°)
		const smoothOrCrease = (nSeg: Point2D, nAdj: Point2D): Point2D => {
			if (nSeg.x * nAdj.x + nSeg.y * nAdj.y < SIDE_CREASE_COS) {
				return nSeg;
			}
			const nx = nSeg.x + nAdj.x;
			const ny = nSeg.y + nAdj.y;
			const nLen = Math.hypot(nx, ny);
			return nLen > 1e-8 ? { x: nx / nLen, y: ny / nLen } : nSeg;
		};
		const emitRing = (p: Point2D, n2: Point2D, v: number): void => {
			for (let i = 0; i <= seg; i++) {
				const phi = phiStart + (i / seg) * phiLength;
				const c = Math.cos(phi);
				const s = Math.sin(phi);
				const vNorm: V3 =
					p.x <= 1e-5 && Math.abs(n2.y) > 1e-5
						? [0, n2.y < 0 ? -1 : 1, 0]
						: normalize([n2.x * c, n2.y, n2.x * s]);
				mb.vertex([p.x * c, p.y, p.x * s], vNorm, [i / seg, v]);
			}
		};

		for (let j = 0; j < count - 1; j++) {
			const pA = pts[j]!;
			const pB = pts[j + 1]!;
			const nSeg = segNormals[j]!;
			const nPrevA =
				j > 0
					? segNormals[j - 1]!
					: isClosedLoop
						? segNormals[count - 2]!
						: nSeg;
			const nNextB =
				j + 1 < count - 1
					? segNormals[j + 1]!
					: isClosedLoop
						? segNormals[0]!
						: nSeg;
			const nA = smoothOrCrease(nSeg, nPrevA);
			const nB = smoothOrCrease(nSeg, nNextB);
			const base = mb.positions.length / 3;
			emitRing(pA, nA, vCoords[j]!);
			emitRing(pB, nB, vCoords[j + 1]!);
			mb.grid(base, seg, 1, false);
		}
	}

	// Optional end caps when not closed and r > 0
	if ((o.capped ?? o.closed) && !isClosedLoop) {
		const first = pts[0]!;
		const last = pts[count - 1]!;
		for (const [pt, ny] of [
			[first, -1],
			[last, 1],
		] as const) {
			if (pt.x <= 1e-5) continue;
			const center = mb.vertex([0, pt.y, 0], [0, ny, 0], [0.5, 0.5]);
			const ring = mb.positions.length / 3;
			for (let i = 0; i <= seg; i++) {
				const phi = phiStart + (i / seg) * phiLength;
				const c = Math.cos(phi);
				const s = Math.sin(phi);
				mb.vertex(
					[pt.x * c, pt.y, pt.x * s],
					[0, ny, 0],
					[(c + 1) / 2, (s + 1) / 2],
				);
			}
			for (let i = 0; i < seg; i++) {
				if (ny < 0) mb.indices.push(center, ring + i, ring + i + 1);
				else mb.indices.push(center, ring + i + 1, ring + i);
			}
		}
	}
}

function buildPath3DFromSpec(
	spec: TubePathSpec,
	closedDefault = false,
): Path3D {
	if (Array.isArray(spec)) {
		if (spec.length < 2) {
			throw new Error("3D path requires at least 2 points");
		}
		return Path3D.catmullRom(spec, { closed: closedDefault });
	}
	if (spec.kind === "catmullRom") {
		return Path3D.catmullRom(spec.points, {
			tension: spec.tension,
			closed: spec.closed ?? closedDefault,
			samplesPerSegment: spec.samplesPerSegment,
		});
	}
	if (spec.kind === "bezier") {
		return Path3D.bezier(spec.segments, spec.samplesPerSegment);
	}
	if (spec.kind === "helix") {
		return Path3D.helix({
			center: spec.center ?? [0, 0, 0],
			radius: spec.radius,
			pitch: spec.pitch,
			turns: spec.turns,
			axis: spec.axis,
			samplesPerTurn: spec.samplesPerTurn,
		});
	}
	return Path3D.circle({
		center: spec.center ?? [0, 0, 0],
		radius: spec.radius,
		startAngleDeg: spec.startAngleDeg,
		endAngleDeg: spec.endAngleDeg,
		samples: spec.samples,
	});
}

/**
 * Sweeps a circular (or thick-walled hollow pipe) cross-section along a 3D path
 * using Rotation-Minimizing Frames (RMF) so the tube never kinks or gimbal-flips.
 */
function tube(o: TubeGeometryOptions, mb: MeshBuilder): void {
	const closed =
		o.closed ??
		(!Array.isArray(o.path) &&
			o.path.kind === "catmullRom" &&
			Boolean(o.path.closed));
	const path = buildPath3DFromSpec(o.path, closed);
	const tubSeg = Math.max(2, Math.round(o.tubularSegments ?? 64));
	const radSeg = Math.max(3, Math.round(o.radialSegments ?? 16));
	const rDefault = Math.max(1e-3, o.radius ?? 12);
	const rStart = o.radiusTaper ? Math.max(0, o.radiusTaper[0]) : rDefault;
	const rEnd = o.radiusTaper ? Math.max(0, o.radiusTaper[1]) : rDefault;
	const rInnerBase = Math.max(0, Math.min(rDefault - 1e-3, o.innerRadius ?? 0));
	const capped = o.capped ?? true;

	const frames = [];
	for (let j = 0; j <= tubSeg; j++) {
		frames.push(path.getPointAt(j / tubSeg));
	}

	// Outer wall: ∂p/∂j = T, ∂p/∂i = -sin(θ) N + cos(θ) B -> ∂p/∂j × ∂p/∂i = T × (-sin N + cos B) = -sin B - cos N = -(cos N + sin B).
	// Outward normal is +(cos N + sin B), so flip = true.
	const outerBase = mb.positions.length / 3;
	for (let j = 0; j <= tubSeg; j++) {
		const u = j / tubSeg;
		const r = rStart + (rEnd - rStart) * u;
		const f = frames[j]!;
		const [px, py, pz] = f.position;
		const [nx, ny, nz] = f.normal;
		const [bx, by, bz] = f.binormal;
		for (let i = 0; i <= radSeg; i++) {
			const v = i / radSeg;
			const theta = v * Math.PI * 2;
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			const dirX = c * nx + s * bx;
			const dirY = c * ny + s * by;
			const dirZ = c * nz + s * bz;
			mb.vertex(
				[px + r * dirX, py + r * dirY, pz + r * dirZ],
				normalize([dirX, dirY, dirZ]),
				[u, v],
			);
		}
	}
	mb.grid(outerBase, radSeg, tubSeg, true);

	if (rInnerBase > 1e-6) {
		// Hollow thick-walled pipe: inner wall + annular end caps
		const innerRatio = rInnerBase / rDefault;
		const innerBase = mb.positions.length / 3;
		for (let j = 0; j <= tubSeg; j++) {
			const u = j / tubSeg;
			const r = (rStart + (rEnd - rStart) * u) * innerRatio;
			const f = frames[j]!;
			const [px, py, pz] = f.position;
			const [nx, ny, nz] = f.normal;
			const [bx, by, bz] = f.binormal;
			for (let i = 0; i <= radSeg; i++) {
				const v = i / radSeg;
				const theta = v * Math.PI * 2;
				const c = Math.cos(theta);
				const s = Math.sin(theta);
				const dirX = c * nx + s * bx;
				const dirY = c * ny + s * by;
				const dirZ = c * nz + s * bz;
				mb.vertex(
					[px + r * dirX, py + r * dirY, pz + r * dirZ],
					normalize([-dirX, -dirY, -dirZ]),
					[u, v],
				);
			}
		}
		mb.grid(innerBase, radSeg, tubSeg, false);

		if (!closed && capped) {
			for (const [j, sign] of [
				[0, -1],
				[tubSeg, 1],
			] as const) {
				const u = j / tubSeg;
				const rOut = rStart + (rEnd - rStart) * u;
				const rIn = rOut * innerRatio;
				const f = frames[j]!;
				const [px, py, pz] = f.position;
				const [nx, ny, nz] = f.normal;
				const [bx, by, bz] = f.binormal;
				const capN = normalize([
					f.tangent[0] * sign,
					f.tangent[1] * sign,
					f.tangent[2] * sign,
				]);
				const base = mb.positions.length / 3;
				for (const rr of [rIn, rOut]) {
					for (let i = 0; i <= radSeg; i++) {
						const theta = (i / radSeg) * Math.PI * 2;
						const c = Math.cos(theta);
						const s = Math.sin(theta);
						const dirX = c * nx + s * bx;
						const dirY = c * ny + s * by;
						const dirZ = c * nz + s * bz;
						mb.vertex([px + rr * dirX, py + rr * dirY, pz + rr * dirZ], capN, [
							(c * (rr / rOut) + 1) / 2,
							(s * (rr / rOut) + 1) / 2,
						]);
					}
				}
				// ∂p/∂rr × ∂p/∂i = (cos N + sin B) × (-sin N + cos B) = N × B = T.
				mb.grid(base, radSeg, 1, sign < 0);
			}
		}
	} else if (!closed && capped) {
		// Solid circular end caps
		for (const [j, sign] of [
			[0, -1],
			[tubSeg, 1],
		] as const) {
			const u = j / tubSeg;
			const r = rStart + (rEnd - rStart) * u;
			if (r <= 1e-6) continue;
			const f = frames[j]!;
			const [px, py, pz] = f.position;
			const [nx, ny, nz] = f.normal;
			const [bx, by, bz] = f.binormal;
			const capN = normalize([
				f.tangent[0] * sign,
				f.tangent[1] * sign,
				f.tangent[2] * sign,
			]);
			const center = mb.vertex([px, py, pz], capN, [0.5, 0.5]);
			const ring = mb.positions.length / 3;
			for (let i = 0; i <= radSeg; i++) {
				const theta = (i / radSeg) * Math.PI * 2;
				const c = Math.cos(theta);
				const s = Math.sin(theta);
				const dirX = c * nx + s * bx;
				const dirY = c * ny + s * by;
				const dirZ = c * nz + s * bz;
				mb.vertex([px + r * dirX, py + r * dirY, pz + r * dirZ], capN, [
					(c + 1) / 2,
					(s + 1) / 2,
				]);
			}
			for (let i = 0; i < radSeg; i++) {
				// (p_{i+1} - center) × (p_i - center) = -N × B = -T; for +T (sign > 0) wind (center, ring+i, ring+i+1).
				if (sign > 0) mb.indices.push(center, ring + i, ring + i + 1);
				else mb.indices.push(center, ring + i + 1, ring + i);
			}
		}
	}
}

function resolvePointArray(spec: TubePathSpec): Vec3[] {
	if (Array.isArray(spec)) return spec;
	const path = buildPath3DFromSpec(spec);
	const count = 96;
	const out: Vec3[] = [];
	for (let i = 0; i <= count; i++) {
		out.push(path.getPointAt(i / count).position);
	}
	return out;
}

/**
 * Native 3D line geometry (`line-list` topology) with optional dashing and per-vertex colors.
 */
function line3d(o: Line3DGeometryOptions, mb: MeshBuilder): void {
	mb.topology = "line-list";
	const pts = resolvePointArray(o.points);
	if (pts.length < 2) return;

	const parsedColors = o.colors?.map((c) => parseHexOrRgbColor(c));
	const mode = o.mode ?? "strip";

	if (o.dashSize && o.dashSize > 0 && mode === "strip") {
		const dash = o.dashSize;
		const gap = o.gapSize ?? dash;
		const cycle = dash + gap;
		const workPts = o.closed ? [...pts, pts[0]!] : pts;
		let dist = 0;
		for (let i = 0; i < workPts.length - 1; i++) {
			const a = workPts[i]!;
			const b = workPts[i + 1]!;
			const segLen = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
			if (segLen < 1e-6) continue;
			const dir: V3 = [
				(b[0] - a[0]) / segLen,
				(b[1] - a[1]) / segLen,
				(b[2] - a[2]) / segLen,
			];
			const colA = parsedColors?.[i % parsedColors.length];
			let local = 0;
			while (local < segLen) {
				const phase = (dist + local) % cycle;
				if (phase < dash) {
					const step = Math.min(dash - phase, segLen - local);
					const p0: V3 = [
						a[0] + dir[0] * local,
						a[1] + dir[1] * local,
						a[2] + dir[2] * local,
					];
					const p1: V3 = [
						a[0] + dir[0] * (local + step),
						a[1] + dir[1] * (local + step),
						a[2] + dir[2] * (local + step),
					];
					const idx0 = mb.vertex(p0, [0, -1, 0], [0, 0], colA);
					const idx1 = mb.vertex(p1, [0, -1, 0], [1, 0], colA);
					mb.indices.push(idx0, idx1);
					local += step;
				} else {
					local += cycle - phase;
				}
			}
			dist += segLen;
		}
		return;
	}

	for (let i = 0; i < pts.length; i++) {
		const u = pts.length > 1 ? i / (pts.length - 1) : 0;
		mb.vertex(
			pts[i]!,
			[0, -1, 0],
			[u, 0],
			parsedColors ? parsedColors[i % parsedColors.length] : undefined,
		);
	}
	if (mode === "segments") {
		for (let i = 0; i + 1 < pts.length; i += 2) {
			mb.indices.push(i, i + 1);
		}
	} else {
		for (let i = 0; i < pts.length - 1; i++) {
			mb.indices.push(i, i + 1);
		}
		if (o.closed && pts.length >= 3) {
			mb.indices.push(pts.length - 1, 0);
		}
	}
}

/**
 * 3D point cloud geometry: either native GPU `point-list` topology (`pointSize <= 0` or omitted)
 * or icosahedral 3D dots of radius `pointSize` for diagram vertices that scale with perspective.
 */
function points3d(o: Points3DGeometryOptions, mb: MeshBuilder): void {
	const pts = resolvePointArray(o.points);
	if (pts.length === 0) return;
	const parsedColors = o.colors?.map((c) => parseHexOrRgbColor(c));
	const pointSize = o.pointSize ?? 0;

	if (pointSize > 0) {
		const dotMb = new MeshBuilder();
		polyhedron(
			{
				type: "polyhedron",
				shape: "icosphere",
				radius: pointSize,
				detail: 1,
				flatShaded: false,
			},
			dotMb,
		);
		const dotVerts = dotMb.positions.length / 3;
		for (let pIdx = 0; pIdx < pts.length; pIdx++) {
			const [px, py, pz] = pts[pIdx]!;
			const col = parsedColors
				? parsedColors[pIdx % parsedColors.length]
				: undefined;
			const base = mb.positions.length / 3;
			for (let v = 0; v < dotVerts; v++) {
				mb.vertex(
					[
						px + dotMb.positions[v * 3]!,
						py + dotMb.positions[v * 3 + 1]!,
						pz + dotMb.positions[v * 3 + 2]!,
					],
					[
						dotMb.normals[v * 3]!,
						dotMb.normals[v * 3 + 1]!,
						dotMb.normals[v * 3 + 2]!,
					],
					[dotMb.uvs[v * 2]!, dotMb.uvs[v * 2 + 1]!],
					col,
				);
			}
			for (const idx of dotMb.indices) {
				mb.indices.push(base + idx);
			}
		}
		return;
	}

	mb.topology = "point-list";
	for (let i = 0; i < pts.length; i++) {
		const u = pts.length > 1 ? i / (pts.length - 1) : 0;
		const idx = mb.vertex(
			pts[i]!,
			[0, -1, 0],
			[u, 0],
			parsedColors ? parsedColors[i % parsedColors.length] : undefined,
		);
		mb.indices.push(idx);
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

	type Polygon = V3[];

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
				const tangentX = normalize(cross3(up, n));
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
		const tx = normalize(cross3(up, fn));
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

function finalizeModel3DData(
	name: string,
	meshes: Mesh3DData[],
	materials: Record<string, Material3D>,
): Model3DData {
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
	for (const mesh of meshes) {
		const pos = mesh.positions;
		for (let i = 0; i < pos.length; i += 3) {
			for (let k = 0; k < 3; k++) {
				const v = pos[i + k]!;
				if (v < min[k]!) min[k] = v;
				if (v > max[k]!) max[k] = v;
			}
		}
	}
	if (!Number.isFinite(min[0])) {
		min[0] = min[1] = min[2] = 0;
		max[0] = max[1] = max[2] = 0;
	}
	const size: [number, number, number] = [
		max[0] - min[0],
		max[1] - min[1],
		max[2] - min[2],
	];
	return {
		name: `primitive-${name}`,
		meshes,
		materials,
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

/** Builds a procedural solid as a Model3DData. */
export function generatePrimitiveGeometry(
	options: PrimitiveGeometryOptions,
): Model3DData {
	if (options.type === "extrude") {
		return buildExtrudedShapeModel(options);
	}

	const mb = new MeshBuilder();
	if (options.type === "roundedBox") roundedBox(options, mb);
	else if (options.type === "sphere") sphere(options, mb);
	else if (options.type === "cylinder") cylinder(options, mb);
	else if (options.type === "torus") torus(options, mb);
	else if (options.type === "capsule") capsule(options, mb);
	else if (options.type === "ring") ring(options, mb);
	else if (options.type === "polyhedron") polyhedron(options, mb);
	else if (options.type === "lathe") lathe(options, mb);
	else if (options.type === "tube") tube(options, mb);
	else if (options.type === "line3d") line3d(options, mb);
	else if (options.type === "points3d") points3d(options, mb);
	else if (options.type === "shard") shard(options, mb);
	else {
		throw new Error(
			`Unknown 3D primitive: ${(options as { type?: string }).type}`,
		);
	}

	const name = options.type;
	const mesh = mb.build(name);
	const defaultShading =
		options.type === "line3d" ||
		(options.type === "points3d" && (options.pointSize ?? 0) <= 0)
			? "unlit"
			: "lit";
	const material: Material3D = {
		name: `${name}-material`,
		diffuseColor: parseHexOrRgbColor(options.color ?? "#ffffff"),
		shading: options.material ?? defaultShading,
		shininess: options.shininess ?? 32,
		roughness: options.roughness,
		metallic: options.metallic,
	};

	return finalizeModel3DData(name, [mesh], { [material.name]: material });
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
