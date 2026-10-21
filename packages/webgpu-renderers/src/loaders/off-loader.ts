import fs from "node:fs";
import {
	accumulateVertexNormals,
	computeBounds,
	createIndexArray,
	resolveModelTransform,
	transformModelBounds,
	transformPositions,
} from "./mesh-utils.js";
import type {
	LoadModelOptions,
	Material3D,
	Mesh3DData,
	Model3DData,
} from "./types.js";

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
				: new TextDecoder("utf-8").decode(
						data instanceof Uint8Array ? data : new Uint8Array(data),
					);

		const lines = text.split(/\r?\n/);
		let lineIdx = 0;

		// 1. Header line
		while (
			lineIdx < lines.length &&
			(!lines[lineIdx]!.trim() || lines[lineIdx]!.trim().startsWith("#"))
		) {
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
				const r =
					(Number.parseFloat(parts[propOffset] ?? "255") || 0) /
					(Number.parseFloat(parts[propOffset] ?? "255") > 1 ? 255 : 1);
				const g =
					(Number.parseFloat(parts[propOffset + 1] ?? "255") || 0) /
					(Number.parseFloat(parts[propOffset + 1] ?? "255") > 1 ? 255 : 1);
				const b =
					(Number.parseFloat(parts[propOffset + 2] ?? "255") || 0) /
					(Number.parseFloat(parts[propOffset + 2] ?? "255") > 1 ? 255 : 1);
				const a =
					parts.length > propOffset + 3
						? Number.parseFloat(parts[propOffset + 3] ?? "1") || 1
						: 1.0;
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
			accumulateVertexNormals(rawPositions, rawIndices, rawNormals);
		}

		const bounds = computeBounds(rawPositions);
		const transform = resolveModelTransform(bounds, options);
		const positions = transformPositions(rawPositions, transform);

		const indexArray = createIndexArray(rawIndices, positions.length / 3);

		const defaultMaterial: Material3D = {
			name: "off_default",
			// Vertex colors carry the color; the neutral gray would only dim them.
			diffuseColor: hasColors ? [1, 1, 1, 1] : [0.8, 0.8, 0.85, 1.0],
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

		return {
			name: "OFF_Model",
			meshes,
			materials: { off_default: defaultMaterial },
			animations: [],
			bounds: transformModelBounds(bounds, transform),
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
