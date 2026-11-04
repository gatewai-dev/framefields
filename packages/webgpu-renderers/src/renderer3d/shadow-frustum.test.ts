import { describe, expect, it } from "vitest";
import { Light3D } from "../math3d/light3d.js";
import type { Mat4 } from "../math3d/matrix4.js";
import {
	type Aabb,
	fitPointShadowFrusta,
	fitShadowFrustum,
	transformAabb,
} from "./shadow-frustum.js";

function project(m: Mat4, p: [number, number, number]) {
	const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
	const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
	const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
	const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
	return [x / w, y / w, z / w];
}

const box = (cx: number, cy: number, cz: number, r: number): Aabb => ({
	min: [cx - r, cy - r, cz - r],
	max: [cx + r, cy + r, cz + r],
});

describe("fitShadowFrustum", () => {
	it("fits a directional light tightly around casters, deep enough for receivers", () => {
		const caster = box(0, 0, 0, 100);
		const floor: Aabb = { min: [-5000, 200, -5000], max: [5000, 210, 5000] };
		const f = fitShadowFrustum(
			{ type: "directional", position: [0, -1000, 0], direction: [0, 1, 0] },
			[caster],
			[caster, floor],
			2048,
		);
		expect(f).not.toBeNull();
		for (const p of [caster.min, caster.max]) {
			const [x, y, z] = project(f!.viewProj, p as [number, number, number]);
			expect(Math.abs(x)).toBeLessThanOrEqual(1);
			expect(Math.abs(y)).toBeLessThanOrEqual(1);
			expect(z).toBeGreaterThanOrEqual(0);
			expect(z).toBeLessThanOrEqual(1);
		}
		// The floor below the caster is inside the depth range, and farther.
		const [, , floorZ] = project(f!.viewProj, [0, 205, 0]);
		const [, , casterZ] = project(f!.viewProj, [0, 0, 0]);
		expect(floorZ).toBeLessThanOrEqual(1);
		expect(floorZ).toBeGreaterThan(casterZ);
		// Texels go to the caster, not the 10000 px floor.
		expect(f!.texelWorldSize).toBeLessThan(0.2);
	});

	it("aims a spot light's perspective frustum along its direction", () => {
		const caster = box(0, 0, 500, 50);
		const f = fitShadowFrustum(
			{ type: "spot", position: [0, 0, 0], direction: [0, 0, 1], angle: 30 },
			[caster],
			[caster],
			1024,
		);
		const [x, y, z] = project(f!.viewProj, [0, 0, 500]);
		expect(Math.abs(x)).toBeLessThan(1e-6);
		expect(Math.abs(y)).toBeLessThan(1e-6);
		expect(z).toBeGreaterThan(0);
		expect(z).toBeLessThan(1);
	});

	it("returns null without casters", () => {
		expect(
			fitShadowFrustum(
				{ type: "directional", position: [0, 0, 0], direction: [0, 1, 0] },
				[],
				[],
				1024,
			),
		).toBeNull();
	});

	it("transforms bounds by a model matrix", () => {
		const m: Mat4 = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 20, 30, 1];
		expect(transformAabb({ min: [-1, -1, -1], max: [1, 1, 1] }, m)).toEqual({
			min: [8, 18, 28],
			max: [12, 22, 32],
		});
	});
});

describe("Light3D physical block", () => {
	it("switches on physical shading and tone mapping only with an environment", () => {
		const legacy = Light3D.packLightsUniforms([
			{ type: "ambient", intensity: 1 },
		]);
		expect(legacy[6]).toBe(0);
		const physical = Light3D.packLightsUniforms([], { preset: "studio" });
		expect(physical[5]).toBe(1); // lit even with no lights
		expect(physical[6]).toBe(1);
		expect(physical[7]).toBe(3); // neutral by default
		const agx = Light3D.packLightsUniforms([], {
			toneMapping: "agx",
			exposure: 1,
		});
		expect(agx[7]).toBe(2);
		expect(agx[8 + 8 * 16 + 3]).toBeCloseTo(2); // exposure +1 stop
	});

	it("indexes the shadow light among non-ambient lights (including point and rect)", () => {
		const lights = [
			{ type: "ambient" as const },
			{ type: "point" as const },
			{ type: "directional" as const, castShadow: true },
		];
		expect(Light3D.shadowCasterIndex(lights)).toBe(1);
		expect(
			Light3D.shadowCasterIndex([{ type: "point" as const, castShadow: true }]),
		).toBe(0);
		expect(
			Light3D.shadowCasterIndex([{ type: "rect" as const, castShadow: true }]),
		).toBe(0);
	});

	it("packs rect area light orthonormal basis and half-dimensions into direct lights", () => {
		const packed = Light3D.packDirectLights([
			{
				type: "rect",
				x: 100,
				y: 200,
				z: -300,
				targetX: 100,
				targetY: 200,
				targetZ: 0,
				width: 400,
				height: 160,
				twoSided: true,
			},
		]);
		expect(packed[3]).toBe(4); // type = 4 (rect)
		expect(packed[15]).toBe(1); // twoSided = 1
		expect(packed[43]).toBeCloseTo(200); // halfWidth = 200
		expect(packed[47]).toBeCloseTo(80); // halfHeight = 80
	});

	it("fits 6 cube-face frusta for omnidirectional point light shadows", () => {
		const casterPosX = box(300, 0, 0, 40);
		const casterNegZ = box(0, 0, -400, 40);
		const frusta = fitPointShadowFrusta(
			[0, 0, 0],
			1000,
			[casterPosX, casterNegZ],
			[casterPosX, casterNegZ],
			1024,
		);
		expect(frusta).not.toBeNull();
		if (!frusta) throw new Error("expected frusta");
		expect(frusta.viewProjs).toHaveLength(6);
		// Face 0 (+X) sees casterPosX at the center of its frustum
		const [x0, y0, z0] = project(frusta.viewProjs[0], [300, 0, 0]);
		expect(Math.abs(x0)).toBeLessThan(1e-5);
		expect(Math.abs(y0)).toBeLessThan(1e-5);
		expect(z0).toBeGreaterThan(0);
		expect(z0).toBeLessThan(1);
		// Face 5 (-Z) sees casterNegZ at the center of its frustum
		const [x5, y5, z5] = project(frusta.viewProjs[5], [0, 0, -400]);
		expect(Math.abs(x5)).toBeLessThan(1e-5);
		expect(Math.abs(y5)).toBeLessThan(1e-5);
		expect(z5).toBeGreaterThan(0);
		expect(z5).toBeLessThan(1);
	});
});
