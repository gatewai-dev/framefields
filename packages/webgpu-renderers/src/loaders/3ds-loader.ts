import fs from "node:fs";
import { type Vec3, Vector3Math } from "../math3d/index.js";
import type { LoadModelOptions, Material3D, Mesh3DData, Model3DData } from "./types.js";

// 3DS Chunk IDs
const CHUNK_MAIN = 0x4d4d;
const CHUNK_3D_EDITOR = 0x3d3d;
const CHUNK_OBJECT = 0x4000;
const CHUNK_TRIMESH = 0x4100;
const CHUNK_VERTICES = 0x4110;
const CHUNK_FACES = 0x4120;
const CHUNK_TEXCOORDS = 0x4140;
const CHUNK_MATERIAL = 0xafff;
const CHUNK_MATNAME = 0xa000;
const CHUNK_MATDIFFUSE = 0xa020;
const CHUNK_RGB_FLOAT = 0x0010;
const CHUNK_RGB_BYTE = 0x0011;

interface Raw3DSMesh {
	name: string;
	positions: number[];
	indices: number[];
	uvs: number[];
	materialName?: string;
}

export class ThreeDSLoader {
	/**
	 * Checks if buffer is 3DS binary format.
	 */
	public static is3DS(buffer: Uint8Array | ArrayBuffer): boolean {
		const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
		if (bytes.length < 6) return false;
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const magic = view.getUint16(0, true);
		return magic === CHUNK_MAIN;
	}

	/**
	 * Parses 3DS binary buffer into Model3DData.
	 */
	public static parse(
		data: Uint8Array | ArrayBuffer,
		options: LoadModelOptions = {},
	): Model3DData {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

		const magic = view.getUint16(0, true);
		if (magic !== CHUNK_MAIN) {
			throw new Error("Invalid 3DS file: 0x4D4D magic mismatch");
		}

		const meshes: Raw3DSMesh[] = [];
		const materials: Record<string, Material3D> = {};

		ThreeDSLoader.readChunk(view, 0, bytes.byteLength, meshes, materials);

		return ThreeDSLoader.buildModel(meshes, materials, options);
	}

	private static readChunk(
		view: DataView,
		startOffset: number,
		endOffset: number,
		meshes: Raw3DSMesh[],
		materials: Record<string, Material3D>,
		currentObjectName = "Object",
	): void {
		let offset = startOffset;

		while (offset + 6 <= endOffset && offset + 6 <= view.byteLength) {
			const chunkId = view.getUint16(offset, true);
			const chunkLength = view.getUint32(offset + 2, true);

			if (chunkLength < 6) break;
			const nextChunkOffset = offset + chunkLength;
			const contentStart = offset + 6;
			const contentEnd = Math.min(nextChunkOffset, endOffset, view.byteLength);

			switch (chunkId) {
				case CHUNK_MAIN:
				case CHUNK_3D_EDITOR:
					ThreeDSLoader.readChunk(view, contentStart, contentEnd, meshes, materials, currentObjectName);
					break;

				case CHUNK_OBJECT: {
					// Read null-terminated string for object name
					let nameEnd = contentStart;
					while (nameEnd < contentEnd && view.getUint8(nameEnd) !== 0) {
						nameEnd++;
					}
					const objBytes = new Uint8Array(view.buffer, view.byteOffset + contentStart, nameEnd - contentStart);
					const objName = new TextDecoder("ascii").decode(objBytes) || "Object";
					ThreeDSLoader.readChunk(view, nameEnd + 1, contentEnd, meshes, materials, objName);
					break;
				}

				case CHUNK_TRIMESH: {
					const mesh: Raw3DSMesh = {
						name: currentObjectName,
						positions: [],
						indices: [],
						uvs: [],
					};
					ThreeDSLoader.readTriMesh(view, contentStart, contentEnd, mesh, materials);
					if (mesh.positions.length > 0 && mesh.indices.length > 0) {
						meshes.push(mesh);
					}
					break;
				}

				case CHUNK_MATERIAL:
					ThreeDSLoader.readMaterial(view, contentStart, contentEnd, materials);
					break;

				default:
					break;
			}

			offset = nextChunkOffset;
		}
	}

	private static readTriMesh(
		view: DataView,
		startOffset: number,
		endOffset: number,
		mesh: Raw3DSMesh,
		materials: Record<string, Material3D>,
	): void {
		let offset = startOffset;

		while (offset + 6 <= endOffset) {
			const chunkId = view.getUint16(offset, true);
			const chunkLength = view.getUint32(offset + 2, true);
			if (chunkLength < 6) break;

			const nextChunkOffset = offset + chunkLength;
			const contentStart = offset + 6;

			if (chunkId === CHUNK_VERTICES) {
				const numVerts = view.getUint16(contentStart, true);
				let vOffset = contentStart + 2;
				for (let i = 0; i < numVerts; i++) {
					if (vOffset + 12 > endOffset) break;
					const x = view.getFloat32(vOffset, true);
					const y = view.getFloat32(vOffset + 4, true);
					const z = view.getFloat32(vOffset + 8, true);
					mesh.positions.push(x, y, z);
					vOffset += 12;
				}
			} else if (chunkId === CHUNK_FACES) {
				const numFaces = view.getUint16(contentStart, true);
				let fOffset = contentStart + 2;
				for (let i = 0; i < numFaces; i++) {
					if (fOffset + 8 > endOffset) break;
					const a = view.getUint16(fOffset, true);
					const b = view.getUint16(fOffset + 2, true);
					const c = view.getUint16(fOffset + 4, true);
					mesh.indices.push(a, b, c);
					fOffset += 8;
				}
			} else if (chunkId === CHUNK_TEXCOORDS) {
				const numCoords = view.getUint16(contentStart, true);
				let tOffset = contentStart + 2;
				for (let i = 0; i < numCoords; i++) {
					if (tOffset + 8 > endOffset) break;
					const u = view.getFloat32(tOffset, true);
					const v = view.getFloat32(tOffset + 4, true);
					mesh.uvs.push(u, 1.0 - v);
					tOffset += 8;
				}
			}

			offset = nextChunkOffset;
		}
	}

	private static readMaterial(
		view: DataView,
		startOffset: number,
		endOffset: number,
		materials: Record<string, Material3D>,
	): void {
		let offset = startOffset;
		let matName = "Material";
		let diffuseColor: [number, number, number, number] = [0.8, 0.8, 0.8, 1.0];

		while (offset + 6 <= endOffset) {
			const chunkId = view.getUint16(offset, true);
			const chunkLength = view.getUint32(offset + 2, true);
			if (chunkLength < 6) break;

			const nextChunkOffset = offset + chunkLength;
			const contentStart = offset + 6;

			if (chunkId === CHUNK_MATNAME) {
				let nameEnd = contentStart;
				while (nameEnd < nextChunkOffset && view.getUint8(nameEnd) !== 0) {
					nameEnd++;
				}
				const nameBytes = new Uint8Array(view.buffer, view.byteOffset + contentStart, nameEnd - contentStart);
				matName = new TextDecoder("ascii").decode(nameBytes) || matName;
			} else if (chunkId === CHUNK_MATDIFFUSE) {
				// Read Color subchunk
				if (contentStart + 6 <= nextChunkOffset) {
					const colorSubId = view.getUint16(contentStart, true);
					if (colorSubId === CHUNK_RGB_FLOAT && contentStart + 18 <= nextChunkOffset) {
						const r = view.getFloat32(contentStart + 6, true);
						const g = view.getFloat32(contentStart + 10, true);
						const b = view.getFloat32(contentStart + 14, true);
						diffuseColor = [r, g, b, 1.0];
					} else if (colorSubId === CHUNK_RGB_BYTE && contentStart + 9 <= nextChunkOffset) {
						const r = view.getUint8(contentStart + 6) / 255;
						const g = view.getUint8(contentStart + 7) / 255;
						const b = view.getUint8(contentStart + 8) / 255;
						diffuseColor = [r, g, b, 1.0];
					}
				}
			}

			offset = nextChunkOffset;
		}

		materials[matName] = {
			name: matName,
			diffuseColor,
			shininess: 32.0,
			specularIntensity: 0.5,
		};
	}

	private static buildModel(
		rawMeshes: Raw3DSMesh[],
		materials: Record<string, Material3D>,
		options: LoadModelOptions,
	): Model3DData {
		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

		for (const m of rawMeshes) {
			for (let i = 0; i < m.positions.length; i += 3) {
				const x = m.positions[i]!;
				const y = m.positions[i + 1]!;
				const z = m.positions[i + 2]!;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
				if (z < minZ) minZ = z;
				if (z > maxZ) maxZ = z;
			}
		}

		if (!Number.isFinite(minX)) {
			minX = minY = minZ = 0;
			maxX = maxY = maxZ = 0;
		}

		const centerX = (minX + maxX) * 0.5;
		const centerY = (minY + maxY) * 0.5;
		const centerZ = (minZ + maxZ) * 0.5;

		const sizeX = maxX - minX;
		const sizeY = maxY - minY;
		const sizeZ = maxZ - minZ;
		const maxDimension = Math.max(sizeX, sizeY, sizeZ, 0.0001);

		let scaleMultiplier = 1.0;
		if (options.normalizeSize && options.normalizeSize > 0) {
			scaleMultiplier = options.normalizeSize / maxDimension;
		}

		let scaleX = scaleMultiplier;
		let scaleY = scaleMultiplier;
		let scaleZ = scaleMultiplier;
		if (typeof options.scale === "number") {
			scaleX *= options.scale;
			scaleY *= options.scale;
			scaleZ *= options.scale;
		} else if (Array.isArray(options.scale)) {
			scaleX *= options.scale[0];
			scaleY *= options.scale[1];
			scaleZ *= options.scale[2];
		}

		const offsetX = options.center ? centerX : 0;
		const offsetY = options.center ? centerY : 0;
		const offsetZ = options.center ? centerZ : 0;

		const meshes: Mesh3DData[] = rawMeshes.map((m, idx) => {
			const positions = new Float32Array(m.positions.length);
			for (let i = 0; i < m.positions.length; i += 3) {
				positions[i] = (m.positions[i]! - offsetX) * scaleX;
				positions[i + 1] = (m.positions[i + 1]! - offsetY) * scaleY;
				positions[i + 2] = (m.positions[i + 2]! - offsetZ) * scaleZ;
			}

			// Compute vertex normals
			const normals = new Float32Array(m.positions.length);
			for (let i = 0; i < m.indices.length; i += 3) {
				const i0 = m.indices[i]!;
				const i1 = m.indices[i + 1]!;
				const i2 = m.indices[i + 2]!;

				const p0: Vec3 = [positions[i0 * 3]!, positions[i0 * 3 + 1]!, positions[i0 * 3 + 2]!];
				const p1: Vec3 = [positions[i1 * 3]!, positions[i1 * 3 + 1]!, positions[i1 * 3 + 2]!];
				const p2: Vec3 = [positions[i2 * 3]!, positions[i2 * 3 + 1]!, positions[i2 * 3 + 2]!];

				const e1 = Vector3Math.subtract(p1, p0);
				const e2 = Vector3Math.subtract(p2, p0);
				const fn = Vector3Math.cross(e1, e2);

				normals[i0 * 3] += fn[0];
				normals[i0 * 3 + 1] += fn[1];
				normals[i0 * 3 + 2] += fn[2];

				normals[i1 * 3] += fn[0];
				normals[i1 * 3 + 1] += fn[1];
				normals[i1 * 3 + 2] += fn[2];

				normals[i2 * 3] += fn[0];
				normals[i2 * 3 + 1] += fn[1];
				normals[i2 * 3 + 2] += fn[2];
			}

			for (let i = 0; i < normals.length; i += 3) {
				const nx = normals[i]!;
				const ny = normals[i + 1]!;
				const nz = normals[i + 2]!;
				const len = Math.hypot(nx, ny, nz) || 1.0;
				normals[i] = nx / len;
				normals[i + 1] = ny / len;
				normals[i + 2] = nz / len;
			}

			const uvs = m.uvs.length === (m.positions.length / 3) * 2
				? new Float32Array(m.uvs)
				: new Float32Array((m.positions.length / 3) * 2);

			const isLarge = positions.length / 3 > 65535;
			const indexArray = isLarge ? new Uint32Array(m.indices) : new Uint16Array(m.indices);

			return {
				id: `3ds_mesh_${idx}`,
				name: m.name,
				positions,
				normals,
				uvs,
				indices: indexArray,
				materialName: m.materialName,
			};
		});

		const finalMinX = (minX - offsetX) * scaleX;
		const finalMinY = (minY - offsetY) * scaleY;
		const finalMinZ = (minZ - offsetZ) * scaleZ;
		const finalMaxX = (maxX - offsetX) * scaleX;
		const finalMaxY = (maxY - offsetY) * scaleY;
		const finalMaxZ = (maxZ - offsetZ) * scaleZ;

		return {
			name: "3DS_Model",
			meshes,
			materials,
			animations: [],
			bounds: {
				min: [finalMinX, finalMinY, finalMinZ],
				max: [finalMaxX, finalMaxY, finalMaxZ],
				center: [(finalMinX + finalMaxX) * 0.5, (finalMinY + finalMaxY) * 0.5, (finalMinZ + finalMaxZ) * 0.5],
				size: [finalMaxX - finalMinX, finalMaxY - finalMinY, finalMaxZ - finalMinZ],
				boundingSphereRadius: Math.hypot(finalMaxX - finalMinX, finalMaxY - finalMinY, finalMaxZ - finalMinZ) * 0.5,
			},
		};
	}

	/**
	 * Loads a 3DS file from a buffer, path, or URL.
	 */
	public static load(
		srcOrData: string | ArrayBuffer | Uint8Array,
		options: LoadModelOptions = {},
	): Model3DData {
		if (typeof srcOrData !== "string") {
			return ThreeDSLoader.parse(srcOrData, options);
		}

		if (
			srcOrData.startsWith("/") ||
			srcOrData.startsWith("./") ||
			srcOrData.startsWith("../") ||
			srcOrData.startsWith("file://")
		) {
			const cleanPath = srcOrData.startsWith("file://")
				? srcOrData.replace("file://", "")
				: srcOrData;
			const buf = fs.readFileSync(cleanPath);
			return ThreeDSLoader.parse(buf, options);
		}

		throw new Error("3DS files must be binary buffers or local file paths");
	}
}

export function parse3DS(
	data: Uint8Array | ArrayBuffer,
	options: LoadModelOptions = {},
): Model3DData {
	return ThreeDSLoader.parse(data, options);
}

export function load3DS(
	srcOrData: string | ArrayBuffer | Uint8Array,
	options: LoadModelOptions = {},
): Model3DData {
	return ThreeDSLoader.load(srcOrData, options);
}
