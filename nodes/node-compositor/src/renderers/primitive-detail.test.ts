import {
	Camera3D,
	getPrimitiveGeometry,
	Matrix4Math,
	type PrimitiveGeometryOptions,
} from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { maxAxisScale, screenDetailModel } from "./primitive-detail.js";

const spec: PrimitiveGeometryOptions = { type: "sphere", radius: 50 };
const model = getPrimitiveGeometry(spec);
const camera = Camera3D.createDefaultCamera(1920, 1080, 50);
const at = (x: number, y: number, z: number, scale = 1) =>
	Matrix4Math.multiply(
		Matrix4Math.translate(x, y, z),
		Matrix4Math.scale(scale, scale, scale),
	);

describe("screenDetailModel", () => {
	it("measures the largest axis scale", () => {
		expect(maxAxisScale(Matrix4Math.scale(2, 5, 3))).toBe(5);
		expect(maxAxisScale(at(10, 20, 30))).toBe(1);
	});

	it("keeps the default mesh while a sphere is small on screen", () => {
		// Far back (about 13 px across the radius): the default 32 is plenty.
		expect(
			screenDetailModel(model, spec, at(960, 540, 3000), camera, 1080),
		).toBe(model);
	});

	it("draws the same sphere finer when it is scaled up or seen closer, sharing meshes", () => {
		const big = screenDetailModel(
			model,
			spec,
			at(960, 540, 0, 8),
			camera,
			1080,
		);
		expect(big).not.toBe(model);
		// 400 px across the radius: 128 segments keep the outline within a quarter pixel.
		expect(big).toBe(getPrimitiveGeometry({ ...spec, segments: 128 }));
		// Taller output: 50 px holds at 32 segments, the same sphere at 2160 px needs 64.
		const hd = screenDetailModel(model, spec, at(960, 540, 0), camera, 1080);
		const uhd = screenDetailModel(model, spec, at(960, 540, 0), camera, 2160);
		expect(hd).toBe(model);
		expect(uhd).toBe(getPrimitiveGeometry({ ...spec, segments: 64 }));
	});
});
