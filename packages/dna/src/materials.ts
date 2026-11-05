/**
 * Materials for the meshes a DNA head or body is made of. Each mesh plays a
 * role, found from its name (`head_lod0_mesh` is skin, `eyeshell_lod0_mesh`
 * the clear film over an eye, …), and each role has a material built from
 * what the engine renders: skin with subsurface scattering, wet teeth,
 * clear glass, thin transparent films, alpha-tested lashes.
 *
 * `dnaMaterials(doc, folder)` also looks for the export's textures in a
 * folder, by the role and map words in their file names (`head_color`,
 * `head_normal`, `head_roughness`, `head_cavity`, …). The names a real
 * export uses are not confirmed yet: what it finds is reported, so a
 * mismatch is easy to see and to fix with `materials`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
	GltfDocument,
	MaterialSpec,
	TextureRef,
} from "@framefields/forge";

export type MeshRole =
	| "skin"
	| "teeth"
	| "saliva"
	| "eye"
	| "eyeshell"
	| "eyeEdge"
	| "eyelashes"
	| "cartilage";

/** Mesh name patterns, most specific first. */
const ROLES: [RegExp, MeshRole][] = [
	[/eye_?shell/i, "eyeshell"],
	[/eye_?edge|tear/i, "eyeEdge"],
	[/eye_?lash|lashes/i, "eyelashes"],
	[/eye_?(left|right|l|r)\b|^eye/i, "eye"],
	[/saliva/i, "saliva"],
	[/teeth|tooth|tongue|mouth/i, "teeth"],
	[/cartilage/i, "cartilage"],
];

/** The role a mesh plays, from its name; skin when nothing else fits. */
export function meshRole(mesh: string): MeshRole {
	return ROLES.find(([pattern]) => pattern.test(mesh))?.[1] ?? "skin";
}

export interface RoleTextures {
	color?: TextureRef;
	normal?: TextureRef;
	roughness?: TextureRef;
	occlusion?: TextureRef;
}

/** A role's material, with whatever textures were found for it. */
export function roleMaterial(
	role: MeshRole,
	t: RoleTextures = {},
): MaterialSpec {
	const maps: MaterialSpec = {
		...(t.color ? { colorTexture: t.color } : {}),
		...(t.normal ? { normalTexture: t.normal } : {}),
		// A grayscale roughness map: glTF reads roughness from green and metal from blue, so metal is kept off.
		...(t.roughness
			? { metallicRoughnessTexture: t.roughness, metallic: 0, roughness: 1 }
			: {}),
		...(t.occlusion ? { occlusionTexture: t.occlusion } : {}),
	};
	switch (role) {
		case "skin":
			return {
				color: t.color ? "#ffffff" : "#d2a98f",
				roughness: 0.5,
				subsurface: { factor: 0.7, color: "#ff5a3c" },
				...maps,
			};
		case "teeth":
			return {
				color: t.color ? "#ffffff" : "#e8dccb",
				roughness: 0.3,
				subsurface: { factor: 0.5, color: "#ff8070" },
				...maps,
			};
		case "eye":
			return {
				color: t.color ? "#ffffff" : "#d8d4cf",
				roughness: 0.2,
				clearcoat: { factor: 1, roughness: 0.03 },
				...maps,
			};
		// The clear film over the eye: refracts what is under it.
		case "eyeshell":
			return {
				color: "#ffffff",
				roughness: 0.02,
				transmission: 1,
				ior: 1.376,
				volume: { thickness: 0.05 },
			};
		// Thin wet films and the soft blend where lid meets eye.
		case "saliva":
			return { color: "#ffffff80", roughness: 0.05, alphaMode: "blend" };
		case "eyeEdge":
			return { color: "#ffffff30", roughness: 0.1, alphaMode: "blend" };
		case "cartilage":
			return { color: "#e0a8a060", roughness: 0.3, alphaMode: "blend" };
		case "eyelashes":
			return {
				color: t.color ? "#ffffff" : "#1a1410",
				roughness: 0.6,
				doubleSided: true,
				...(t.color
					? { colorTexture: t.color, alphaMode: "mask", alphaCutoff: 0.5 }
					: {}),
			};
	}
}

/** File name words per role (what a texture's name must mention) and per map. */
const ROLE_WORDS: Record<MeshRole, RegExp> = {
	skin: /head|face|body/i,
	teeth: /teeth|tooth/i,
	saliva: /saliva/i,
	eye: /eye(?!lash|shell|edge)/i,
	eyeshell: /eyeshell/i,
	eyeEdge: /eyeedge/i,
	eyelashes: /lash/i,
	cartilage: /cartilage/i,
};
const MAP_WORDS: [keyof RoleTextures, RegExp][] = [
	["normal", /normal|nrm|_n\b/i],
	["roughness", /rough/i],
	["occlusion", /cavity|occlusion|\bao\b/i],
	["color", /color|colour|albedo|diffuse|base/i],
];
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MIME: Record<string, "image/png" | "image/jpeg" | "image/webp"> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
};

export interface FoundTextures {
	/** Which file each role's map came from. */
	found: Partial<Record<MeshRole, Partial<Record<keyof RoleTextures, string>>>>;
	/** Images that matched no role and map. */
	unused: string[];
	/** A material per mesh, for `dnaToGlb` / `addDna`'s `materials`. */
	materials: (mesh: string) => MaterialSpec;
}

/**
 * Finds the export's textures in `folder` (PNG, JPEG, WebP), adds them to
 * `doc`, and returns a material per mesh role. Wrinkle maps and masks
 * (animated maps) are left for the rig evaluation. A texture name naming
 * several maps counts for the first that fits, in the order normal,
 * roughness, cavity, color.
 */
export async function dnaMaterials(
	doc: GltfDocument,
	folder: string,
): Promise<FoundTextures> {
	const files = (await readdir(folder)).filter((f) => IMAGE.test(f)).sort();
	const found: FoundTextures["found"] = {};
	const refs: Partial<Record<MeshRole, RoleTextures>> = {};
	const unused: string[] = [];
	for (const file of files) {
		const base = path.basename(file, path.extname(file));
		if (/wrinkle|mask|_wm\d/i.test(base)) {
			unused.push(file);
			continue;
		}
		const role =
			(Object.keys(ROLE_WORDS) as MeshRole[]).find(
				(r) => r !== "skin" && ROLE_WORDS[r].test(base),
			) ?? (ROLE_WORDS.skin.test(base) ? "skin" : undefined);
		const map = MAP_WORDS.find(([, w]) => w.test(base))?.[0];
		if (!role || !map || found[role]?.[map]) {
			unused.push(file);
			continue;
		}
		const image = new Uint8Array(await readFile(path.join(folder, file)));
		const ref = doc.addTexture({
			image,
			mimeType: MIME[path.extname(file).toLowerCase()] ?? "image/png",
		});
		refs[role] = { ...refs[role], [map]: ref };
		found[role] = { ...found[role], [map]: file };
	}
	return {
		found,
		unused,
		materials: (mesh) => {
			const role = meshRole(mesh);
			return roleMaterial(role, refs[role]);
		},
	};
}
