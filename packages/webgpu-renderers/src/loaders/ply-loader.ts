import fs from "node:fs";
import { type Vec3, Vector3Math } from "../math3d/index.js";
import type { LoadModelOptions, Material3D, Mesh3DData, Model3DData } from "./types.js";

interface PlyProperty {
	name: string;
	type: string;
	isList?: boolean;
	countType?: string;
	itemType?: string;
}

interface PlyElement {
	name: string;
	count: number;
	properties: PlyProperty[];
}

export class PlyLoader {
	/**
	 * Parses PLY data (ASCII string or binary buffer) into Model3DData.
	 */
	public static parse(
		data: string | Uint8Array | ArrayBuffer,
		options: LoadModelOptions = {},
	): Model3DData {
		const bytes =
			typeof data === "string"
				? new TextEncoder().encode(data)
				: data instanceof Uint8Array
					? data
					: new Uint8Array(data);

		// Find end_header
		const headerText = PlyLoader.extractHeader(bytes);
		const header = PlyLoader.parseHeader(headerText.text);

		if (header.format === "ascii") {
			const bodyText = new TextDecoder("utf-8").decode(bytes.subarray(headerText.endOffset));
			return PlyLoader.parseAsciiBody(header, bodyText, options);
		}

		const isLittleEndian = header.format === "binary_little_endian";
		return PlyLoader.parseBinaryBody(
			header,
			bytes.subarray(headerText.endOffset),
			isLittleEndian,
			options,
		);
	}

	private static extractHeader(bytes: Uint8Array): { text: string; endOffset: number } {
		const searchLen = Math.min(bytes.length, 10000);
		const slice = bytes.subarray(0, searchLen);
		const str = new TextDecoder("utf-8").decode(slice);

		const endIdx = str.indexOf("end_header");
		if (endIdx === -1) {
			throw new Error("Invalid PLY file: 'end_header' marker not found");
		}

		// Find newline after end_header
		let newlineOffset = str.indexOf("\n", endIdx);
		if (newlineOffset === -1) newlineOffset = endIdx + 10;
		else newlineOffset += 1;

		return {
			text: str.substring(0, newlineOffset),
			endOffset: newlineOffset,
		};
	}

	private static parseHeader(headerStr: string): {
		format: "ascii" | "binary_little_endian" | "binary_big_endian";
		version: string;
		elements: PlyElement[];
	} {
		const lines = headerStr.split(/\r?\n/);
		let format: "ascii" | "binary_little_endian" | "binary_big_endian" = "ascii";
		let version = "1.0";
		const elements: PlyElement[] = [];
		let currentElement: PlyElement | null = null;

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line || line.startsWith("comment")) continue;

			const parts = line.split(/\s+/);
			const cmd = parts[0]?.toLowerCase();

			if (cmd === "ply") continue;

			if (cmd === "format") {
				const fmt = parts[1]?.toLowerCase();
				if (fmt === "binary_little_endian") format = "binary_little_endian";
				else if (fmt === "binary_big_endian") format = "binary_big_endian";
				else format = "ascii";
				version = parts[2] ?? "1.0";
			} else if (cmd === "element") {
				const name = parts[1] ?? "";
				const count = Number.parseInt(parts[2] ?? "0", 10);
				currentElement = { name, count, properties: [] };
				elements.push(currentElement);
			} else if (cmd === "property" && currentElement) {
				if (parts[1]?.toLowerCase() === "list") {
					currentElement.properties.push({
						name: parts[4] ?? "",
						type: "list",
						isList: true,
						countType: parts[2] ?? "uchar",
						itemType: parts[3] ?? "int",
					});
				} else {
					currentElement.properties.push({
						name: parts[2] ?? "",
						type: parts[1]?.toLowerCase() ?? "float",
					});
				}
			} else if (cmd === "end_header") {
				break;
			}
		}

		return { format, version, elements };
	}

	private static parseAsciiBody(
		header: { elements: PlyElement[] },
		bodyText: string,
		options: LoadModelOptions,
	): Model3DData {
		const vertexElement = header.elements.find((e) => e.name === "vertex");
		const faceElement = header.elements.find((e) => e.name === "face");

		const vertexCount = vertexElement?.count ?? 0;
		const faceCount = faceElement?.count ?? 0;

		const rawPositions: number[] = [];
		const rawNormals: number[] = [];
		const rawUvs: number[] = [];
		const rawColors: number[] = [];
		const rawIndices: number[] = [];

		const vProps = vertexElement?.properties ?? [];
		const xIdx = vProps.findIndex((p) => p.name === "x");
		const yIdx = vProps.findIndex((p) => p.name === "y");
		const zIdx = vProps.findIndex((p) => p.name === "z");
		const nxIdx = vProps.findIndex((p) => p.name === "nx");
		const nyIdx = vProps.findIndex((p) => p.name === "ny");
		const nzIdx = vProps.findIndex((p) => p.name === "nz");
		const uIdx = vProps.findIndex((p) => p.name === "u" || p.name === "s" || p.name === "texture_u");
		const vCoordIdx = vProps.findIndex((p) => p.name === "v" || p.name === "t" || p.name === "texture_v");
		const rIdx = vProps.findIndex((p) => p.name === "red" || p.name === "r");
		const gIdx = vProps.findIndex((p) => p.name === "green" || p.name === "g");
		const bIdx = vProps.findIndex((p) => p.name === "blue" || p.name === "b");
		const aIdx = vProps.findIndex((p) => p.name === "alpha" || p.name === "a");

		const hasNormals = nxIdx !== -1 && nyIdx !== -1 && nzIdx !== -1;
		const hasColors = rIdx !== -1 && gIdx !== -1 && bIdx !== -1;
		const hasUvs = uIdx !== -1 && vCoordIdx !== -1;

		const lines = bodyText.trim().split(/\r?\n/);
		let lineIdx = 0;

		for (let v = 0; v < vertexCount; v++) {
			if (lineIdx >= lines.length) break;
			const line = lines[lineIdx++]?.trim();
			if (!line) continue;

			const parts = line.split(/\s+/);
			const x = Number.parseFloat(parts[xIdx] ?? "0") || 0;
			const y = Number.parseFloat(parts[yIdx] ?? "0") || 0;
			const z = Number.parseFloat(parts[zIdx] ?? "0") || 0;
			rawPositions.push(x, y, z);

			if (hasNormals) {
				const nx = Number.parseFloat(parts[nxIdx] ?? "0") || 0;
				const ny = Number.parseFloat(parts[nyIdx] ?? "0") || 0;
				const nz = Number.parseFloat(parts[nzIdx] ?? "0") || 0;
				rawNormals.push(nx, ny, nz);
			} else {
				rawNormals.push(0, 0, 0);
			}

			if (hasUvs) {
				const u = Number.parseFloat(parts[uIdx] ?? "0") || 0;
				const vCoord = Number.parseFloat(parts[vCoordIdx] ?? "0") || 0;
				rawUvs.push(u, 1.0 - vCoord);
			} else {
				rawUvs.push(0, 0);
			}

			if (hasColors) {
				const r = (Number.parseFloat(parts[rIdx] ?? "255") || 0) / 255;
				const g = (Number.parseFloat(parts[gIdx] ?? "255") || 0) / 255;
				const b = (Number.parseFloat(parts[bIdx] ?? "255") || 0) / 255;
				const a = aIdx !== -1 ? (Number.parseFloat(parts[aIdx] ?? "255") || 0) / 255 : 1.0;
				rawColors.push(r, g, b, a);
			}
		}

		for (let f = 0; f < faceCount; f++) {
			if (lineIdx >= lines.length) break;
			const line = lines[lineIdx++]?.trim();
			if (!line) continue;

			const parts = line.split(/\s+/);
			const n = Number.parseInt(parts[0] ?? "0", 10);
			if (n >= 3) {
				const v0 = Number.parseInt(parts[1] ?? "0", 10);
				for (let i = 1; i < n - 1; i++) {
					const v1 = Number.parseInt(parts[i + 1] ?? "0", 10);
					const v2 = Number.parseInt(parts[i + 2] ?? "0", 10);
					rawIndices.push(v0, v1, v2);
				}
			}
		}

		return PlyLoader.finalizeModel(
			rawPositions,
			rawNormals,
			rawUvs,
			hasColors ? rawColors : undefined,
			rawIndices,
			hasNormals,
			options,
		);
	}

	private static parseBinaryBody(
		header: { elements: PlyElement[] },
		bodyBytes: Uint8Array,
		isLittleEndian: boolean,
		options: LoadModelOptions,
	): Model3DData {
		const view = new DataView(bodyBytes.buffer, bodyBytes.byteOffset, bodyBytes.byteLength);
		let offset = 0;

		const vertexElement = header.elements.find((e) => e.name === "vertex");
		const faceElement = header.elements.find((e) => e.name === "face");

		const vertexCount = vertexElement?.count ?? 0;
		const faceCount = faceElement?.count ?? 0;

		const rawPositions: number[] = [];
		const rawNormals: number[] = [];
		const rawUvs: number[] = [];
		const rawColors: number[] = [];
		const rawIndices: number[] = [];

		const vProps = vertexElement?.properties ?? [];
		const hasNormals = vProps.some((p) => p.name === "nx");
		const hasColors = vProps.some((p) => p.name === "red" || p.name === "r");

		const readType = (typeStr: string): number => {
			let val = 0;
			switch (typeStr.toLowerCase()) {
				case "char":
				case "int8":
					val = view.getInt8(offset);
					offset += 1;
					break;
				case "uchar":
				case "uint8":
					val = view.getUint8(offset);
					offset += 1;
					break;
				case "short":
				case "int16":
					val = view.getInt16(offset, isLittleEndian);
					offset += 2;
					break;
				case "ushort":
				case "uint16":
					val = view.getUint16(offset, isLittleEndian);
					offset += 2;
					break;
				case "int":
				case "int32":
					val = view.getInt32(offset, isLittleEndian);
					offset += 4;
					break;
				case "uint":
				case "uint32":
					val = view.getUint32(offset, isLittleEndian);
					offset += 4;
					break;
				case "float":
				case "float32":
					val = view.getFloat32(offset, isLittleEndian);
					offset += 4;
					break;
				case "double":
				case "float64":
					val = view.getFloat64(offset, isLittleEndian);
					offset += 8;
					break;
				default:
					val = view.getFloat32(offset, isLittleEndian);
					offset += 4;
					break;
			}
			return val;
		};

		for (let v = 0; v < vertexCount; v++) {
			let x = 0, y = 0, z = 0;
			let nx = 0, ny = 0, nz = 0;
			let u = 0, vCoord = 0;
			let r = 1, g = 1, b = 1, a = 1;

			for (const prop of vProps) {
				const val = readType(prop.type);
				const pName = prop.name.toLowerCase();

				if (pName === "x") x = val;
				else if (pName === "y") y = val;
				else if (pName === "z") z = val;
				else if (pName === "nx") nx = val;
				else if (pName === "ny") ny = val;
				else if (pName === "nz") nz = val;
				else if (pName === "u" || pName === "s") u = val;
				else if (pName === "v" || pName === "t") vCoord = val;
				else if (pName === "red" || pName === "r") r = prop.type.includes("int") ? val / 255 : val;
				else if (pName === "green" || pName === "g") g = prop.type.includes("int") ? val / 255 : val;
				else if (pName === "blue" || pName === "b") b = prop.type.includes("int") ? val / 255 : val;
				else if (pName === "alpha" || pName === "a") a = prop.type.includes("int") ? val / 255 : val;
			}

			rawPositions.push(x, y, z);
			rawNormals.push(nx, ny, nz);
			rawUvs.push(u, 1.0 - vCoord);
			if (hasColors) rawColors.push(r, g, b, a);
		}

		const faceProps = faceElement?.properties ?? [];
		const listProp = faceProps.find((p) => p.isList);

		for (let f = 0; f < faceCount; f++) {
			if (offset >= bodyBytes.byteLength) break;
			if (listProp) {
				const count = readType(listProp.countType ?? "uchar");
				const verts: number[] = [];
				for (let k = 0; k < count; k++) {
					verts.push(readType(listProp.itemType ?? "int"));
				}

				if (verts.length >= 3) {
					const v0 = verts[0]!;
					for (let i = 1; i < verts.length - 1; i++) {
						rawIndices.push(v0, verts[i]!, verts[i + 1]!);
					}
				}
			}
		}

		return PlyLoader.finalizeModel(
			rawPositions,
			rawNormals,
			rawUvs,
			hasColors ? rawColors : undefined,
			rawIndices,
			hasNormals,
			options,
		);
	}

	private static finalizeModel(
		rawPositions: number[],
		rawNormals: number[],
		rawUvs: number[],
		rawColors: number[] | undefined,
		rawIndices: number[],
		hasNormals: boolean,
		options: LoadModelOptions,
	): Model3DData {
		// Calculate face normals if missing
		if (!hasNormals || options.smoothNormals) {
			for (let i = 0; i < rawIndices.length; i += 3) {
				const i0 = rawIndices[i]!;
				const i1 = rawIndices[i + 1]!;
				const i2 = rawIndices[i + 2]!;

				const p0: Vec3 = [rawPositions[i0 * 3]!, rawPositions[i0 * 3 + 1]!, rawPositions[i0 * 3 + 2]!];
				const p1: Vec3 = [rawPositions[i1 * 3]!, rawPositions[i1 * 3 + 1]!, rawPositions[i1 * 3 + 2]!];
				const p2: Vec3 = [rawPositions[i2 * 3]!, rawPositions[i2 * 3 + 1]!, rawPositions[i2 * 3 + 2]!];

				const e1 = Vector3Math.subtract(p1, p0);
				const e2 = Vector3Math.subtract(p2, p0);
				const fn = Vector3Math.cross(e1, e2);

				rawNormals[i0 * 3] += fn[0];
				rawNormals[i0 * 3 + 1] += fn[1];
				rawNormals[i0 * 3 + 2] += fn[2];

				rawNormals[i1 * 3] += fn[0];
				rawNormals[i1 * 3 + 1] += fn[1];
				rawNormals[i1 * 3 + 2] += fn[2];

				rawNormals[i2 * 3] += fn[0];
				rawNormals[i2 * 3 + 1] += fn[1];
				rawNormals[i2 * 3 + 2] += fn[2];
			}

			for (let i = 0; i < rawNormals.length; i += 3) {
				const nx = rawNormals[i]!;
				const ny = rawNormals[i + 1]!;
				const nz = rawNormals[i + 2]!;
				const len = Math.hypot(nx, ny, nz) || 1.0;
				rawNormals[i] = nx / len;
				rawNormals[i + 1] = ny / len;
				rawNormals[i + 2] = nz / len;
			}
		}

		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

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
		for (let i = 0; i < rawPositions.length; i += 3) {
			positions[i] = (rawPositions[i]! - offsetX) * scaleX;
			positions[i + 1] = (rawPositions[i + 1]! - offsetY) * scaleY;
			positions[i + 2] = (rawPositions[i + 2]! - offsetZ) * scaleZ;
		}

		const isLarge = positions.length / 3 > 65535;
		const indexArray = isLarge ? new Uint32Array(rawIndices) : new Uint16Array(rawIndices);

		const defaultMaterial: Material3D = {
			name: "ply_default",
			diffuseColor: [0.8, 0.8, 0.85, 1.0],
			shininess: 32.0,
			specularIntensity: 0.5,
			...options.defaultMaterial,
		};

		const meshes: Mesh3DData[] = [
			{
				id: "ply_mesh_0",
				name: "ply_geometry",
				positions,
				normals: new Float32Array(rawNormals),
				uvs: new Float32Array(rawUvs),
				colors: rawColors ? new Float32Array(rawColors) : undefined,
				indices: indexArray,
				materialName: "ply_default",
			},
		];

		const finalMinX = (minX - offsetX) * scaleX;
		const finalMinY = (minY - offsetY) * scaleY;
		const finalMinZ = (minZ - offsetZ) * scaleZ;
		const finalMaxX = (maxX - offsetX) * scaleX;
		const finalMaxY = (maxY - offsetY) * scaleY;
		const finalMaxZ = (maxZ - offsetZ) * scaleZ;

		return {
			name: "PLY_Model",
			meshes,
			materials: { ply_default: defaultMaterial },
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
	 * Loads a PLY file synchronously or asynchronously from a path or URL.
	 */
	public static load(
		srcOrData: string | ArrayBuffer | Uint8Array,
		options: LoadModelOptions = {},
	): Model3DData {
		if (typeof srcOrData !== "string") {
			return PlyLoader.parse(srcOrData, options);
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
			return PlyLoader.parse(buf, options);
		}

		return PlyLoader.parse(srcOrData, options);
	}
}

export function parsePLY(
	data: string | Uint8Array | ArrayBuffer,
	options: LoadModelOptions = {},
): Model3DData {
	return PlyLoader.parse(data, options);
}

export function loadPLY(
	srcOrData: string | ArrayBuffer | Uint8Array,
	options: LoadModelOptions = {},
): Model3DData {
	return PlyLoader.load(srcOrData, options);
}
