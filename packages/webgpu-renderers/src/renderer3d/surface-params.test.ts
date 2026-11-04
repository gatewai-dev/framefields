import { describe, expect, it } from "vitest";
import { packSurfaceParams, SURFACE_PARAMS_FLOATS } from "./surface-params.js";

function pack(params: Parameters<typeof packSurfaceParams>[0]): Float32Array {
	const out = new Float32Array(SURFACE_PARAMS_FLOATS + 4).fill(-7);
	packSurfaceParams(params, out, 2);
	return out;
}

describe("packSurfaceParams Substrate lobes", () => {
	it("packs neutral lobes when nothing is set and stays inside its slot", () => {
		const out = pack({});
		expect(out[0]).toBe(-7);
		expect(out[1]).toBe(-7);
		expect(out[2 + SURFACE_PARAMS_FLOATS]).toBe(-7);
		const at = (i: number) => out[2 + i];
		expect(at(20)).toBe(0); // clearcoat
		expect(at(21)).toBeCloseTo(0.08); // clearcoatRoughness
		expect(at(22)).toBe(0); // anisotropy
		expect(at(24)).toBe(0); // subsurface
		expect(at(28)).toBe(0); // sheen
		expect(at(32)).toBe(0); // iridescence
		expect(at(35)).toBe(0); // triplanar off
	});

	it("packs every lobe, clamping out-of-range input", () => {
		const out = pack({
			clearcoat: 2,
			clearcoatRoughness: 0,
			anisotropy: -3,
			anisotropyRotation: 90,
			subsurface: 0.5,
			subsurfaceColor: [0.1, 0.2, 0.3],
			sheen: 0.75,
			sheenColor: "#ff0000",
			sheenRoughness: 0,
			iridescence: { intensity: 0.4, thickness: 5000, ior: 1.6 },
			triplanar: { scale: 2, sharpness: 40 },
		});
		const at = (i: number) => out[2 + i] ?? Number.NaN;
		expect(at(20)).toBe(1);
		expect(at(21)).toBeCloseTo(0.03);
		expect(at(22)).toBe(-1);
		expect(at(23)).toBeCloseTo(Math.PI / 2);
		expect([at(24), at(25), at(26), at(27)].map((v) => +v.toFixed(3))).toEqual([
			0.5, 0.1, 0.2, 0.3,
		]);
		expect([at(28), at(29), at(30), at(31)]).toEqual([0.75, 1, 0, 0]);
		expect(at(18)).toBeCloseTo(0.05); // sheenRoughness floor
		expect(at(19)).toBe(16); // triplanar sharpness ceiling
		expect(at(32)).toBeCloseTo(0.4);
		expect(at(33)).toBe(1200);
		expect(at(34)).toBeCloseTo(1.6);
		expect(at(35)).toBeCloseTo(2 / 256);
	});

	it("lets flat props override the object forms", () => {
		const out = pack({
			iridescence: { intensity: 1, thickness: 300 },
			iridescenceThickness: 650,
			iridescenceIor: 1.2,
			triplanar: true,
			triplanarScale: 4,
			triplanarSharpness: 2,
		});
		const at = (i: number) => out[2 + i];
		expect(at(32)).toBe(1);
		expect(at(33)).toBe(650);
		expect(at(34)).toBeCloseTo(1.2);
		expect(at(35)).toBeCloseTo(4 / 256);
		expect(at(19)).toBe(2);
	});
});
