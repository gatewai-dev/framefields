/**
 * Materials in the words of a shading artist, written as glTF 2.0 PBR
 * metallic-roughness plus the Khronos extensions for clearcoat, sheen,
 * specular, IOR, transmission, volume, iridescence, anisotropy, emissive
 * strength and unlit.
 */
import { type ColorInput, linearRgb, linearRgba } from "./color.js";

/** A texture added to the document (`GltfDocument.addTexture`). */
export interface TextureRef {
	readonly texture: number;
}

export interface TextureSlot {
	texture: TextureRef;
	/** UV set. Default 0. */
	texCoord?: number;
	/**
	 * Placement of the image on the UVs (KHR_texture_transform): `scale`
	 * repeats it (a tiling detail map), `offset` shifts it, `rotation` turns
	 * it (degrees, counterclockwise).
	 */
	transform?: {
		scale?: [number, number];
		offset?: [number, number];
		rotation?: number;
	};
}

export interface MaterialSpec {
	name?: string;
	/** Base color (display sRGB; alpha from #rrggbbaa or a 4th component). Default white. */
	color?: ColorInput;
	colorTexture?: TextureRef | TextureSlot;
	/** 0..1. Default 0 (glTF's default of 1 is rarely what a sculpt wants). */
	metallic?: number;
	/** 0..1. Default 0.5. */
	roughness?: number;
	/** Green = roughness, blue = metallic, as glTF packs them. */
	metallicRoughnessTexture?: TextureRef | TextureSlot;
	normalTexture?: TextureRef | (TextureSlot & { scale?: number });
	occlusionTexture?: TextureRef | (TextureSlot & { strength?: number });
	/** Emitted color (display sRGB). */
	emissive?: ColorInput;
	/** Multiplies `emissive` past 1 for bloom (KHR_materials_emissive_strength). */
	emissiveStrength?: number;
	emissiveTexture?: TextureRef | TextureSlot;
	/** Default "opaque". "mask" cuts out below `alphaCutoff` (hair cards, frayed hems). */
	alphaMode?: "opaque" | "mask" | "blend";
	/** Default 0.5. */
	alphaCutoff?: number;
	/** Render back faces (cloaks, leaves, hair cards). */
	doubleSided?: boolean;
	/** No lighting (KHR_materials_unlit). */
	unlit?: boolean;
	/** Lacquer layer: strength 0..1, or with its own roughness. */
	clearcoat?: number | { factor: number; roughness?: number };
	/** Cloth and fur retroreflection. */
	sheen?: { color: ColorInput; roughness?: number };
	/** Dielectric specular strength and tint. */
	specular?: { factor?: number; color?: ColorInput };
	/** Index of refraction. Default 1.5. */
	ior?: number;
	/** Light passing through thin surfaces, 0..1. */
	transmission?: number;
	/** Thick transmissive volume (eye lens, amber, ice). */
	volume?: {
		thickness: number;
		attenuationColor?: ColorInput;
		attenuationDistance?: number;
	};
	/** Thin-film interference: strength 0..1, or with film IOR and thickness range (nm). */
	iridescence?:
		| number
		| { factor: number; ior?: number; thickness?: [number, number] };
	/** Brushed / combed highlights: strength 0..1, rotation in degrees. */
	anisotropy?: { strength: number; rotation?: number };
	/**
	 * Light scattering under the surface (skin, wax, jade, leaves): strength
	 * 0..1 and the scattered color (display sRGB). glTF has no ratified
	 * lobe for it, so it is written to `extras.framefields.subsurface`,
	 * which framefields renders and other viewers ignore.
	 */
	subsurface?: number | { factor: number; color?: ColorInput };
	/** Free data for other tools (glTF `extras`). */
	extras?: Record<string, unknown>;
}

export interface MaterialJson {
	json: Record<string, unknown>;
	extensions: string[];
}

const slot = (t: TextureRef | TextureSlot): TextureSlot =>
	"texture" in t && typeof t.texture === "object"
		? (t as TextureSlot)
		: { texture: t as TextureRef };

function textureInfo(
	t: TextureRef | TextureSlot,
	used: Set<string>,
	extra: Record<string, number> = {},
): Record<string, unknown> {
	const s = slot(t);
	const info: Record<string, unknown> = {
		index: s.texture.texture,
		...(s.texCoord ? { texCoord: s.texCoord } : {}),
		...extra,
	};
	const tr = s.transform;
	if (tr && (tr.scale || tr.offset || tr.rotation)) {
		used.add("KHR_texture_transform");
		info.extensions = {
			KHR_texture_transform: {
				...(tr.offset ? { offset: tr.offset } : {}),
				...(tr.rotation ? { rotation: (tr.rotation * Math.PI) / 180 } : {}),
				...(tr.scale ? { scale: tr.scale } : {}),
			},
		};
	}
	return info;
}

function check(name: string, v: number | undefined, lo = 0, hi = 1) {
	if (v === undefined) return;
	if (!Number.isFinite(v) || v < lo || v > hi)
		throw new Error(`material: ${name} ${v} is outside ${lo}..${hi}`);
}

/** The material's glTF JSON and the extensions it uses. */
export function materialJson(m: MaterialSpec): MaterialJson {
	check("metallic", m.metallic);
	check("roughness", m.roughness);
	check("alphaCutoff", m.alphaCutoff);
	check("transmission", m.transmission);
	check("ior", m.ior, 1, 4);
	check("emissiveStrength", m.emissiveStrength, 0, 1e6);

	const used = new Set<string>();
	const info = (t: TextureRef | TextureSlot, extra?: Record<string, number>) =>
		textureInfo(t, used, extra);
	const pbr: Record<string, unknown> = {
		baseColorFactor: linearRgba(m.color ?? "#ffffff"),
		metallicFactor: m.metallic ?? 0,
		roughnessFactor: m.roughness ?? 0.5,
	};
	if (m.colorTexture) pbr.baseColorTexture = info(m.colorTexture);
	if (m.metallicRoughnessTexture)
		pbr.metallicRoughnessTexture = info(m.metallicRoughnessTexture);

	const json: Record<string, unknown> = { pbrMetallicRoughness: pbr };
	if (m.name) json.name = m.name;
	if (m.normalTexture) {
		const scale =
			"scale" in m.normalTexture ? m.normalTexture.scale : undefined;
		json.normalTexture = info(
			m.normalTexture,
			scale === undefined ? {} : { scale },
		);
	}
	if (m.occlusionTexture) {
		const strength =
			"strength" in m.occlusionTexture
				? m.occlusionTexture.strength
				: undefined;
		json.occlusionTexture = info(
			m.occlusionTexture,
			strength === undefined ? {} : { strength },
		);
	}
	if (m.emissive) json.emissiveFactor = linearRgb(m.emissive);
	if (m.emissiveTexture) {
		json.emissiveTexture = info(m.emissiveTexture);
		json.emissiveFactor ??= [1, 1, 1];
	}
	if (m.alphaMode && m.alphaMode !== "opaque") {
		json.alphaMode = m.alphaMode.toUpperCase();
		if (m.alphaMode === "mask" && m.alphaCutoff !== undefined)
			json.alphaCutoff = m.alphaCutoff;
	}
	if (m.doubleSided) json.doubleSided = true;
	const extras: Record<string, unknown> = { ...(m.extras ?? {}) };
	if (m.subsurface !== undefined) {
		const ss =
			typeof m.subsurface === "number"
				? { factor: m.subsurface }
				: m.subsurface;
		check("subsurface", ss.factor);
		const own =
			(extras.framefields as Record<string, unknown> | undefined) ?? {};
		extras.framefields = {
			...own,
			subsurface: {
				factor: ss.factor,
				color: linearRgb(ss.color ?? "#ff6a4a"),
			},
		};
	}
	if (Object.keys(extras).length) json.extras = extras;

	const ext: Record<string, Record<string, unknown>> = {};
	if (m.unlit) ext.KHR_materials_unlit = {};
	if (m.emissiveStrength !== undefined && m.emissiveStrength !== 1)
		ext.KHR_materials_emissive_strength = {
			emissiveStrength: m.emissiveStrength,
		};
	if (m.clearcoat !== undefined) {
		const c =
			typeof m.clearcoat === "number" ? { factor: m.clearcoat } : m.clearcoat;
		check("clearcoat", c.factor);
		check("clearcoat roughness", c.roughness);
		ext.KHR_materials_clearcoat = {
			clearcoatFactor: c.factor,
			...(c.roughness === undefined
				? {}
				: { clearcoatRoughnessFactor: c.roughness }),
		};
	}
	if (m.sheen) {
		check("sheen roughness", m.sheen.roughness);
		ext.KHR_materials_sheen = {
			sheenColorFactor: linearRgb(m.sheen.color),
			sheenRoughnessFactor: m.sheen.roughness ?? 0.5,
		};
	}
	if (m.specular) {
		check("specular", m.specular.factor);
		ext.KHR_materials_specular = {
			...(m.specular.factor === undefined
				? {}
				: { specularFactor: m.specular.factor }),
			...(m.specular.color
				? { specularColorFactor: linearRgb(m.specular.color) }
				: {}),
		};
	}
	if (m.ior !== undefined) ext.KHR_materials_ior = { ior: m.ior };
	if (m.transmission !== undefined)
		ext.KHR_materials_transmission = { transmissionFactor: m.transmission };
	if (m.volume) {
		ext.KHR_materials_volume = {
			thicknessFactor: m.volume.thickness,
			...(m.volume.attenuationColor
				? { attenuationColor: linearRgb(m.volume.attenuationColor) }
				: {}),
			...(m.volume.attenuationDistance === undefined
				? {}
				: { attenuationDistance: m.volume.attenuationDistance }),
		};
	}
	if (m.iridescence !== undefined) {
		const i =
			typeof m.iridescence === "number"
				? { factor: m.iridescence }
				: m.iridescence;
		check("iridescence", i.factor);
		ext.KHR_materials_iridescence = {
			iridescenceFactor: i.factor,
			...(i.ior === undefined ? {} : { iridescenceIor: i.ior }),
			...(i.thickness
				? {
						iridescenceThicknessMinimum: i.thickness[0],
						iridescenceThicknessMaximum: i.thickness[1],
					}
				: {}),
		};
	}
	if (m.anisotropy) {
		check("anisotropy", m.anisotropy.strength);
		ext.KHR_materials_anisotropy = {
			anisotropyStrength: m.anisotropy.strength,
			...(m.anisotropy.rotation
				? { anisotropyRotation: (m.anisotropy.rotation * Math.PI) / 180 }
				: {}),
		};
	}
	if (Object.keys(ext).length) json.extensions = ext;
	return { json, extensions: [...Object.keys(ext), ...used] };
}
