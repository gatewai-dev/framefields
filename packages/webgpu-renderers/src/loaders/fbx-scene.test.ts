import { describe, expect, it } from "vitest";
import { FbxLoader } from "./fbx-loader.js";

/**
 * A quad (control points 0..3) on model "Body" (translated +5 x), skinned
 * to bones "Root" and "Tip" (Tip: child of Root, 10 up, pre-rotated 90° z).
 * UVs and normals are ByPolygonVertex; UVs through an index array. The
 * polygon starts at control point 1, so polygon-vertex and control-point
 * indices differ.
 */
const fbx = `
; FBX 7.4.0 project file
Objects:  {
	Geometry: 1001, "Geometry::Quad", "Mesh" {
		Vertices: *12 {
			a: -10,-10,0, 10,-10,0, 10,10,0, -10,10,0
		}
		PolygonVertexIndex: *4 {
			a: 1,2,3,-1
		}
		LayerElementNormal: 0 {
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "Direct"
			Normals: *12 {
				a: 1,0,0, 0,1,0, 0,0,1, 0,0,-1
			}
		}
		LayerElementUV: 0 {
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "IndexToDirect"
			UV: *8 {
				a: 0,0, 1,0, 1,1, 0,1
			}
			UVIndex: *4 {
				a: 2,3,0,1
			}
		}
	}
	Model: 3001, "Model::Body", "Mesh" {
		Properties70:  {
			P: "Lcl Translation", "Lcl Translation", "", "A",5,0,0
		}
	}
	Model: 3002, "Model::Root", "LimbNode" {
	}
	Model: 3003, "Model::Tip", "LimbNode" {
		Properties70:  {
			P: "PreRotation", "Vector3D", "Vector", "",0,0,90
			P: "Lcl Translation", "Lcl Translation", "", "A",0,10,0
		}
	}
	Deformer: 5001, "Deformer::Skin", "Skin" {
	}
	Deformer: 6001, "SubDeformer::Root", "Cluster" {
		Indexes: *2 {
			a: 0,1
		}
		Weights: *2 {
			a: 1,1
		}
	}
	Deformer: 6002, "SubDeformer::Tip", "Cluster" {
		Indexes: *3 {
			a: 1,2,3
		}
		Weights: *3 {
			a: 0.5,2,1
		}
		Transform: *16 {
			a: 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1
		}
		TransformLink: *16 {
			a: 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,10,0,1
		}
	}
	AnimationStack: 7001, "AnimStack::Wave", "" {
	}
	AnimationLayer: 7002, "AnimLayer::Base", "" {
	}
	AnimationCurveNode: 7003, "AnimCurveNode::R", "" {
	}
	AnimationCurve: 7004, "AnimCurve::", "" {
		KeyTime: *2 {
			a: 0,46186158000
		}
		KeyValueFloat: *2 {
			a: 0,0
		}
	}
}

Connections:  {
	C: "OO", 1001, 3001
	C: "OO", 3001, 0
	C: "OO", 3002, 0
	C: "OO", 3003, 3002
	C: "OO", 5001, 1001
	C: "OO", 6001, 5001
	C: "OO", 6002, 5001
	C: "OO", 3002, 6001
	C: "OO", 3003, 6002
	C: "OO", 7002, 7001
	C: "OO", 7003, 7002
	C: "OP", 7003, 3003, "Lcl Rotation"
	C: "OP", 7004, 7003, "d|Z"
}
`;

const SIN45 = Math.SQRT1_2;

describe("FBX scene graph and skinning", () => {
	const model = FbxLoader.parse(fbx);
	const nodeIndex = (name: string) =>
		model.nodes!.findIndex((n) => n.name === name);
	const mesh = model.meshes[0]!;

	it("reads ByPolygonVertex normals and IndexToDirect UVs per corner", () => {
		// Corners: (cp1 pv0) (cp2 pv1) (cp3 pv2) | (cp1 pv0) (cp3 pv2) (cp0 pv3).
		expect(Array.from(mesh.normals.slice(0, 9))).toEqual([
			1, 0, 0, 0, 1, 0, 0, 0, 1,
		]);
		expect(Array.from(mesh.normals.slice(15, 18))).toEqual([0, 0, -1]);
		// pv0 -> UV 2 = (1, 1), pv1 -> UV 3 = (0, 1); v is flipped.
		expect(Array.from(mesh.uvs.slice(0, 4))).toEqual([1, 0, 0, 0]);
	});

	it("builds the Model hierarchy and places the mesh on its model", () => {
		expect(model.nodes!.map((n) => n.name)).toEqual(["Body", "Root", "Tip"]);
		expect(model.nodes![nodeIndex("Tip")]!.parent).toBe(nodeIndex("Root"));
		expect(model.nodes![nodeIndex("Body")]!.translation).toEqual([5, 0, 0]);
		expect(mesh.node).toBe(nodeIndex("Body"));
		const q = model.nodes![nodeIndex("Tip")]!.rotation;
		expect(q[2]).toBeCloseTo(SIN45, 6);
		expect(q[3]).toBeCloseTo(SIN45, 6);
		// Bounds include the model's translation.
		expect(model.bounds.min[0]).toBeCloseTo(-5, 6);
		expect(model.bounds.max[0]).toBeCloseTo(15, 6);
	});

	it("weights each control point by its clusters only, normalized, strongest first", () => {
		expect(mesh.skin).toBe(0);
		const skin = model.skins![0]!;
		expect(skin.joints).toEqual([nodeIndex("Root"), nodeIndex("Tip")]);
		const at = (corner: number) => ({
			joints: Array.from(mesh.jointIndices!.slice(corner * 4, corner * 4 + 4)),
			weights: Array.from(mesh.jointWeights!.slice(corner * 4, corner * 4 + 4)),
		});
		expect(at(5)).toEqual({ joints: [0, 0, 0, 0], weights: [1, 0, 0, 0] }); // cp0
		const cp1 = at(0);
		expect(cp1.joints.slice(0, 2)).toEqual([0, 1]);
		expect(cp1.weights[0]).toBeCloseTo(2 / 3, 6);
		expect(cp1.weights[1]).toBeCloseTo(1 / 3, 6);
		expect(at(1)).toEqual({ joints: [1, 0, 0, 0], weights: [1, 0, 0, 0] }); // cp2
		expect(at(2)).toEqual({ joints: [1, 0, 0, 0], weights: [1, 0, 0, 0] }); // cp3
	});

	it("takes inverse bind matrices from TransformLink and Transform", () => {
		const ibm = model.skins![0]!.inverseBindMatrices;
		expect(Array.from(ibm.slice(16 + 12, 16 + 15))).toEqual([0, -10, 0]);
	});

	it("targets animation tracks at their node, with the pre-rotation folded in", () => {
		const track = model.animations[0]!.tracks[0]!;
		expect(track.node).toBe(nodeIndex("Tip"));
		expect(track.rotations![2]).toBeCloseTo(SIN45, 6);
		expect(track.rotations![3]).toBeCloseTo(SIN45, 6);
	});

	it("centers and sizes through the root transform", () => {
		const centered = FbxLoader.parse(fbx, { center: true, normalizeSize: 2 });
		expect(centered.bounds.center[0]).toBeCloseTo(0, 6);
		expect(Math.max(...centered.bounds.size)).toBeCloseTo(2, 6);
		expect(centered.rootTransform?.[0]).toBeCloseTo(0.1, 6);
	});
});
