/**
 * Writes a `human()` into a document in one call: skeleton, skinned body,
 * textured eyeballs, glass corneas and the rig's drivers, each part with a
 * material you can override.
 */
import type {
	GltfDocument,
	MaterialRef,
	NodeRef,
	SkeletonRefs,
} from "../document.js";
import type { MaterialSpec } from "../material.js";
import type { HumanModel, HumanPart } from "./human.js";
import { type SkinOptions, skinTextures } from "./skin.js";

export interface AddHumanOptions {
	/** Node name. Default "Human". */
	name?: string;
	/**
	 * Skin material. Default: a warm skin with subsurface scattering. Its
	 * `color` and `roughness` seed the baked skin textures; maps it sets
	 * itself win over the baked ones.
	 */
	skin?: MaterialSpec;
	/**
	 * Baked skin textures (`skinTextures`): color with blush, lips and
	 * mottling, roughness, and tiling pores. `false` leaves the skin a flat
	 * color. Default: baked with the skin's color.
	 */
	skinTextures?: SkinOptions | false;
	/** Eyeball material; its color texture defaults to the model's eye texture. */
	eyes?: MaterialSpec;
	/** Cornea material. Default: clear glass (IOR 1.376, 3 mm deep). */
	cornea?: MaterialSpec;
	/** Teeth and tongue material. Default: a wet, slightly translucent ivory. */
	mouth?: MaterialSpec;
}

export interface AddedHuman {
	rig: SkeletonRefs;
	nodes: { body: NodeRef; eyes: NodeRef; cornea: NodeRef; mouth: NodeRef };
	materials: {
		skin: MaterialRef;
		eyes: MaterialRef;
		cornea: MaterialRef;
		mouth: MaterialRef;
	};
}

export function addHuman(
	doc: GltfDocument,
	h: HumanModel,
	options: AddHumanOptions = {},
): AddedHuman {
	const name = options.name ?? "Human";
	const rig = doc.addSkeleton(h.skeleton);
	const skinSpec: MaterialSpec = options.skin ?? {
		name: `${name}Skin`,
		color: "#d9b29a",
		roughness: 0.5,
		subsurface: { factor: 0.7, color: "#ff6a4a" },
	};
	const skin = doc.addMaterial(
		options.skinTextures === false
			? skinSpec
			: texturedSkin(doc, h, skinSpec, options.skinTextures ?? {}),
	);
	const eyes = doc.addMaterial({
		name: `${name}Eyes`,
		roughness: 0.4,
		subsurface: { factor: 0.3, color: "#ff8a7a" },
		...options.eyes,
		colorTexture:
			options.eyes?.colorTexture ??
			doc.addTexture({ image: h.eyeTexture, mimeType: "image/png" }),
	});
	const cornea = doc.addMaterial(
		options.cornea ?? {
			name: `${name}Cornea`,
			color: "#ffffff",
			roughness: 0.02,
			transmission: 1,
			ior: 1.376,
			volume: { thickness: 0.3 },
		},
	);
	const mouth = doc.addMaterial(
		options.mouth ?? {
			name: `${name}Mouth`,
			color: "#e8dccb",
			roughness: 0.3,
			subsurface: { factor: 0.5, color: "#ff8070" },
		},
	);
	const part = (part: string, primitive: HumanPart, material: MaterialRef) =>
		doc.addNode({
			name: `${name}${part}`,
			mesh: doc.addMesh({
				name: `${name}${part}`,
				primitives: [{ ...primitive, material }],
			}),
			skin: rig.skin,
		});
	const nodes = {
		body: part("Body", h.body, skin),
		eyes: part("Eyes", h.eyes, eyes),
		cornea: part("Cornea", h.cornea, cornea),
		mouth: part("Mouth", h.mouth, mouth),
	};
	for (const d of h.drivers) doc.addDriver(d);
	return { rig, nodes, materials: { skin, eyes, cornea, mouth } };
}

/** The skin spec with baked maps in the slots it leaves empty. */
function texturedSkin(
	doc: GltfDocument,
	h: HumanModel,
	spec: MaterialSpec,
	options: SkinOptions,
): MaterialSpec {
	const maps = skinTextures(h, {
		color: spec.color ?? "#d9b29a",
		roughness: spec.roughness ?? 0.5,
		...options,
	});
	const png = (image: Uint8Array) =>
		doc.addTexture({ image, mimeType: "image/png" });
	const repeat = maps.detailRepeat;
	return {
		...spec,
		// The maps carry the color and roughness; the factors pass them through.
		color: spec.colorTexture ? spec.color : "#ffffff",
		roughness: spec.metallicRoughnessTexture ? spec.roughness : 1,
		metallic: 0,
		colorTexture: spec.colorTexture ?? png(maps.color),
		metallicRoughnessTexture:
			spec.metallicRoughnessTexture ?? png(maps.roughness),
		normalTexture: spec.normalTexture ?? {
			texture: png(maps.detail),
			scale: 0.45,
			transform: { scale: [repeat, repeat] },
		},
	};
}
