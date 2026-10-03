import fs from "node:fs";
import { type Vec3, Vector3Math } from "../math3d/index.js";
import type { LoadModelOptions, Material3D, Mesh3DData, Model3DData } from "./types.js";

export class StlLoader {
	/**
	 * Checks if buffer is Binary STL or ASCII STL.
	 */
	public static isBinary(buffer: Uint8Array | ArrayBuffer): boolean {
		const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
		if (bytes.length < 84) return false;

		// Binary STL has 80 byte header + 4 byte triangle count
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const triangleCount = view.getUint32(80, true);
		const expectedBinarySize = 84 + triangleCount * 50;

		if (bytes.length === expectedBinarySize) return true;

		// Check for non-ASCII characters in the first 512 bytes
		const checkLength = Math.min(bytes.length, 512);
		for (let i = 0; i < checkLength; i++) {
			const b = bytes[i]!;
			if (b > 127 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) {
				return true;
			}
		}

		// Check if it starts with 'solid'
		const headerText = new TextDecoder("utf-8").decode(bytes.subarray(0, 80)).trim();
		if (headerText.startsWith("solid") && !headerText.includes("\n")) {
			// Some binary STLs put "solid" in their 80-byte header, but if length matches binary it's binary
			return bytes.length >= 84 + triangleCount * 50;
		}

		return !headerText.startsWith("solid");
	}

	/**
	 * Parses STL data (binary Uint8Array/ArrayBuffer or ASCII string) into Model3DData.
	 */
	public static parse(
		data: string | Uint8Array | ArrayBuffer,
		options: LoadModelOptions = {},
	): Model3DData {
		if (typeof data === "string") {
			return StlLoader.parseAscii(data, options);
		}

		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
		if (StlLoader.isBinary(bytes)) {
			return StlLoader.parseBinary(bytes, options);
		}

		const text = new TextDecoder("utf-8").decode(bytes);
		return StlLoader.parseAscii(text, options);
	}

	/**
	 * Parses Binary STL.
	 */
	public static parseBinary(
		bytes: Uint8Array,
		options: LoadModelOptions = {},
	): Model3DData {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const triangleCount = view.getUint32(80, true);

		const positions: number[] = [];
		const normals: number[] = [];
		const indices: number[] = [];

		let offset = 84;
		for (let i = 0; i < triangleCount; i++) {
			if (offset + 50 > bytes.byteLength) break;

			const nx = view.getFloat32(offset, true);
			const ny = view.getFloat32(offset + 4, true);
			const nz = view.getFloat32(offset + 8, true);
			offset += 12;

			const v0x = view.getFloat32(offset, true);
			const v0y = view.getFloat32(offset + 4, true);
			const v0z = view.getFloat32(offset + 8, true);
			offset += 12;

			const v1x = view.getFloat32(offset, true);
			const v1y = view.getFloat32(offset + 4, true);
			const v1z = view.getFloat32(offset + 8, true);
			offset += 12;

			const v2x = view.getFloat32(offset, true);
			const v2y = view.getFloat32(offset + 4, true);
			const v2z = view.getFloat32(offset + 8, true);
			offset += 12;

			// 2-byte attribute byte count
			offset += 2;

			let finalNx = nx;
			let finalNy = ny;
			let finalNz = nz;

			// If facet normal is 0, compute face normal from vertices
			if (finalNx === 0 && finalNy === 0 && finalNz === 0) {
				const e1 = Vector3Math.subtract([v1x, v1y, v1z], [v0x, v0y, v0z]);
				const e2 = Vector3Math.subtract([v2x, v2y, v2z], [v0x, v0y, v0z]);
				const fn = Vector3Math.normalize(Vector3Math.cross(e1, e2));
				finalNx = fn[0];
				finalNy = fn[1];
				finalNz = fn[2];
			}

			const startIdx = positions.length / 3;
			positions.push(v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z);
			normals.push(
				finalNx, finalNy, finalNz,
				finalNx, finalNy, finalNz,
				finalNx, finalNy, finalNz,
			);
			indices.push(startIdx, startIdx + 1, startIdx + 2);
		}

		return StlLoader.finalizeModel(positions, normals, indices, options);
	}

	/**
	 * Parses ASCII STL text.
	 */
	public static parseAscii(
		text: string,
		options: LoadModelOptions = {},
	): Model3DData {
		const positions: number[] = [];
		const normals: number[] = [];
		const indices: number[] = [];

		const lines = text.split(/\r?\n/);
		let currentNormal: Vec3 = [0, 0, 1];
		let currentVerts: Vec3[] = [];

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;

			if (line.startsWith("facet normal")) {
				const parts = line.split(/\s+/);
				const nx = Number.parseFloat(parts[2] ?? "0") || 0;
				const ny = Number.parseFloat(parts[3] ?? "0") || 0;
				const nz = Number.parseFloat(parts[4] ?? "0") || 0;
				currentNormal = [nx, ny, nz];
				currentVerts = [];
			} else if (line.startsWith("vertex")) {
				const parts = line.split(/\s+/);
				const x = Number.parseFloat(parts[1] ?? "0") || 0;
				const y = Number.parseFloat(parts[2] ?? "0") || 0;
				const z = Number.parseFloat(parts[3] ?? "0") || 0;
				currentVerts.push([x, y, z]);
			} else if (line.startsWith("endfacet")) {
				if (currentVerts.length >= 3) {
					const v0 = currentVerts[0]!;
					const v1 = currentVerts[1]!;
					const v2 = currentVerts[2]!;

					let fn = currentNormal;
					if (fn[0] === 0 && fn[1] === 0 && fn[2] === 0) {
						const e1 = Vector3Math.subtract(v1, v0);
						const e2 = Vector3Math.subtract(v2, v0);
						fn = Vector3Math.normalize(Vector3Math.cross(e1, e2));
					}

					for (let i = 1; i < currentVerts.length - 1; i++) {
						const vi = currentVerts[i]!;
						const viNext = currentVerts[i + 1]!;
						const startIdx = positions.length / 3;

						positions.push(v0[0], v0[1], v0[2], vi[0], vi[1], vi[2], viNext[0], viNext[1], viNext[2]);
						normals.push(fn[0], fn[1], fn[2], fn[0], fn[1], fn[2], fn[0], fn[1], fn[2]);
						indices.push(startIdx, startIdx + 1, startIdx + 2);
					}
				}
				currentVerts = [];
			}
		}

		return StlLoader.finalizeModel(positions, normals, indices, options);
	}

	private static finalizeModel(
		rawPositions: number[],
		rawNormals: number[],
		rawIndices: number[],
		options: LoadModelOptions = {},
	): Model3DData {
		let minX = Infinity;
		let minY = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let maxZ = -Infinity;

		for (let i = 0; i < rawPositions.length; i += 3) {
			const x = rawPositions[i]!;
			const y = rawPositions[i + 1]!;
			const z = rawPositions[i + 2]!;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
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

		const positions = new Float32Array(rawPositions.length);
		const uvs = new Float32Array((rawPositions.length / 3) * 2);

		for (let i = 0; i < rawPositions.length; i += 3) {
			const px = (rawPositions[i]! - offsetX) * scaleX;
			const py = (rawPositions[i + 1]! - offsetY) * scaleY;
			const pz = (rawPositions[i + 2]! - offsetZ) * scaleZ;
			positions[i] = px;
			positions[i + 1] = py;
			positions[i + 2] = pz;

			// Planar UV fallback based on bounding size
			const uvIdx = (i / 3) * 2;
			uvs[uvIdx] = sizeX > 0 ? (rawPositions[i]! - minX) / sizeX : 0;
			uvs[uvIdx + 1] = sizeY > 0 ? (rawPositions[i + 1]! - minY) / sizeY : 0;
		}

		const isLarge = positions.length / 3 > 65535;
		const indexArray = isLarge ? new Uint32Array(rawIndices) : new Uint16Array(rawIndices);

		const defaultMaterial: Material3D = {
			name: "stl_default",
			diffuseColor: [0.8, 0.8, 0.85, 1.0],
			shininess: 32.0,
			specularIntensity: 0.5,
			...options.defaultMaterial,
		};

		const meshes: Mesh3DData[] = [
			{
				id: "stl_mesh_0",
				name: "stl_geometry",
				positions,
				normals: new Float32Array(rawNormals),
				uvs,
				indices: indexArray,
				materialName: "stl_default",
			},
		];

		const finalMinX = (minX - offsetX) * scaleX;
		const finalMinY = (minY - offsetY) * scaleY;
		const finalMinZ = (minZ - offsetZ) * scaleZ;
		const finalMaxX = (maxX - offsetX) * scaleX;
		const finalMaxY = (maxY - offsetY) * scaleY;
		const finalMaxZ = (maxZ - offsetZ) * scaleZ;

		return {
			name: "STL_Model",
			meshes,
			materials: { stl_default: defaultMaterial },
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
	 * Loads an STL file synchronously or asynchronously from a path or URL.
	 */
	public static load(
		srcOrData: string | ArrayBuffer | Uint8Array,
		options: LoadModelOptions = {},
	): Model3DData {
		if (typeof srcOrData !== "string") {
			return StlLoader.parse(srcOrData, options);
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
			return StlLoader.parse(buf, options);
		}

		return StlLoader.parse(srcOrData, options);
	}
}

export function parseSTL(
	data: string | Uint8Array | ArrayBuffer,
	options: LoadModelOptions = {},
): Model3DData {
	return StlLoader.parse(data, options);
}

export function loadSTL(
	srcOrData: string | ArrayBuffer | Uint8Array,
	options: LoadModelOptions = {},
): Model3DData {
	return StlLoader.load(srcOrData, options);
}
