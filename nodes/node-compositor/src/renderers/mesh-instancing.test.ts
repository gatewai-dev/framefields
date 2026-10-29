import { getPrimitiveGeometry } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { compatibleMeshDraws, type MeshDraw } from "./mesh-instancing.js";

const mesh = getPrimitiveGeometry({ type: "sphere", radius: 20 }).meshes[0];
function draw(opts: MeshDraw["opts"] = {}): MeshDraw {
	if (!mesh) throw new Error("Missing test mesh");
	return { kind: "mesh", mesh, opts };
}

describe("automatic mesh instancing eligibility", () => {
	it("accepts different transforms with equal material state", () => {
		expect(
			compatibleMeshDraws(
				draw({ position: [1, 2, 3], colorTint: [1, 0, 0, 1] }),
				draw({ position: [5, 6, 7], colorTint: [1, 0, 0, 1] }),
			),
		).toBe(true);
	});
	it("keeps incompatible materials, transparent meshes and per-object deformation separate", () => {
		expect(
			compatibleMeshDraws(
				draw({ colorTint: [1, 0, 0, 1] }),
				draw({ colorTint: [0, 0, 1, 1] }),
			),
		).toBe(false);
		expect(compatibleMeshDraws(draw(), draw({ transparent: true }))).toBe(
			false,
		);
		expect(compatibleMeshDraws(draw(), draw({ morphWeights: [0.5] }))).toBe(
			false,
		);
		expect(compatibleMeshDraws(draw(), draw({ isSkinned: true }))).toBe(false);
	});
});
