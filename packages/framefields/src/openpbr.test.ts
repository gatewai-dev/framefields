import { describe, expect, it } from "vitest";
import { linearToCss, openPBR, parseMtlx, standardSurface } from "./openpbr.js";

describe("OpenPBR", () => {
	it("maps base, coat, fuzz, film and emission onto surface props", () => {
		const m = openPBR({
			base_color: [1, 0, 0],
			base_weight: 0.5,
			base_metalness: 0.2,
			specular_roughness: 0.4,
			specular_roughness_anisotropy: 0.6,
			coat_weight: 1,
			coat_roughness: 0.05,
			fuzz_weight: 0.5,
			fuzz_color: [1, 1, 1],
			thin_film_weight: 1,
			thin_film_thickness: 0.4,
			emission_luminance: 300,
			emission_color: [0, 0, 1],
		});
		expect(m).toMatchObject({
			color: linearToCss([0.5, 0, 0]),
			metallic: 0.2,
			roughness: 0.4,
			anisotropy: 0.6,
			clearcoat: 1,
			clearcoatRoughness: 0.05,
			sheen: 0.5,
			sheenColor: "#ffffff",
			iridescence: { intensity: 1, thickness: 400, ior: 1.4 },
			emissive: "#0000ff",
			emissiveIntensity: 3,
		});
		// Linear 0.5 is display 188 (#bc).
		expect(linearToCss([0.5, 0.5, 0.5])).toBe("#bcbcbc");
	});

	it("turns transmission into glass, frosted when rough", () => {
		expect(
			openPBR({ transmission_weight: 1, specular_ior: 1.33 }),
		).toMatchObject({ material: "frosted", ior: 1.33 });
		expect(
			openPBR({ transmission_weight: 1, specular_roughness: 0 }),
		).toMatchObject({ material: "glass", ior: 1.5 });
		expect(openPBR({ transmission_weight: 0.2 }).material).toBeUndefined();
	});

	it("reads Standard Surface through its OpenPBR counterparts", () => {
		expect(
			standardSurface({
				base: 1,
				base_color: [0, 1, 0],
				metalness: 1,
				coat: 0.5,
				thin_film_thickness: 300,
			}),
		).toMatchObject({
			color: "#00ff00",
			metallic: 1,
			clearcoat: 0.5,
			iridescence: { thickness: 300 },
		});
	});
});

const DOC = `<?xml version="1.0"?>
<materialx version="1.39" fileprefix="textures/">
  <!-- a lacquered red with a wood map -->
  <nodegraph name="NG_wood">
    <tiledimage name="wood" type="color3">
      <input name="file" type="filename" value="wood.png" />
    </tiledimage>
    <output name="out" type="color3" nodename="wood" />
  </nodegraph>
  <image name="rough_map" type="float">
    <input name="file" type="filename" value="rough.png" />
  </image>
  <open_pbr_surface name="SR_table" type="surfaceshader">
    <input name="base_color" type="color3" nodegraph="NG_wood" output="out" />
    <input name="specular_roughness" type="float" nodename="rough_map" />
    <input name="coat_weight" type="float" value="1" />
    <input name="geometry_normal" type="vector3" value="0, 0, 1" />
  </open_pbr_surface>
  <surfacematerial name="M_table" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="SR_table" />
  </surfacematerial>
  <standard_surface name="SR_chrome" type="surfaceshader">
    <input name="base_color" type="color3" value="0.9, 0.9, 0.9" />
    <input name="metalness" type="float" value="1" />
    <input name="specular_roughness" type="float" value="0.1" />
  </standard_surface>
</materialx>`;

describe("parseMtlx", () => {
	it("reads materials, follows the base color map and reports what it skips", () => {
		const m = parseMtlx(DOC, { baseDir: "assets/table" });
		expect(Object.keys(m).sort()).toEqual(["M_table", "SR_chrome"]);
		expect(m.M_table).toMatchObject({
			surface: "open_pbr_surface",
			props: { texture: "assets/table/textures/wood.png", clearcoat: 1 },
		});
		expect(m.M_table?.unsupported).toEqual([
			"specular_roughness (connected to rough_map)",
			"geometry_normal",
		]);
		expect(m.SR_chrome).toMatchObject({
			surface: "standard_surface",
			props: {
				metallic: 1,
				roughness: 0.1,
				color: linearToCss([0.9, 0.9, 0.9]),
			},
			unsupported: [],
		});
	});

	it("rejects a document without <materialx>", () => {
		expect(() => parseMtlx("<root/>")).toThrow(/materialx/);
	});
});
