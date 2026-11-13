/**
 * Per-vertex tangents for normal mapping, from a triangle mesh's UVs
 * (Lengyel's method): each triangle's direction of increasing u, summed
 * at its corners, made perpendicular to the vertex normal; the fourth
 * component is the handedness of the UV mapping (+1 or -1).
 */
type Numbers = ArrayLike<number>;

export function computeTangents(
	positions: Numbers,
	normals: Numbers,
	uvs: Numbers,
	indices?: Numbers,
): Float32Array {
	const n = positions.length / 3;
	const idx = indices ?? Array.from({ length: n }, (_, i) => i);
	const tan = new Float64Array(n * 3);
	const bit = new Float64Array(n * 3);
	for (let f = 0; f + 2 < idx.length; f += 3) {
		const a = idx[f] as number;
		const b = idx[f + 1] as number;
		const c = idx[f + 2] as number;
		const e1 = [0, 1, 2].map(
			(k) =>
				(positions[b * 3 + k] as number) - (positions[a * 3 + k] as number),
		);
		const e2 = [0, 1, 2].map(
			(k) =>
				(positions[c * 3 + k] as number) - (positions[a * 3 + k] as number),
		);
		const du1 = (uvs[b * 2] as number) - (uvs[a * 2] as number);
		const dv1 = (uvs[b * 2 + 1] as number) - (uvs[a * 2 + 1] as number);
		const du2 = (uvs[c * 2] as number) - (uvs[a * 2] as number);
		const dv2 = (uvs[c * 2 + 1] as number) - (uvs[a * 2 + 1] as number);
		const det = du1 * dv2 - du2 * dv1;
		if (Math.abs(det) < 1e-20) continue;
		const r = 1 / det;
		for (let k = 0; k < 3; k++) {
			const t = (dv2 * (e1[k] as number) - dv1 * (e2[k] as number)) * r;
			const s = (du1 * (e2[k] as number) - du2 * (e1[k] as number)) * r;
			for (const v of [a, b, c]) {
				tan[v * 3 + k] = (tan[v * 3 + k] as number) + t;
				bit[v * 3 + k] = (bit[v * 3 + k] as number) + s;
			}
		}
	}
	const out = new Float32Array(n * 4);
	for (let v = 0; v < n; v++) {
		const N = [
			normals[v * 3] as number,
			normals[v * 3 + 1] as number,
			normals[v * 3 + 2] as number,
		];
		let T = [
			tan[v * 3] as number,
			tan[v * 3 + 1] as number,
			tan[v * 3 + 2] as number,
		];
		const d =
			(N[0] as number) * (T[0] as number) +
			(N[1] as number) * (T[1] as number) +
			(N[2] as number) * (T[2] as number);
		T = T.map((t, k) => t - (N[k] as number) * d);
		let l = Math.hypot(...T);
		if (l < 1e-12) {
			// No UV gradient here: any direction perpendicular to the normal.
			const ax = Math.abs(N[0] as number) < 0.9 ? [1, 0, 0] : [0, 1, 0];
			const dd = ax.reduce((s, x, k) => s + x * (N[k] as number), 0);
			T = ax.map((x, k) => x - (N[k] as number) * dd);
			l = Math.hypot(...T);
		}
		const B = [
			bit[v * 3] as number,
			bit[v * 3 + 1] as number,
			bit[v * 3 + 2] as number,
		];
		const cross = [
			(N[1] as number) * (T[2] as number) - (N[2] as number) * (T[1] as number),
			(N[2] as number) * (T[0] as number) - (N[0] as number) * (T[2] as number),
			(N[0] as number) * (T[1] as number) - (N[1] as number) * (T[0] as number),
		];
		const w =
			cross.reduce((s, x, k) => s + x * (B[k] as number), 0) < 0 ? -1 : 1;
		out.set(
			[(T[0] as number) / l, (T[1] as number) / l, (T[2] as number) / l, w],
			v * 4,
		);
	}
	return out;
}
