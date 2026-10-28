import { describe, expect, it } from "vitest";
import { sampleMorphWeights } from "./pose.js";
import type { AnimationClip3D, Mesh3DData } from "./types.js";

const mesh: Mesh3DData = {
	positions: new Float32Array(3),
	normals: new Float32Array(3),
	uvs: new Float32Array(2),
	indices: new Uint16Array(),
	node: 1,
	morphTargets: [{}, {}, {}, {}],
	morphWeights: [0.1, 0.2, 0.3, 0.4],
};
function clip(
	interpolation: "linear" | "step" | "cubic",
	values: number[],
): AnimationClip3D {
	return {
		name: "clip",
		duration: 1,
		fps: 30,
		tracks: [
			{
				nodeName: "mesh",
				node: 1,
				times: new Float32Array([0, 1]),
				weights: new Float32Array(values),
				interpolation,
			},
		],
	};
}
describe("morph weight animation", () => {
	it("uses the mesh instance defaults without a track", () => {
		expect(sampleMorphWeights(mesh, undefined, 0)).toEqual([
			0.1, 0.2, 0.3, 0.4,
		]);
	});
	it("interpolates four weights independently, not as a quaternion", () => {
		const animation = clip("linear", [0, 0, 0, 0, 1, 1, 1, 1]);
		expect(sampleMorphWeights(mesh, animation, 0.5)).toEqual([
			0.5, 0.5, 0.5, 0.5,
		]);
	});
	it("holds STEP and evaluates CUBICSPLINE weights", () => {
		expect(
			sampleMorphWeights(mesh, clip("step", [0, 0, 0, 0, 1, 1, 1, 1]), 0.5),
		).toEqual([0, 0, 0, 0]);
		const values = [
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,
		];
		expect(sampleMorphWeights(mesh, clip("cubic", values), 0.5)).toEqual([
			0.5, 0.5, 0.5, 0.5,
		]);
	});
});
