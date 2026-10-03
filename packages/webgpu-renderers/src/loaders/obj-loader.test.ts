import { describe, expect, it } from "vitest";
import { ObjLoader } from "./obj-loader.js";

describe("ObjLoader", () => {
	it("parses a basic triangulated cube OBJ", () => {
		const objText = `
# Simple Cube
v -1.0 -1.0  1.0
v  1.0 -1.0  1.0
v -1.0  1.0  1.0
v  1.0  1.0  1.0
v -1.0 -1.0 -1.0
v  1.0 -1.0 -1.0
v -1.0  1.0 -1.0
v  1.0  1.0 -1.0

vn 0.0 0.0 1.0
vn 0.0 0.0 -1.0

vt 0.0 0.0
vt 1.0 0.0
vt 0.0 1.0
vt 1.0 1.0

f 1/1/1 2/2/1 3/3/1
f 3/3/1 2/2/1 4/4/1
f 6/1/2 5/2/2 8/3/2
f 8/3/2 5/2/2 7/4/2
`;

		const model = ObjLoader.parse(objText);
		expect(model.meshes.length).toBe(1);
		const mesh = model.meshes[0]!;
		expect(mesh.indices.length).toBe(12); // 4 triangles * 3 = 12 indices
		expect(mesh.positions.length).toBeGreaterThan(0);
		expect(mesh.normals.length).toBe(mesh.positions.length);
		expect(mesh.uvs.length).toBe((mesh.positions.length / 3) * 2);
		expect(model.bounds.size[0]).toBeCloseTo(2.0, 4);
		expect(model.bounds.size[1]).toBeCloseTo(2.0, 4);
		expect(model.bounds.size[2]).toBeCloseTo(2.0, 4);
	});

	it("automatically triangulates quad and polygon faces", () => {
		const quadObj = `
v 0 0 0
v 10 0 0
v 10 10 0
v 0 10 0
v 5 15 0

# Quad face
f 1 2 3 4
# Pentagon face
f 1 2 3 5 4
`;

		const model = ObjLoader.parse(quadObj);
		const mesh = model.meshes[0]!;
		// Quad -> 2 triangles (6 indices), Pentagon -> 3 triangles (9 indices) => total 15 indices
		expect(mesh.indices.length).toBe(15);
	});

	it("computes smooth vertex normals when normals are omitted", () => {
		const unshadedObj = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;
		const model = ObjLoader.parse(unshadedObj);
		const mesh = model.meshes[0]!;
		expect(mesh.normals.length).toBe(mesh.positions.length);
		// Normal should be pointing along +Z: (0, 0, 1)
		expect(mesh.normals[0]).toBeCloseTo(0, 4);
		expect(mesh.normals[1]).toBeCloseTo(0, 4);
		expect(mesh.normals[2]).toBeCloseTo(1, 4);
	});

	it("handles centering and normalization options", () => {
		const offCenterObj = `
v 100 200 300
v 150 200 300
v 100 250 300
f 1 2 3
`;
		const model = ObjLoader.parse(offCenterObj, undefined, {
			center: true,
			normalizeSize: 10,
		});
		expect(model.bounds.center[0]).toBeCloseTo(0, 4);
		expect(model.bounds.center[1]).toBeCloseTo(0, 4);
		expect(model.bounds.center[2]).toBeCloseTo(0, 4);
		expect(Math.max(...model.bounds.size)).toBeCloseTo(10, 4);
	});

	it("parses MTL materials and assigns to submeshes", () => {
		const objWithMtl = `
mtllib materials.mtl
usemtl Metal
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3

usemtl Glass
v 2 0 0
v 3 0 0
v 2 1 0
f 4 5 6
`;

		const mtlText = `
newmtl Metal
Kd 0.8 0.8 0.9
Ks 1.0 1.0 1.0
Ns 128
d 1.0

newmtl Glass
Kd 0.2 0.4 0.6
d 0.5
map_Kd glass_diffuse.png
`;

		const model = ObjLoader.parse(objWithMtl, mtlText);
		expect(model.meshes.length).toBe(2);
		expect(model.materials["Metal"]?.shininess).toBe(128);
		expect(model.materials["Glass"]?.opacity).toBe(0.5);
		expect(model.materials["Glass"]?.diffuseTexture).toBe("glass_diffuse.png");
	});
});
