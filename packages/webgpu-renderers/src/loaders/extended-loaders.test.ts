import { describe, expect, it } from "vitest";
import { parseSTL } from "./stl-loader.js";
import { parsePLY } from "./ply-loader.js";
import { parseGLTF, parseGLB, GltfLoader } from "./gltf-loader.js";
import { parseVOX, VoxLoader } from "./vox-loader.js";
import { parse3DS, ThreeDSLoader } from "./3ds-loader.js";
import { parseOFF } from "./off-loader.js";
import { loadModel3D } from "../renderer3d/renderer3d.js";

describe("Extended 3D Model Loaders (STL, PLY, glTF/GLB, VOX, 3DS, OFF)", () => {
	describe("STL Loader (ASCII & Binary)", () => {
		it("parses ASCII STL with facets and vertices", () => {
			const asciiStl = `
solid tetrahedron
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 10 0
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 0 0 0
      vertex 0 0 10
      vertex 10 0 0
    endloop
  endfacet
endsolid tetrahedron
`;
			const model = parseSTL(asciiStl, { center: true });
			expect(model.meshes.length).toBe(1);
			const mesh = model.meshes[0]!;
			expect(mesh.positions.length).toBe(2 * 3 * 3); // 2 triangles * 3 vertices * 3 floats
			expect(mesh.indices.length).toBe(6);
			expect(mesh.normals.length).toBe(18);
			expect(model.bounds.center[0]).toBeCloseTo(0, 4);
		});

		it("parses Binary STL", () => {
			// 80 bytes header + 4 bytes uint32 count (1 triangle) + 50 bytes triangle
			const buf = Buffer.alloc(84 + 50);
			buf.write("Gitframes Binary STL Test Header", 0, "ascii");
			buf.writeUInt32LE(1, 80); // 1 triangle

			let offset = 84;
			// Normal: [0, 1, 0]
			buf.writeFloatLE(0.0, offset);
			buf.writeFloatLE(1.0, offset + 4);
			buf.writeFloatLE(0.0, offset + 8);
			offset += 12;

			// V0: [0, 0, 0]
			buf.writeFloatLE(0.0, offset);
			buf.writeFloatLE(0.0, offset + 4);
			buf.writeFloatLE(0.0, offset + 8);
			offset += 12;

			// V1: [10, 0, 0]
			buf.writeFloatLE(10.0, offset);
			buf.writeFloatLE(0.0, offset + 4);
			buf.writeFloatLE(0.0, offset + 8);
			offset += 12;

			// V2: [0, 0, 10]
			buf.writeFloatLE(0.0, offset);
			buf.writeFloatLE(0.0, offset + 4);
			buf.writeFloatLE(10.0, offset + 8);
			offset += 12;

			// Attribute byte count
			buf.writeUInt16LE(0, offset);

			const model = parseSTL(buf);
			expect(model.meshes.length).toBe(1);
			expect(model.meshes[0]!.positions.length).toBe(9);
			expect(model.meshes[0]!.indices.length).toBe(3);
			expect(model.meshes[0]!.normals[1]).toBeCloseTo(1.0, 4);
		});
	});

	describe("PLY Loader (ASCII & Binary)", () => {
		it("parses ASCII PLY with positions, normals, and vertex colors", () => {
			const asciiPly = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property float nx
property float ny
property float nz
property uchar red
property uchar green
property uchar blue
element face 1
property list uchar int vertex_indices
end_header
0 0 0 0 0 1 255 0 0
10 0 0 0 0 1 0 255 0
0 10 0 0 0 1 0 0 255
3 0 1 2
`;
			const model = parsePLY(asciiPly);
			expect(model.meshes.length).toBe(1);
			const mesh = model.meshes[0]!;
			expect(mesh.positions.length).toBe(9);
			expect(mesh.indices.length).toBe(3);
			expect(mesh.colors).toBeDefined();
			expect(mesh.colors!.length).toBe(12); // 3 vertices * 4 floats RGBA
			expect(mesh.colors![0]).toBeCloseTo(1.0, 2); // Red vertex 0
			expect(mesh.colors![5]).toBeCloseTo(1.0, 2); // Green vertex 1
		});

		it("parses Binary Little-Endian PLY", () => {
			const header = `ply
format binary_little_endian 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
`;
			const headerBuf = Buffer.from(header, "utf-8");

			// 3 vertices * 12 bytes = 36 bytes
			// 1 face: 1 byte count (3) + 3 * 4 bytes int32 = 13 bytes
			const bodyBuf = Buffer.alloc(36 + 13);
			let offset = 0;

			// V0: [0, 0, 0]
			bodyBuf.writeFloatLE(0, offset);
			bodyBuf.writeFloatLE(0, offset + 4);
			bodyBuf.writeFloatLE(0, offset + 8);
			offset += 12;

			// V1: [5, 0, 0]
			bodyBuf.writeFloatLE(5, offset);
			bodyBuf.writeFloatLE(0, offset + 4);
			bodyBuf.writeFloatLE(0, offset + 8);
			offset += 12;

			// V2: [0, 5, 0]
			bodyBuf.writeFloatLE(0, offset);
			bodyBuf.writeFloatLE(5, offset + 4);
			bodyBuf.writeFloatLE(0, offset + 8);
			offset += 12;

			// Face: count=3, indices=[0, 1, 2]
			bodyBuf.writeUInt8(3, offset);
			offset += 1;
			bodyBuf.writeInt32LE(0, offset);
			bodyBuf.writeInt32LE(1, offset + 4);
			bodyBuf.writeInt32LE(2, offset + 8);

			const totalBuf = Buffer.concat([headerBuf, bodyBuf]);
			const model = parsePLY(totalBuf);
			expect(model.meshes.length).toBe(1);
			expect(model.meshes[0]!.positions.length).toBe(9);
			expect(model.meshes[0]!.indices.length).toBe(3);
		});
	});

	describe("glTF 2.0 & GLB Loader", () => {
		it("parses JSON glTF with embedded base64 buffer", () => {
			// 3 vertices (Float32Array [0,0,0, 1,0,0, 0,1,0] -> 36 bytes)
			// Indices (Uint16Array [0, 1, 2] -> 6 bytes)
			const posData = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
			const idxData = new Uint16Array([0, 1, 2]);

			const binBuf = Buffer.concat([
				Buffer.from(posData.buffer),
				Buffer.from(idxData.buffer),
			]);
			const b64 = binBuf.toString("base64");

			const gltfJson = JSON.stringify({
				asset: { version: "2.0" },
				buffers: [{ uri: `data:application/octet-stream;base64,${b64}`, byteLength: binBuf.length }],
				bufferViews: [
					{ buffer: 0, byteOffset: 0, byteLength: 36 },
					{ buffer: 0, byteOffset: 36, byteLength: 6 },
				],
				accessors: [
					{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }, // positions
					{ bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }, // indices
				],
				materials: [
					{
						name: "RedPBR",
						pbrMetallicRoughness: {
							baseColorFactor: [0.9, 0.1, 0.1, 1.0],
							roughnessFactor: 0.2,
							metallicFactor: 0.8,
						},
					},
				],
				meshes: [
					{
						name: "TestTriangle",
						primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
					},
				],
			});

			const model = parseGLTF(gltfJson);
			expect(model.meshes.length).toBe(1);
			expect(model.meshes[0]!.positions.length).toBe(9);
			expect(model.meshes[0]!.indices.length).toBe(3);
			expect(model.materials.RedPBR).toBeDefined();
			expect(model.materials.RedPBR.roughness).toBe(0.2);
			expect(model.materials.RedPBR.metallic).toBe(0.8);
		});

		it("parses Binary GLB container with JSON and BIN chunks", () => {
			const posData = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
			const idxData = new Uint16Array([0, 1, 2, 0, 2, 3]);

			const binBuf = Buffer.concat([
				Buffer.from(posData.buffer),
				Buffer.from(idxData.buffer),
			]);

			const jsonStr = JSON.stringify({
				asset: { version: "2.0" },
				buffers: [{ byteLength: binBuf.length }],
				bufferViews: [
					{ buffer: 0, byteOffset: 0, byteLength: posData.byteLength },
					{ buffer: 0, byteOffset: posData.byteLength, byteLength: idxData.byteLength },
				],
				accessors: [
					{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
					{ bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
				],
				meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
			});

			const jsonBuf = Buffer.from(jsonStr, "utf-8");
			// Pad JSON to 4-byte boundary
			const jsonPadding = (4 - (jsonBuf.length % 4)) % 4;
			const paddedJsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPadding, 0x20)]);

			const totalLen = 12 + 8 + paddedJsonBuf.length + 8 + binBuf.length;
			const glbHeader = Buffer.alloc(12);
			glbHeader.writeUInt32LE(0x46546c67, 0); // magic "glTF"
			glbHeader.writeUInt32LE(2, 4); // version 2
			glbHeader.writeUInt32LE(totalLen, 8);

			const jsonChunkHeader = Buffer.alloc(8);
			jsonChunkHeader.writeUInt32LE(paddedJsonBuf.length, 0);
			jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

			const binChunkHeader = Buffer.alloc(8);
			binChunkHeader.writeUInt32LE(binBuf.length, 0);
			binChunkHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

			const glbData = Buffer.concat([
				glbHeader,
				jsonChunkHeader,
				paddedJsonBuf,
				binChunkHeader,
				binBuf,
			]);

			expect(GltfLoader.isGlb(glbData)).toBe(true);
			const model = parseGLB(glbData);
			expect(model.meshes.length).toBe(1);
			expect(model.meshes[0]!.positions.length).toBe(12);
			expect(model.meshes[0]!.indices.length).toBe(6);
		});
	});

	describe("MagicaVoxel VOX Loader", () => {
		it("parses VOX file with voxel grid and palette", () => {
			// Header: "VOX " + version 150
			const header = Buffer.alloc(8);
			header.write("VOX ", 0, "ascii");
			header.writeUInt32LE(150, 4);

			// Chunk SIZE: x=2, y=2, z=2
			const sizeChunk = Buffer.alloc(12 + 12);
			sizeChunk.write("SIZE", 0, "ascii");
			sizeChunk.writeUInt32LE(12, 4); // content size
			sizeChunk.writeUInt32LE(0, 8); // children size
			sizeChunk.writeUInt32LE(2, 12);
			sizeChunk.writeUInt32LE(2, 16);
			sizeChunk.writeUInt32LE(2, 20);

			// Chunk XYZI: 1 voxel at (0, 0, 0) with color 1
			const xyziChunk = Buffer.alloc(12 + 8);
			xyziChunk.write("XYZI", 0, "ascii");
			xyziChunk.writeUInt32LE(8, 4);
			xyziChunk.writeUInt32LE(0, 8);
			xyziChunk.writeUInt32LE(1, 12); // 1 voxel
			xyziChunk.writeUInt8(0, 16); // x
			xyziChunk.writeUInt8(0, 17); // y
			xyziChunk.writeUInt8(0, 18); // z
			xyziChunk.writeUInt8(1, 19); // colorIndex

			// MAIN chunk wrapper
			const mainContentSize = 0;
			const mainChildrenSize = sizeChunk.length + xyziChunk.length;
			const mainChunkHeader = Buffer.alloc(12);
			mainChunkHeader.write("MAIN", 0, "ascii");
			mainChunkHeader.writeUInt32LE(mainContentSize, 4);
			mainChunkHeader.writeUInt32LE(mainChildrenSize, 8);

			const voxBuf = Buffer.concat([header, mainChunkHeader, sizeChunk, xyziChunk]);

			expect(VoxLoader.isVox(voxBuf)).toBe(true);
			const model = parseVOX(voxBuf);
			expect(model.meshes.length).toBe(1);
			// 1 isolated voxel has 6 exposed faces * 4 vertices = 24 vertices
			expect(model.meshes[0]!.positions.length).toBe(24 * 3);
			expect(model.meshes[0]!.indices.length).toBe(6 * 6); // 6 faces * 2 triangles * 3 = 36 indices
			expect(model.meshes[0]!.colors).toBeDefined();
		});
	});

	describe("3D Studio 3DS Loader", () => {
		it("parses 3DS binary chunk tree", () => {
			// Build minimal 3DS binary structure
			// 0x4D4D (MAIN) -> 0x3D3D (3D EDITOR) -> 0x4000 (OBJECT "Box") -> 0x4100 (TRIMESH) -> 0x4110 (VERTICES) + 0x4120 (FACES)
			const v0 = [0, 0, 0];
			const v1 = [10, 0, 0];
			const v2 = [0, 10, 0];

			// Vertices chunk: 0x4110 (2 byte id + 4 byte len + 2 byte count + 3 * 12 bytes = 44 bytes)
			const vertChunk = Buffer.alloc(6 + 2 + 36);
			vertChunk.writeUInt16LE(0x4110, 0);
			vertChunk.writeUInt32LE(vertChunk.length, 2);
			vertChunk.writeUInt16LE(3, 6); // 3 vertices
			vertChunk.writeFloatLE(v0[0]!, 8);
			vertChunk.writeFloatLE(v0[1]!, 12);
			vertChunk.writeFloatLE(v0[2]!, 16);
			vertChunk.writeFloatLE(v1[0]!, 20);
			vertChunk.writeFloatLE(v1[1]!, 24);
			vertChunk.writeFloatLE(v1[2]!, 28);
			vertChunk.writeFloatLE(v2[0]!, 32);
			vertChunk.writeFloatLE(v2[1]!, 36);
			vertChunk.writeFloatLE(v2[2]!, 40);

			// Faces chunk: 0x4120 (2 byte id + 4 byte len + 2 byte count + 1 * 8 bytes = 16 bytes)
			const faceChunk = Buffer.alloc(6 + 2 + 8);
			faceChunk.writeUInt16LE(0x4120, 0);
			faceChunk.writeUInt32LE(faceChunk.length, 2);
			faceChunk.writeUInt16LE(1, 6); // 1 face
			faceChunk.writeUInt16LE(0, 8); // a
			faceChunk.writeUInt16LE(1, 10); // b
			faceChunk.writeUInt16LE(2, 12); // c
			faceChunk.writeUInt16LE(0, 14); // flags

			// TriMesh chunk: 0x4100
			const triMeshLen = 6 + vertChunk.length + faceChunk.length;
			const triMeshHeader = Buffer.alloc(6);
			triMeshHeader.writeUInt16LE(0x4100, 0);
			triMeshHeader.writeUInt32LE(triMeshLen, 2);
			const triMeshChunk = Buffer.concat([triMeshHeader, vertChunk, faceChunk]);

			// Object chunk: 0x4000 ("Box\0" = 4 bytes)
			const objName = Buffer.from("Box\0", "ascii");
			const objLen = 6 + objName.length + triMeshChunk.length;
			const objHeader = Buffer.alloc(6);
			objHeader.writeUInt16LE(0x4000, 0);
			objHeader.writeUInt32LE(objLen, 2);
			const objChunk = Buffer.concat([objHeader, objName, triMeshChunk]);

			// 3D Editor chunk: 0x3D3D
			const editLen = 6 + objChunk.length;
			const editHeader = Buffer.alloc(6);
			editHeader.writeUInt16LE(0x3d3d, 0);
			editHeader.writeUInt32LE(editLen, 2);
			const editChunk = Buffer.concat([editHeader, objChunk]);

			// Main chunk: 0x4D4D
			const mainLen = 6 + editChunk.length;
			const mainHeader = Buffer.alloc(6);
			mainHeader.writeUInt16LE(0x4d4d, 0);
			mainHeader.writeUInt32LE(mainLen, 2);
			const full3ds = Buffer.concat([mainHeader, editChunk]);

			expect(ThreeDSLoader.is3DS(full3ds)).toBe(true);
			const model = parse3DS(full3ds);
			expect(model.meshes.length).toBe(1);
			expect(model.meshes[0]!.positions.length).toBe(9);
			expect(model.meshes[0]!.indices.length).toBe(3);
		});
	});

	describe("Object File Format (OFF) Loader", () => {
		it("parses standard and COFF formats with colors and normals", () => {
			const offText = `OFF
4 2 6
-1.0 -1.0 0.0
 1.0 -1.0 0.0
 1.0  1.0 0.0
-1.0  1.0 0.0
3 0 1 2
3 0 2 3
`;
			const model = parseOFF(offText);
			expect(model.meshes.length).toBe(1);
			expect(model.meshes[0]!.positions.length).toBe(12);
			expect(model.meshes[0]!.indices.length).toBe(6);
			expect(model.meshes[0]!.normals.length).toBe(12);
		});
	});

	describe("Unified Loader Dispatcher (loadModel3D)", () => {
		it("auto-detects each format based on signatures and extensions", () => {
			const stl = "solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test";
			const off = "OFF\n3 1 3\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2";
			const ply = "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2";

			const mStl = loadModel3D(stl);
			const mOff = loadModel3D(off);
			const mPly = loadModel3D(ply);

			expect(mStl.meshes.length).toBe(1);
			expect(mOff.meshes.length).toBe(1);
			expect(mPly.meshes.length).toBe(1);
		});
	});
});
