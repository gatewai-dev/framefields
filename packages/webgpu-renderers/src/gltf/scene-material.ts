/**
 * A draw's surface as a glTF material: PBR metallic-roughness plus the
 * Khronos extensions for the engine's extra lobes. Defaults and glass read
 * as the path tracer reads them, so the file shades like the traced frame.
 */
import { parseColor } from "../color.js";
import type {
	DrawMesh3DOpts,
	DrawQuad3DOpts,
} from "../renderer3d/renderer3d.js";
import type { ColorInput } from "./color.js";
import type { MaterialSpec, TextureRef } from "./material.js";

type SurfaceOpts = DrawMesh3DOpts | DrawQuad3DOpts;
type ColorOption =
	| string
	| readonly number[]
	| { r: number; g: number; b: number; a?: number }
	| undefined;

/** Display RGBA, 0..1, of an option color. */
export function displayColor(
	c: ColorOption,
	fallback: [number, number, number, number],
): [number, number, number, number] {
	if (c === undefined || c === null) return fallback;
	if (Array.isArray(c)) return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 1];
	const p = parseColor(c as string);
	return [p.r, p.g, p.b, p.a];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const rgb = (c: [number, number, number, number]): ColorInput => [
	clamp01(c[0]),
	clamp01(c[1]),
	clamp01(c[2]),
];

export interface SceneTextures {
	color?: TextureRef;
	normal?: TextureRef;
	metallicRoughness?: TextureRef;
	occlusion?: TextureRef;
	emissive?: TextureRef;
}

function isGlass(o: SurfaceOpts): o is DrawMesh3DOpts {
	return (
		o.material === "glass" ||
		o.material === "acrylic" ||
		o.material === "frosted"
	);
}

function emissive(o: SurfaceOpts): Partial<MaterialSpec> {
	if (o.emissive === undefined || o.emissive === null) return {};
	const e = displayColor(o.emissive as ColorOption, [0, 0, 0, 1]);
	const strength = o.emissiveIntensity ?? 1;
	if (strength <= 0 || Math.max(e[0], e[1], e[2]) <= 0) return {};
	return {
		emissive: rgb([e[0] * e[3], e[1] * e[3], e[2] * e[3], 1]),
		...(strength !== 1 ? { emissiveStrength: strength } : {}),
	};
}

function glass(o: SurfaceOpts, metersPerUnit: number): Partial<MaterialSpec> {
	if (!isGlass(o)) return {};
	const thickness = o.worldThickness;
	return {
		transmission: 1,
		ior: Math.max(
			1,
			Math.min(4, o.ior ?? (o.material === "acrylic" ? 1.49 : 1.5)),
		),
		...(thickness && thickness > 0
			? { volume: { thickness: thickness * metersPerUnit } }
			: {}),
	};
}

function lobes(o: SurfaceOpts): Partial<MaterialSpec> {
	const out: Partial<MaterialSpec> = {};
	if (o.clearcoat)
		out.clearcoat = {
			factor: clamp01(o.clearcoat),
			roughness: clamp01(o.clearcoatRoughness ?? 0.08),
		};
	if (o.sheen) {
		const c = displayColor(o.sheenColor as ColorOption, [1, 1, 1, 1]);
		const k = clamp01(o.sheen);
		out.sheen = {
			color: rgb([c[0] * k, c[1] * k, c[2] * k, 1]),
			roughness: clamp01(o.sheenRoughness ?? 0.5),
		};
	}
	const irid = o.iridescence;
	const iridOpts = typeof irid === "object" && irid ? irid : {};
	const iridFactor =
		typeof irid === "number" ? irid : irid ? (iridOpts.intensity ?? 1) : 0;
	if (iridFactor > 0) {
		const thickness = o.iridescenceThickness ?? iridOpts.thickness ?? 400;
		out.iridescence = {
			factor: clamp01(iridFactor),
			ior: o.iridescenceIor ?? iridOpts.ior ?? 1.3,
			thickness: [thickness, thickness],
		};
	}
	if (o.anisotropy)
		out.anisotropy = {
			strength: clamp01(Math.abs(o.anisotropy)),
			rotation: o.anisotropyRotation ?? 0,
		};
	if (o.subsurface)
		out.subsurface = {
			factor: clamp01(o.subsurface),
			color: rgb(
				displayColor(o.subsurfaceColor as ColorOption, [1, 0.42, 0.29, 1]),
			),
		};
	return out;
}

function alpha(
	o: SurfaceOpts,
	quad: boolean,
	opacity: number,
): Partial<MaterialSpec> {
	const cutoff = quad ? 0 : ((o as DrawMesh3DOpts).alphaCutoff ?? 0);
	if (cutoff > 0) return { alphaMode: "mask", alphaCutoff: clamp01(cutoff) };
	// A layer on a plane keeps its transparent pixels, as the tracer does.
	if (quad || opacity < 1) return { alphaMode: "blend" };
	return {};
}

/**
 * The material of a draw: `tint` multiplies the draw's own color (an
 * instance's color), `metersPerUnit` sizes glass thickness.
 */
export function sceneMaterial(
	o: SurfaceOpts,
	quad: boolean,
	textures: SceneTextures,
	metersPerUnit: number,
	tint: [number, number, number, number] = [1, 1, 1, 1],
): MaterialSpec {
	const c = displayColor(o.colorTint as ColorOption, [1, 1, 1, 1]);
	const opacity = clamp01((o.opacity ?? 1) * c[3] * tint[3]);
	const glassy = isGlass(o);
	const roughness = glassy
		? (o.roughness ?? (o.material === "frosted" ? 0.5 : 0))
		: (o.roughness ?? 0.5);
	return {
		color: [
			clamp01(c[0] * tint[0]),
			clamp01(c[1] * tint[1]),
			clamp01(c[2] * tint[2]),
			opacity,
		],
		metallic: clamp01(o.metallic ?? (o.material === "metallic" ? 1 : 0)),
		roughness: clamp01(roughness),
		...(o.twoSided ? { doubleSided: true } : {}),
		...(o.material === "unlit" ? { unlit: true } : {}),
		...alpha(o, quad, opacity),
		...emissive(o),
		...glass(o, metersPerUnit),
		...lobes(o),
		...(textures.color ? { colorTexture: textures.color } : {}),
		...(textures.metallicRoughness
			? { metallicRoughnessTexture: textures.metallicRoughness }
			: {}),
		...(textures.emissive ? { emissiveTexture: textures.emissive } : {}),
		...mapsWithStrength(o, textures),
	};
}

function mapsWithStrength(
	o: SurfaceOpts,
	textures: SceneTextures,
): Partial<MaterialSpec> {
	const maps = "maps" in o ? o.maps : undefined;
	const out: Partial<MaterialSpec> = {};
	if (textures.normal)
		out.normalTexture = {
			texture: textures.normal,
			scale: maps?.normalScale ?? 1,
		};
	if (textures.occlusion)
		out.occlusionTexture = {
			texture: textures.occlusion,
			strength: maps?.occlusionStrength ?? 1,
		};
	return out;
}
