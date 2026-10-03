import { describe, expect, it } from "vitest";
import { Light3D, parseColorToRgb, LIGHT_UNIFORM_SIZE_BYTES } from "./light3d.js";
import { Matrix4Math } from "./matrix4.js";

describe("Light3D Mathematical Core & GPU Uniform Packing", () => {
	it("parses hex, rgb, and hsl colors correctly into normalized [r, g, b]", () => {
		expect(parseColorToRgb("#ffffff")).toEqual([1, 1, 1]);
		expect(parseColorToRgb("#000000")).toEqual([0, 0, 0]);
		expect(parseColorToRgb("#ff0000")).toEqual([1, 0, 0]);
		expect(parseColorToRgb("#3b82f6")).toEqual([
			59 / 255,
			130 / 255,
			246 / 255,
		]);
		expect(parseColorToRgb("rgb(255, 128, 0)")).toEqual([1, 128 / 255, 0]);
		expect(parseColorToRgb("hsl(0, 100%, 50%)")).toEqual([1, 0, 0]);
	});

	it("computes normal matrix from model matrix with non-uniform scaling", () => {
		// Model matrix: Translate(100, 200, 300) * Scale(2, 5, 10)
		let m = Matrix4Math.translate(100, 200, 300);
		m = Matrix4Math.multiply(m, Matrix4Math.scale(2, 5, 10));

		const normMat = Light3D.computeNormalMatrix(m);
		expect(normMat).toBeDefined();

		// Scale components should be inverted: 1/2 = 0.5, 1/5 = 0.2, 1/10 = 0.1
		expect(normMat[0]).toBeCloseTo(0.5, 3);
		expect(normMat[5]).toBeCloseTo(0.2, 3);
		expect(normMat[10]).toBeCloseTo(0.1, 3);
	});

	it("packs unlit uniform buffer when no lights are provided", () => {
		const buf = Light3D.packLightsUniforms([]);
		expect(buf.byteLength).toBe(LIGHT_UNIFORM_SIZE_BYTES);
		expect(buf[4]).toBe(0); // lightCount = 0
		expect(buf[5]).toBe(0); // hasLights = 0.0 (unlit)
	});

	it("processes and packs ambient, directional, point, and spot lights into binary buffer", () => {
		const lights = [
			{
				lightType: "ambient" as const,
				color: "#ffffff",
				intensity: 0.2,
			},
			{
				lightType: "directional" as const,
				color: "#ffffea",
				intensity: 1.5,
				direction: [0, -1, 1] as [number, number, number],
			},
			{
				lightType: "point" as const,
				x: 400,
				y: 300,
				z: -200,
				color: "#3b82f6",
				intensity: 2.0,
				radius: 800,
			},
			{
				lightType: "spot" as const,
				x: 400,
				y: 100,
				z: -500,
				targetX: 400,
				targetY: 300,
				targetZ: 0,
				color: "#f59e0b",
				intensity: 3.0,
				angle: 30,
				penumbra: 0.25,
				radius: 1200,
			},
		];

		const buf = Light3D.packLightsUniforms(lights);
		expect(buf.byteLength).toBe(LIGHT_UNIFORM_SIZE_BYTES);

		// Ambient color: 0.2, 0.2, 0.2
		expect(buf[0]).toBeCloseTo(0.2, 3);
		expect(buf[1]).toBeCloseTo(0.2, 3);
		expect(buf[2]).toBeCloseTo(0.2, 3);

		// Params: 3 direct lights, hasLights = 1.0
		expect(buf[4]).toBe(3); // direct light count
		expect(buf[5]).toBe(1.0); // hasLights = 1.0

		// Light 0 (Directional)
		const l0Offset = 8;
		expect(buf[l0Offset + 3]).toBe(1.0); // type = 1.0 (directional)
		expect(buf[l0Offset + 11]).toBe(1.5); // intensity = 1.5

		// Light 1 (Point)
		const l1Offset = 8 + 16;
		expect(buf[l1Offset + 0]).toBe(400); // posX
		expect(buf[l1Offset + 1]).toBe(300); // posY
		expect(buf[l1Offset + 2]).toBe(-200); // posZ
		expect(buf[l1Offset + 3]).toBe(2.0); // type = 2.0 (point)
		expect(buf[l1Offset + 7]).toBe(800); // radius = 800
		expect(buf[l1Offset + 11]).toBe(2.0); // intensity = 2.0

		// Light 2 (Spot)
		const l2Offset = 8 + 32;
		expect(buf[l2Offset + 3]).toBe(3.0); // type = 3.0 (spot)
		expect(buf[l2Offset + 7]).toBe(1200); // radius = 1200
		expect(buf[l2Offset + 11]).toBe(3.0); // intensity = 3.0
		// Spot cosOuter: cos(30 deg) = sqrt(3)/2 ~= 0.866
		expect(buf[l2Offset + 12]).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 3);
	});
});
