/**
 * Sculpt a model from parts: mesh the field at hero resolution, simplify
 * to a triangle budget, take normals and colors from the field, skin the
 * vertices to a skeleton, and split by material into glTF primitives.
 *
 * ```ts
 * const skeleton = humanoidSkeleton({ height: 186, heads: 8 });
 * const body = sculpt({
 *   skeleton,
 *   parts: [
 *     { shape: "ellipsoid", at: [0, 120, 0], radii: [16, 22, 11], joint: ["Spine", "Spine1", "Spine2"], material: skin },
 *     ...mirrorParts([limb(skeleton, "LeftArm", { radii: [5, 4], blend: 4, material: skin })]),
 *   ],
 *   triangles: 60000,
 * });
 * doc.addNode({ mesh: doc.addMesh({ name: "Body", primitives: body.primitives }), skin: rig.skin });
 * ```
 */
import type { ColorInput } from "../color.js";
import type { MaterialRef, PrimitiveSpec } from "../document.js";
import type { Skeleton } from "../skeleton.js";
import { majorityTags, splitBorders, vertexMaterials } from "./borders.js";
import { type Part, SculptField } from "./field.js";
import { meshDefects, meshField, meshVolume } from "./mesh.js";
import { simplify } from "./simplify.js";
import { skinWeights } from "./skin.js";

export interface SculptOptions {
	parts: Part[];
	/** Skin the result to this skeleton (joint indices in its order, as `addSkeleton` writes them). */
	skeleton?: Skeleton;
	/** Lattice cell, model units. Default: the longest side of the parts' bounds / 256. */
	cell?: number;
	/** Simplify to at most this many triangles. Default: keep every triangle. */
	triangles?: number;
	/** Vertex color where no part sets one (display sRGB). Default white. */
	color?: ColorInput;
	/** Skin smoothing passes. Default 2. */
	skinSmoothing?: number;
}

export interface SculptReport {
	cell: number;
	vertices: number;
	triangles: number;
	/** Triangles straight off the lattice, before simplification. */
	sculptedTriangles: number;
	volume: number;
	/** Edges not shared by exactly two oppositely wound triangles (0 for a closed mesh). */
	openEdges: number;
	seconds: { mesh: number; simplify: number; attributes: number };
}

export interface SculptResult {
	/** One primitive per material, ready for `GltfDocument.addMesh`. */
	primitives: PrimitiveSpec[];
	report: SculptReport;
}

export function sculpt(options: SculptOptions): SculptResult {
	const field = new SculptField(options.parts, options.color);
	const { min, max } = field.bounds();
	const cell =
		options.cell ??
		Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 256;
	if (!(cell > 0)) throw new Error("sculpt: cell must be positive");

	let t = performance.now();
	const raw = meshField(field, { cell });
	if (!raw.indices.length)
		throw new Error("sculpt: the parts enclose no volume");
	const meshSeconds = (performance.now() - t) / 1000;

	// Materials by the part owning the surface: per vertex, then per
	// triangle for simplification (which keeps borders in place), then cut
	// exactly along the borders.
	const materials: (MaterialRef | undefined)[] = [];
	const materialOf = (part: number) => {
		const m = field.parts[part]?.part.material;
		const i = materials.indexOf(m);
		if (i >= 0) return i;
		materials.push(m);
		return materials.length - 1;
	};
	const rawTags = majorityTags(
		raw.indices,
		vertexMaterials(field, raw.positions, materialOf),
	);

	t = performance.now();
	const simplified =
		options.triangles !== undefined && options.triangles < rawTags.length
			? simplify(raw, { triangles: options.triangles, tags: rawTags })
			: raw;
	const simplifySeconds = (performance.now() - t) / 1000;
	const mesh =
		materials.length > 1
			? splitBorders(field, simplified, materialOf, cell)
			: { ...simplified, tags: new Int32Array(simplified.indices.length / 3) };

	t = performance.now();
	const nv = mesh.positions.length / 3;
	const normals = new Float32Array(nv * 3);
	const colored = field.parts.some((p) => p.color);
	const colors = colored ? new Float32Array(nv * 4) : undefined;
	for (let v = 0; v < nv; v++) {
		const x = mesh.positions[v * 3] as number;
		const y = mesh.positions[v * 3 + 1] as number;
		const z = mesh.positions[v * 3 + 2] as number;
		const near = field.relevant([x, y, z], cell);
		const n = field.normal(x, y, z, cell * 0.5, near);
		normals.set(n, v * 3);
		if (colors) {
			field.distance(x, y, z, near, true);
			colors.set(field.color, v * 4);
		}
	}
	const skin = options.skeleton
		? skinWeights(field, options.skeleton, mesh.positions, mesh.indices, {
				smoothing: options.skinSmoothing ?? 2,
				minFalloff: cell * 1.5,
			})
		: undefined;
	const attributeSeconds = (performance.now() - t) / 1000;

	const defects = meshDefects(mesh);
	const primitives = materials.map((material, id) =>
		primitive(mesh, id, material, normals, colors, skin),
	);
	return {
		primitives: primitives
			.map((p, id) => ({ p, order: materials[id]?.material ?? -1 }))
			.filter(({ p }) => p.positions.length > 0)
			.sort((a, b) => a.order - b.order)
			.map(({ p }) => p),
		report: {
			cell,
			vertices: nv,
			triangles: mesh.indices.length / 3,
			sculptedTriangles: raw.indices.length / 3,
			volume: meshVolume(mesh),
			openEdges: defects.open + defects.flipped,
			seconds: {
				mesh: meshSeconds,
				simplify: simplifySeconds,
				attributes: attributeSeconds,
			},
		},
	};
}

/** The triangles tagged `id` with their own copy of the vertices they use. */
function primitive(
	mesh: { positions: Float64Array; indices: Uint32Array; tags: Int32Array },
	id: number,
	material: MaterialRef | undefined,
	normals: Float32Array,
	colors: Float32Array | undefined,
	skin: { joints: Uint16Array; weights: Float32Array } | undefined,
): PrimitiveSpec {
	const remap = new Map<number, number>();
	const positions: number[] = [];
	const norms: number[] = [];
	const cols: number[] = [];
	const joints: number[] = [];
	const weights: number[] = [];
	const indices: number[] = [];
	for (let f = 0; f < mesh.tags.length; f++) {
		if (mesh.tags[f] !== id) continue;
		for (let k = 0; k < 3; k++) {
			const v = mesh.indices[f * 3 + k] as number;
			let i = remap.get(v);
			if (i === undefined) {
				i = positions.length / 3;
				remap.set(v, i);
				for (let a = 0; a < 3; a++) {
					positions.push(mesh.positions[v * 3 + a] as number);
					norms.push(normals[v * 3 + a] as number);
				}
				if (colors)
					for (let a = 0; a < 4; a++) cols.push(colors[v * 4 + a] as number);
				if (skin)
					for (let a = 0; a < 4; a++) {
						joints.push(skin.joints[v * 4 + a] as number);
						weights.push(skin.weights[v * 4 + a] as number);
					}
			}
			indices.push(i);
		}
	}
	return {
		positions,
		normals: norms,
		indices,
		...(material ? { material } : {}),
		...(colors ? { colors: cols } : {}),
		...(skin ? { joints, weights } : {}),
	};
}
