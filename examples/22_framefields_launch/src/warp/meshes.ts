/**
 * The meshes the distortion chapter bends: dense parametric surfaces written
 * as Wavefront OBJ (positions in pixels, smooth normals, u running round the
 * surface so the deformer spreads the audio spectrum across it). Built once
 * into assets/meshes/ when the film is assembled.
 */
import fs from "node:fs";
import path from "node:path";
import { ASSETS } from "../paths.js";

type V3 = [number, number, number];
type Surface = (u: number, v: number) => V3;

/** A (u, v) grid over a parametric surface; normals from the surface's partials. */
function obj(
	name: string,
	f: Surface,
	nu: number,
	nv: number,
	wrapV = true,
): string {
	const lines = [`# ${name}: ${nu}×${nv} parametric surface`];
	const eps = 1e-4;
	const rows = wrapV ? nv : nv + 1;
	for (let j = 0; j < rows; j++)
		for (let i = 0; i < nu; i++) {
			const u = i / nu;
			const v = j / nv;
			const p = f(u, v);
			const du = f(u + eps, v).map((x, k) => x - p[k]);
			const dv = f(u, Math.min(v + eps, 1)).map((x, k) => x - p[k]);
			const n: V3 = [
				du[1] * dv[2] - du[2] * dv[1],
				du[2] * dv[0] - du[0] * dv[2],
				du[0] * dv[1] - du[1] * dv[0],
			];
			const len = Math.hypot(...n) || 1;
			lines.push(`v ${p.map((x) => x.toFixed(3)).join(" ")}`);
			lines.push(`vn ${n.map((x) => (x / len).toFixed(4)).join(" ")}`);
			lines.push(`vt ${u.toFixed(4)} ${v.toFixed(4)}`);
		}
	const at = (i: number, j: number) => (j % rows) * nu + (i % nu) + 1;
	for (let j = 0; j < nv; j++)
		for (let i = 0; i < nu; i++) {
			const a = at(i, j);
			const b = at(i + 1, j);
			const c = at(i + 1, j + 1);
			const d = at(i, j + 1);
			lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
			lines.push(`f ${a}/${a}/${a} ${c}/${c}/${c} ${d}/${d}/${d}`);
		}
	return `${lines.join("\n")}\n`;
}

const TAU = Math.PI * 2;

const SURFACES: Record<string, () => string> = {
	sphere: () =>
		obj(
			"sphere",
			(u, v) => {
				const th = u * TAU;
				const ph = Math.max(1e-3, Math.min(Math.PI - 1e-3, v * Math.PI));
				return [
					260 * Math.sin(ph) * Math.cos(th),
					260 * Math.cos(ph),
					260 * Math.sin(ph) * Math.sin(th),
				];
			},
			128,
			80,
			false,
		),
	torus: () =>
		obj(
			"torus",
			(u, v) => {
				const a = u * TAU;
				const b = v * TAU;
				const r = 230 + 95 * Math.cos(b);
				return [r * Math.cos(a), 95 * Math.sin(b), r * Math.sin(a)];
			},
			160,
			56,
		),
	knot: () =>
		obj(
			"knot",
			(u, v) => {
				// A (2, 3) torus knot, swept by a tube.
				const t = u * TAU;
				const c = (s: number): V3 => {
					const r = 150 + 70 * Math.cos(3 * s);
					return [
						r * Math.cos(2 * s),
						70 * Math.sin(3 * s) * 1.6,
						r * Math.sin(2 * s),
					];
				};
				const p = c(t);
				const q = c(t + 1e-3);
				const tan = q.map((x, k) => x - p[k]);
				const tl = Math.hypot(...tan);
				const T = tan.map((x) => x / tl) as V3;
				const up: V3 = [0, 1, 0];
				const N0: V3 = [
					T[1] * up[2] - T[2] * up[1],
					T[2] * up[0] - T[0] * up[2],
					T[0] * up[1] - T[1] * up[0],
				];
				const nl = Math.hypot(...N0) || 1;
				const N = N0.map((x) => x / nl) as V3;
				const B: V3 = [
					T[1] * N[2] - T[2] * N[1],
					T[2] * N[0] - T[0] * N[2],
					T[0] * N[1] - T[1] * N[0],
				];
				const a = v * TAU;
				return p.map(
					(x, k) => x + 52 * (Math.cos(a) * N[k] + Math.sin(a) * B[k]),
				) as V3;
			},
			420,
			36,
		),
	column: () =>
		obj(
			"column",
			(u, v) => {
				// A square column with rounded corners: twisting it reads at once.
				const a = u * TAU;
				const k = 6;
				const x = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** (2 / k);
				const z = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** (2 / k);
				return [140 * x, 380 - 760 * v, 140 * z];
			},
			128,
			96,
			false,
		),
};

export type MeshName = keyof typeof SURFACES;

/** The mesh's OBJ path, written on first use. */
export function meshFile(name: MeshName): string {
	const file = path.join(ASSETS, "meshes", `${name}.obj`);
	if (!fs.existsSync(file)) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, SURFACES[name]());
	}
	return file;
}
