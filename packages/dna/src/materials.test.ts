/**
 * Mesh roles come from DNA mesh names, each role has a material the engine
 * renders, and an export folder's textures land on the right roles.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodePng, GltfDocument } from "@framefields/forge";
import { describe, expect, it } from "vitest";
import { dnaMaterials, meshRole, roleMaterial } from "./index.js";

describe("meshRole", () => {
	it("names the role of each head mesh", () => {
		const roles = Object.fromEntries(
			[
				"head_lod0_mesh",
				"teeth_lod0_mesh",
				"saliva_lod0_mesh",
				"eyeLeft_lod0_mesh",
				"eyeRight_lod0_mesh",
				"eyeshell_lod0_mesh",
				"eyelashes_lod0_mesh",
				"eyeEdge_lod0_mesh",
				"cartilage_lod0_mesh",
				"body_lod0_mesh",
			].map((n) => [n, meshRole(n)]),
		);
		expect(roles).toEqual({
			head_lod0_mesh: "skin",
			teeth_lod0_mesh: "teeth",
			saliva_lod0_mesh: "saliva",
			eyeLeft_lod0_mesh: "eye",
			eyeRight_lod0_mesh: "eye",
			eyeshell_lod0_mesh: "eyeshell",
			eyelashes_lod0_mesh: "eyelashes",
			eyeEdge_lod0_mesh: "eyeEdge",
			cartilage_lod0_mesh: "cartilage",
			body_lod0_mesh: "skin",
		});
	});

	it("gives clear and thin layers materials that let what is under them show", () => {
		expect(roleMaterial("eyeshell").transmission).toBe(1);
		for (const role of ["saliva", "eyeEdge", "cartilage"] as const)
			expect(roleMaterial(role).alphaMode).toBe("blend");
		expect(roleMaterial("eyelashes").doubleSided).toBe(true);
	});
});

describe("dnaMaterials", () => {
	it("puts an export folder's textures on their roles and reports the rest", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "framefields-dna-tex-"));
		const png = encodePng(new Uint8Array(4 * 4 * 4).fill(128), 4, 4);
		const files = [
			"head_color_map.png",
			"head_normal_map.png",
			"head_roughness_map.png",
			"head_cavity_map.png",
			"head_wm1_normal_map.png",
			"teeth_color_map.png",
			"eyes_color_map.png",
			"eyelashes_color.png",
			"notes.txt",
		];
		for (const f of files) await writeFile(path.join(dir, f), png);
		try {
			const doc = new GltfDocument();
			const t = await dnaMaterials(doc, dir);
			expect(t.found).toEqual({
				skin: {
					color: "head_color_map.png",
					normal: "head_normal_map.png",
					roughness: "head_roughness_map.png",
					occlusion: "head_cavity_map.png",
				},
				teeth: { color: "teeth_color_map.png" },
				eye: { color: "eyes_color_map.png" },
				eyelashes: { color: "eyelashes_color.png" },
			});
			expect(t.unused).toEqual(["head_wm1_normal_map.png"]);
			const head = t.materials("head_lod0_mesh");
			expect(
				[head.colorTexture, head.normalTexture, head.occlusionTexture].every(
					Boolean,
				),
			).toBe(true);
			// Roughness from the map's green channel; no metal from its blue.
			expect([head.metallic, head.roughness]).toEqual([0, 1]);
			expect(t.materials("eyelashes_lod0_mesh").alphaMode).toBe("mask");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
