import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { FbxLoader } from "./fbx-loader.js";

describe("FbxLoader", () => {
	it("parses an ASCII FBX geometry and material hierarchy", () => {
		const asciiFbx = `
; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}

Objects:  {
	Geometry: 1001, "Geometry::Box01", "Mesh" {
		Vertices: *12 {
			a: -10,-10,0, 10,-10,0, 10,10,0, -10,10,0
		}
		PolygonVertexIndex: *4 {
			a: 0,1,2,-4
		}
		LayerElementNormal: 0 {
			Version: 101
			Name: ""
			MappingInformationType: "ByControlPoint"
			ReferenceInformationType: "Direct"
			Normals: *12 {
				a: 0,0,1, 0,0,1, 0,0,1, 0,0,1
			}
		}
		LayerElementUV: 0 {
			Version: 101
			Name: "UVMap"
			MappingInformationType: "ByControlPoint"
			ReferenceInformationType: "Direct"
			UV: *8 {
				a: 0,0, 1,0, 1,1, 0,1
			}
		}
	}
	Material: 2001, "Material::DefaultMat", "" {
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",0.8,0.2,0.5
			P: "Shininess", "Number", "", "A",64
		}
	}
}

Connections:  {
	C: "OO", 2001, 1001
}
`;

		const model = FbxLoader.parse(asciiFbx);
		expect(model.meshes.length).toBe(1);
		const mesh = model.meshes[0]!;
		expect(mesh.positions.length).toBe(18); // 2 triangles * 3 vertices * 3 coords = 18 floats
		expect(mesh.indices.length).toBe(6);
		expect(model.materials["DefaultMat"]?.shininess).toBe(64);
		expect(model.materials["DefaultMat"]?.diffuseColor?.[0]).toBeCloseTo(0.8, 2);
	});

	it("parses Binary FBX stream with compressed vertex buffers and takes", () => {
		// Construct a valid binary FBX buffer
		const header = "Kaydara FBX Binary  \0\x1a\0";
		const headerBytes = new TextEncoder().encode(header);
		const totalSize = 4096;
		const buffer = new Uint8Array(totalSize);
		buffer.set(headerBytes, 0);

		const view = new DataView(buffer.buffer);
		view.setUint32(23, 7400, true); // Version 7400 (32-bit offsets)

		let offset = 27;

		// Helper to write binary node
		const writeNode = (
			name: string,
			props: Array<{ type: string; val: unknown }>,
			writeChildren?: () => void,
		) => {
			const startOffset = offset;
			// Reserve 13 bytes for node record header: endOffset (4), numProps (4), propListLen (4), nameLen (1)
			offset += 13;

			const nameBytes = new TextEncoder().encode(name);
			buffer.set(nameBytes, offset);
			offset += nameBytes.length;

			const propStart = offset;
			for (const p of props) {
				const typeCode = p.type.charCodeAt(0);
				buffer[offset++] = typeCode;

				if (p.type === "I") {
					view.setInt32(offset, p.val as number, true);
					offset += 4;
				} else if (p.type === "L") {
					view.setBigInt64(offset, BigInt(p.val as number), true);
					offset += 8;
				} else if (p.type === "S") {
					const strBytes = new TextEncoder().encode(p.val as string);
					view.setUint32(offset, strBytes.length, true);
					offset += 4;
					buffer.set(strBytes, offset);
					offset += strBytes.length;
				} else if (p.type === "d") {
					// Compressed double array
					const arr = p.val as number[];
					const rawBytes = new Uint8Array(arr.length * 8);
					const rawView = new DataView(rawBytes.buffer);
					for (let i = 0; i < arr.length; i++) {
						rawView.setFloat64(i * 8, arr[i]!, true);
					}
					const compressed = deflateSync(rawBytes);

					view.setUint32(offset, arr.length, true); // arrayLength
					view.setUint32(offset + 4, 1, true); // encoding (1 = zlib)
					view.setUint32(offset + 8, compressed.length, true); // compressedLength
					offset += 12;

					buffer.set(compressed, offset);
					offset += compressed.length;
				} else if (p.type === "i") {
					// Compressed int array
					const arr = p.val as number[];
					const rawBytes = new Uint8Array(arr.length * 4);
					const rawView = new DataView(rawBytes.buffer);
					for (let i = 0; i < arr.length; i++) {
						rawView.setInt32(i * 4, arr[i]!, true);
					}
					const compressed = deflateSync(rawBytes);

					view.setUint32(offset, arr.length, true);
					view.setUint32(offset + 4, 1, true);
					view.setUint32(offset + 8, compressed.length, true);
					offset += 12;

					buffer.set(compressed, offset);
					offset += compressed.length;
				}
			}

			const propListLen = offset - propStart;
			if (writeChildren) {
				writeChildren();
				// Write null node at end of children (13 zero bytes)
				for (let z = 0; z < 13; z++) buffer[offset++] = 0;
			}

			const endOffset = offset;
			view.setUint32(startOffset, endOffset, true);
			view.setUint32(startOffset + 4, props.length, true);
			view.setUint32(startOffset + 8, propListLen, true);
			buffer[startOffset + 12] = nameBytes.length;
		};

		// Objects root node
		writeNode("Objects", [], () => {
			writeNode(
				"Geometry",
				[
					{ type: "L", val: 5001 },
					{ type: "S", val: "TriangleMesh" },
					{ type: "S", val: "Mesh" },
				],
				() => {
					writeNode("Vertices", [
						{ type: "d", val: [0, 0, 0, 10, 0, 0, 0, 10, 0] },
					]);
					writeNode("PolygonVertexIndex", [
						{ type: "i", val: [0, 1, -3] }, // polygon (0, 1, 2)
					]);
				},
			);

			writeNode(
				"AnimationStack",
				[
					{ type: "L", val: 6001 },
					{ type: "S", val: "DanceClip" },
					{ type: "S", val: "" },
				],
				() => {
					// Empty take stack
				},
			);
		});

		// Write terminal null record
		for (let z = 0; z < 13; z++) buffer[offset++] = 0;

		const model = FbxLoader.parse(buffer.subarray(0, offset));
		expect(model.meshes.length).toBe(1);
		const mesh = model.meshes[0]!;
		expect(mesh.indices.length).toBe(3);
		expect(mesh.positions.length).toBe(9);
		expect(model.animations.length).toBe(1);
		expect(model.animations[0]?.name).toBe("DanceClip");
	});
});
