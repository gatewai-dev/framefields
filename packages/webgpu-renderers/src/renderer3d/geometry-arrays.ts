/**
 * Flat vertex arrays procedural meshes are assembled in before they become a
 * Mesh3DData. Winding follows the primitives': for a triangle (a, b, c),
 * cross(b - a, c - a) points out of the surface.
 */
export interface GeometryArrays {
	positions: number[];
	normals: number[];
	uvs: number[];
	/** RGBA per vertex, display (sRGB) 0..1; empty for none. */
	colors: number[];
	indices: number[];
}

export type Rgba = [number, number, number, number];
type V3 = readonly [number, number, number];

export function emptyArrays(): GeometryArrays {
	return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

export function pushVertex(
	g: GeometryArrays,
	p: V3,
	n: V3,
	uv: readonly [number, number],
	color?: Rgba,
): number {
	g.positions.push(p[0], p[1], p[2]);
	g.normals.push(n[0], n[1], n[2]);
	g.uvs.push(uv[0], uv[1]);
	if (color) g.colors.push(color[0], color[1], color[2], color[3]);
	return g.positions.length / 3 - 1;
}

/** Appends triangle (a, b, c), or (a, c, b) when `flip`. */
export function pushTriangle(
	g: GeometryArrays,
	a: number,
	b: number,
	c: number,
	flip = false,
): void {
	if (flip) g.indices.push(a, c, b);
	else g.indices.push(a, b, c);
}

/**
 * Smooth vertex normals: each vertex takes the area-weighted sum of its
 * triangles' face normals.
 */
export function accumulateNormals(g: GeometryArrays): void {
	const p = g.positions;
	const n = new Float64Array(p.length);
	const idx = g.indices;
	for (let t = 0; t < idx.length; t += 3) {
		const a = idx[t]! * 3;
		const b = idx[t + 1]! * 3;
		const c = idx[t + 2]! * 3;
		const ex = p[b]! - p[a]!;
		const ey = p[b + 1]! - p[a + 1]!;
		const ez = p[b + 2]! - p[a + 2]!;
		const fx = p[c]! - p[a]!;
		const fy = p[c + 1]! - p[a + 1]!;
		const fz = p[c + 2]! - p[a + 2]!;
		const cx = ey * fz - ez * fy;
		const cy = ez * fx - ex * fz;
		const cz = ex * fy - ey * fx;
		for (const v of [a, b, c]) {
			n[v] += cx;
			n[v + 1] += cy;
			n[v + 2] += cz;
		}
	}
	for (let v = 0; v < n.length; v += 3) {
		const len = Math.hypot(n[v]!, n[v + 1]!, n[v + 2]!) || 1;
		g.normals[v] = n[v]! / len;
		g.normals[v + 1] = n[v + 1]! / len;
		g.normals[v + 2] = n[v + 2]! / len;
	}
}

/** Every triangle gets its own three vertices and its face normal: faceted shading. */
export function flatten(g: GeometryArrays): GeometryArrays {
	const out = emptyArrays();
	const p = g.positions;
	const hasColor = g.colors.length > 0;
	for (let t = 0; t < g.indices.length; t += 3) {
		const tri = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
		const [a, b, c] = tri.map((i) => i * 3) as [number, number, number];
		const ex = p[b]! - p[a]!;
		const ey = p[b + 1]! - p[a + 1]!;
		const ez = p[b + 2]! - p[a + 2]!;
		const fx = p[c]! - p[a]!;
		const fy = p[c + 1]! - p[a + 1]!;
		const fz = p[c + 2]! - p[a + 2]!;
		let nx = ey * fz - ez * fy;
		let ny = ez * fx - ex * fz;
		let nz = ex * fy - ey * fx;
		const len = Math.hypot(nx, ny, nz) || 1;
		nx /= len;
		ny /= len;
		nz /= len;
		// A face's color: the mean of its corners'.
		let color: Rgba | undefined;
		if (hasColor) {
			color = [0, 0, 0, 0];
			for (const i of tri)
				for (let k = 0; k < 4; k++) color[k] += g.colors[i * 4 + k]! / 3;
		}
		for (const i of tri) {
			out.indices.push(
				pushVertex(
					out,
					[p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!],
					[nx, ny, nz],
					[g.uvs[i * 2]!, g.uvs[i * 2 + 1]!],
					color,
				),
			);
		}
	}
	return out;
}
