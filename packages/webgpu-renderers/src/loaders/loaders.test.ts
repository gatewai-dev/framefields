import { describe, expect, it } from "vitest";
import { parseOBJ, parseMTL } from "./obj-loader.js";
import { parseFBX } from "./fbx-loader.js";

describe("3D Model Parsers (OBJ & FBX)", () => {
	it("parses Wavefront OBJ and MTL definitions with material properties", () => {
		const mtlText = `
newmtl GoldMaterial
Ka 0.2 0.2 0.2
Kd 0.8 0.6 0.2
Ks 1.0 1.0 1.0
Ns 128.0
d 1.0
illum 2
`;
		const materials = parseMTL(mtlText);
		expect(materials.GoldMaterial).toBeDefined();
		expect(materials.GoldMaterial.diffuseColor).toEqual([0.8, 0.6, 0.2, 1.0]);
		expect(materials.GoldMaterial.shininess).toBe(128.0);
		expect(materials.GoldMaterial.specularIntensity).toBe(1.0);

		const objText = `
# Sample Cube
mtllib sample.mtl
usemtl GoldMaterial
v -1.0 -1.0 1.0
v 1.0 -1.0 1.0
v 1.0 1.0 1.0
v -1.0 1.0 1.0
vn 0.0 0.0 1.0
vt 0.0 0.0
vt 1.0 0.0
vt 1.0 1.0
vt 0.0 1.0
f 1/1/1 2/2/1 3/3/1 4/4/1
`;
		const model = parseOBJ(objText, { mtlText });
		expect(model.meshes.length).toBe(1);
		const mesh = model.meshes[0];
		expect(mesh.materialName).toBe("GoldMaterial");
		// 1 quad triangulated into 2 triangles -> 4 unique indexed vertices, 6 indices
		expect(mesh.indices.length).toBe(6);
		expect(mesh.positions.length).toBe(4 * 3);
		expect(mesh.normals.length).toBe(4 * 3);
		expect(mesh.uvs.length).toBe(4 * 2);
		expect(model.materials.GoldMaterial).toBeDefined();
	});

	it("computes vertex normals for OBJ when normals are omitted", () => {
		const objText = `
v 0.0 1.0 0.0
v -1.0 -1.0 0.0
v 1.0 -1.0 0.0
f 1 2 3
`;
		const model = parseOBJ(objText);
		expect(model.meshes.length).toBe(1);
		const mesh = model.meshes[0];
		expect(mesh.normals.length).toBe(3 * 3);
		// Normal of triangle should be roughly [0, 0, 1] or [0, 0, -1]
		expect(Math.abs(mesh.normals[2])).toBeGreaterThan(0.9);
	});

	it("parses ASCII FBX geometry and animation curves", () => {
		const fbxText = `
; FBX 7.4.0 project file
FBXHeaderExtension: {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}
Objects: {
	Geometry: 100, "Geometry::Box", "Mesh" {
		Vertices: *12 {
			a: -10,-10,0, 10,-10,0, 10,10,0, -10,10,0
		}
		PolygonVertexIndex: *4 {
			a: 0,1,2,-4
		}
		LayerElementNormal: 0 {
			Version: 101
			Normals: *12 {
				a: 0,0,1, 0,0,1, 0,0,1, 0,0,1
			}
		}
	}
	Model: 200, "Model::BoxModel", "Mesh" {
		Properties70: {
			P: "Lcl Translation", "Lcl Translation", "", "A", 0,0,0
		}
	}
	AnimationStack: 300, "AnimStack::Spin", "" {
	}
	AnimationLayer: 400, "AnimLayer::Base", "" {
	}
	AnimationCurveNode: 500, "AnimCurveNode::R", "" {
		Properties70: {
			P: "d|Y", "Number", "", "A", 0
		}
	}
	AnimationCurve: 600, "AnimCurve::", "" {
		KeyTime: *2 {
			a: 0, 46186158000
		}
		KeyValueFloat: *2 {
			a: 0.0, 360.0
		}
	}
}
Connections: {
	C: "OO", 100, 200
	C: "OO", 400, 300
	C: "OO", 500, 400
	C: "OP", 600, 500, "d|Y"
	C: "OP", 500, 200, "Lcl Rotation"
}
`;
		const model = parseFBX(fbxText);
		expect(model.meshes.length).toBe(1);
		const mesh = model.meshes[0];
		expect(mesh.indices.length).toBe(6); // 1 quad = 2 triangles = 6 indices
		expect(model.animations.length).toBe(1);
		const clip = model.animations[0];
		expect(clip.name).toBe("Spin");
		expect(clip.duration).toBeCloseTo(1.0, 1);
		expect(clip.tracks.length).toBe(1);
		expect(clip.tracks[0].rotations).toBeDefined();
	});

	it("parses Binary FBX header and blocks", () => {
		// Create minimal valid binary FBX buffer header
		const magic = Buffer.from("Kaydara FBX Binary  \0\x1a\0", "binary");
		const version = Buffer.alloc(4);
		version.writeUInt32LE(7400, 0);

		// End-of-record null block (13 bytes for 32-bit offset)
		const nullBlock = Buffer.alloc(13, 0);

		const binaryFBX = Buffer.concat([magic, version, nullBlock]);
		const model = parseFBX(binaryFBX);
		expect(model).toBeDefined();
		expect(model.meshes).toEqual([]);
		expect(model.animations).toEqual([]);
	});
});
