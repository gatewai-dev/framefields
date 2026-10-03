import fs from "node:fs";
import { type Vec3, Vector3Math } from "../math3d/index.js";
import type { LoadModelOptions, Material3D, Mesh3DData, Model3DData } from "./types.js";

export class OffLoader {
	/**
	 * Parses OFF text into Model3DData.
	 */
	public static parse(
		data: string | Uint8Array | ArrayBuffer,
		options: LoadModelOptions = {},
	): Model3DData {
		const text =
			typeof data === "string"
				? data
				: new TextDecoder("utf-8").decode(data instanceof Uint8Array ? data : new Uint8Array(data));

		const lines = text.split(/\r?\n/);
		let lineIdx = 0;

		// 1. Header line
		while (lineIdx < lines.length && (!lines[lineIdx]!.trim() || lines[lineIdx]!.trim().startsWith("#"))) {
			lineIdx++;
		}

		if (lineIdx >= lines.length) {
			throw new Error("Empty OFF file");
		}

		let headerLine = lines[lineIdx++]!.trim();
		let hasNormals = false;
		let hasColors = false;

		if (headerLine.startsWith("NOFF") || headerLine.startsWith("STOFF")) {
			hasNormals = true;
		} else if (headerLine.startsWith("COFF")) {
			hasColors = true;
		} else if (!headerLine.startsWith("OFF")) {
			throw new Error("Invalid OFF header: missing 'OFF'");
		}

		// Handle cases where counts are on the same line as OFF (e.g. "OFF 8 6 12")
		headerLine = headerLine.replace(/^(?:ST|CO|NO|C|N)?OFF\s*/i, "").trim();

		let numVertices = 0;
		let numFaces = 0;

		if (headerLine.length > 0) {
			const parts = headerLine.split(/\s+/);
			numVertices = Number.parseInt(parts[0] ?? "0", 10);
			numFaces = Number.parseInt(parts[1] ?? "0", 10);
		} else {
			// Find count line
			while (lineIdx < lines.length) {
				const line = lines[lineIdx++]!.trim();
				if (!line || line.startsWith("#")) continue;
				const parts = line.split(/\s+/);
				numVertices = Number.parseInt(parts[0] ?? "0", 10);
				numFaces = Number.parseInt(parts[1] ?? "0", 10);
				break;
			}
		}

		const rawPositions: number[] = [];
		const rawNormals: number[] = [];
		const rawColors: number[] = [];
		const rawUvs: number[] = [];
		const rawIndices: number[] = [];

		// Parse vertices
		let readVerts = 0;
		while (lineIdx < lines.length && readVerts < numVertices) {
			const line = lines[lineIdx++]!.trim();
			if (!line || line.startsWith("#")) continue;

			const parts = line.split(/\s+/);
			const x = Number.parseFloat(parts[0] ?? "0") || 0;
			const y = Number.parseFloat(parts[1] ?? "0") || 0;
			const z = Number.parseFloat(parts[2] ?? "0") || 0;
			rawPositions.push(x, y, z);

			let propOffset = 3;
			if (hasNormals) {
				const nx = Number.parseFloat(parts[propOffset] ?? "0") || 0;
				const ny = Number.parseFloat(parts[propOffset + 1] ?? "0") || 0;
				const nz = Number.parseFloat(parts[propOffset + 2] ?? "0") || 0;
				rawNormals.push(nx, ny, nz);
				propOffset += 3;
			} else {
				rawNormals.push(0, 0, 0);
			}

			if (hasColors && parts.length > propOffset) {
				const r = (Number.parseFloat(parts[propOffset] ?? "255") || 0) / (Number.parseFloat(parts[propOffset] ?? "255") > 1 ? 255 : 1);
				const g = (Number.parseFloat(parts[propOffset + 1] ?? "255") || 0) / (Number.parseFloat(parts[propOffset + 1] ?? "255") > 1 ? 255 : 1);
				const b = (Number.parseFloat(parts[propOffset + 2] ?? "255") || 0) / (Number.parseFloat(parts[propOffset + 2] ?? "255") > 1 ? 255 : 1);
				const a = parts.length > propOffset + 3 ? (Number.parseFloat(parts[propOffset + 3] ?? "1") || 1) : 1.0;
				rawColors.push(r, g, b, a);
			}

			rawUvs.push(0, 0);
			readVerts++;
		}

		// Parse faces
		let readFaces = 0;
		while (lineIdx < lines.length && readFaces < numFaces) {
			const line = lines[lineIdx++]!.trim();
			if (!line || line.startsWith("#")) continue;

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
			readFaces++;
		}

		// Calculate normals if missing
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
			name: "off_default",
			diffuseColor: [0.8, 0.8, 0.85, 1.0],
			shininess: 32.0,
			specularIntensity: 0.5,
			...options.defaultMaterial,
		};

		const meshes: Mesh3DData[] = [
			{
				id: "off_mesh_0",
				name: "off_geometry",
				positions,
				normals: new Float32Array(rawNormals),
				uvs: new Float32Array(rawUvs),
				colors: hasColors ? new Float32Array(rawColors) : undefined,
				indices: indexArray,
				materialName: "off_default",
			},
		];

		const finalMinX = (minX - offsetX) * scaleX;
		const finalMinY = (minY - offsetY) * scaleY;
		const finalMinZ = (minZ - offsetZ) * scaleZ;
		const finalMaxX = (maxX - offsetX) * scaleX;
		const finalMaxY = (maxY - offsetY) * scaleY;
		const finalMaxZ = (maxZ - offsetZ) * scaleZ;

		return {
			name: "OFF_Model",
			meshes,
			materials: { off_default: defaultMaterial },
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
	 * Loads an OFF file from a string, buffer, or path.
	 */
	public static load(
		srcOrData: string | ArrayBuffer | Uint8Array,
		options: LoadModelOptions = {},
	): Model3DData {
		if (typeof srcOrData !== "string") {
			return OffLoader.parse(srcOrData, options);
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
			const text = fs.readFileSync(cleanPath, "utf-8");
			return OffLoader.parse(text, options);
		}

		return OffLoader.parse(srcOrData, options);
	}
}

export function parseOFF(
	data: string | Uint8Array | ArrayBuffer,
	options: LoadModelOptions = {},
): Model3DData {
	return OffLoader.parse(data, options);
}

export function loadOFF(
	srcOrData: string | ArrayBuffer | Uint8Array,
	options: LoadModelOptions = {},
): Model3DData {
	return OffLoader.load(srcOrData, options);
}
