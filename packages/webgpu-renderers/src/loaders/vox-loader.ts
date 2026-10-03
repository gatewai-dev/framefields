import fs from "node:fs";
import type { LoadModelOptions, Material3D, Mesh3DData, Model3DData } from "./types.js";

const DEFAULT_PALETTE: Array<[number, number, number, number]> = [
	[0, 0, 0, 0],
	// 255 default color palette fallback if RGBA chunk not present
	...Array.from({ length: 255 }, (_, i) => {
		const val = (i + 1) / 256;
		return [val, val, val, 1.0] as [number, number, number, number];
	}),
];

interface Voxel {
	x: number;
	y: number;
	z: number;
	colorIndex: number;
}

export class VoxLoader {
	/**
	 * Checks if buffer is MagicaVoxel VOX format.
	 */
	public static isVox(buffer: Uint8Array | ArrayBuffer): boolean {
		const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
		if (bytes.length < 8) return false;
		const magic = new TextDecoder("ascii").decode(bytes.subarray(0, 4));
		return magic === "VOX ";
	}

	/**
	 * Parses MagicaVoxel VOX buffer into Model3DData.
	 */
	public static parse(
		data: Uint8Array | ArrayBuffer,
		options: LoadModelOptions = {},
	): Model3DData {
		const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

		const magic = new TextDecoder("ascii").decode(bytes.subarray(0, 4));
		if (magic !== "VOX ") {
			throw new Error("Invalid VOX file: magic mismatch");
		}

		let offset = 8; // Skip 'VOX ' + version
		let sizeX = 16, sizeY = 16, sizeZ = 16;
		const voxels: Voxel[] = [];
		const palette: Array<[number, number, number, number]> = [...DEFAULT_PALETTE];

		while (offset + 12 <= bytes.byteLength) {
			const chunkId = new TextDecoder("ascii").decode(bytes.subarray(offset, offset + 4));
			const contentSize = view.getUint32(offset + 4, true);
			const childrenSize = view.getUint32(offset + 8, true);
			offset += 12;

			const chunkDataOffset = offset;
			if (chunkId === "SIZE") {
				sizeX = view.getUint32(chunkDataOffset, true);
				sizeY = view.getUint32(chunkDataOffset + 4, true);
				sizeZ = view.getUint32(chunkDataOffset + 8, true);
			} else if (chunkId === "XYZI") {
				const numVoxels = view.getUint32(chunkDataOffset, true);
				let vOffset = chunkDataOffset + 4;
				for (let i = 0; i < numVoxels; i++) {
					if (vOffset + 4 > bytes.byteLength) break;
					const x = view.getUint8(vOffset);
					const y = view.getUint8(vOffset + 1);
					const z = view.getUint8(vOffset + 2);
					const colorIndex = view.getUint8(vOffset + 3);
					vOffset += 4;
					voxels.push({ x, y, z, colorIndex });
				}
			} else if (chunkId === "RGBA") {
				// 256 colors
				for (let i = 0; i < 256; i++) {
					const cOffset = chunkDataOffset + i * 4;
					if (cOffset + 4 > bytes.byteLength) break;
					const r = view.getUint8(cOffset) / 255;
					const g = view.getUint8(cOffset + 1) / 255;
					const b = view.getUint8(cOffset + 2) / 255;
					const a = view.getUint8(cOffset + 3) / 255;
					// MagicaVoxel palette indices are 1-based (index 0 is unused or wrapped)
					const paletteIdx = i === 255 ? 0 : i + 1;
					palette[paletteIdx] = [r, g, b, a];
				}
			}

			offset += contentSize;
		}

		return VoxLoader.buildModel(voxels, palette, sizeX, sizeY, sizeZ, options);
	}

	private static buildModel(
		voxels: Voxel[],
		palette: Array<[number, number, number, number]>,
		sizeX: number,
		sizeY: number,
		sizeZ: number,
		options: LoadModelOptions,
	): Model3DData {
		const voxelSet = new Set<string>();
		voxels.forEach((v) => voxelSet.add(`${v.x},${v.y},${v.z}`));

		const rawPositions: number[] = [];
		const rawNormals: number[] = [];
		const rawColors: number[] = [];
		const rawUvs: number[] = [];
		const rawIndices: number[] = [];

		const addQuad = (
			p0: [number, number, number],
			p1: [number, number, number],
			p2: [number, number, number],
			p3: [number, number, number],
			normal: [number, number, number],
			color: [number, number, number, number],
		) => {
			const startIdx = rawPositions.length / 3;
			rawPositions.push(...p0, ...p1, ...p2, ...p3);
			rawNormals.push(...normal, ...normal, ...normal, ...normal);
			rawColors.push(...color, ...color, ...color, ...color);
			rawUvs.push(0, 0, 1, 0, 1, 1, 0, 1);
			rawIndices.push(startIdx, startIdx + 1, startIdx + 2, startIdx, startIdx + 2, startIdx + 3);
		};

		for (const v of voxels) {
			const { x, y, z, colorIndex } = v;
			const color = palette[colorIndex] ?? [0.8, 0.8, 0.8, 1.0];

			// In MagicaVoxel coordinate system: X is right, Y is forward/depth, Z is up
			// Convert to WebGPU: X is right, Y is down/up, Z is depth
			const vx = x;
			const vy = -z; // Up becomes negative Y
			const vz = y; // Depth becomes Z

			// +X face (right)
			if (!voxelSet.has(`${x + 1},${y},${z}`)) {
				addQuad(
					[vx + 1, vy, vz],
					[vx + 1, vy - 1, vz],
					[vx + 1, vy - 1, vz + 1],
					[vx + 1, vy, vz + 1],
					[1, 0, 0],
					color,
				);
			}

			// -X face (left)
			if (!voxelSet.has(`${x - 1},${y},${z}`)) {
				addQuad(
					[vx, vy, vz + 1],
					[vx, vy - 1, vz + 1],
					[vx, vy - 1, vz],
					[vx, vy, vz],
					[-1, 0, 0],
					color,
				);
			}

			// +Z face (top in VOX, front in WebGPU)
			if (!voxelSet.has(`${x},${y},${z + 1}`)) {
				addQuad(
					[vx, vy - 1, vz],
					[vx + 1, vy - 1, vz],
					[vx + 1, vy - 1, vz + 1],
					[vx, vy - 1, vz + 1],
					[0, -1, 0],
					color,
				);
			}

			// -Z face (bottom in VOX, bottom in WebGPU)
			if (!voxelSet.has(`${x},${y},${z - 1}`)) {
				addQuad(
					[vx, vy, vz + 1],
					[vx + 1, vy, vz + 1],
					[vx + 1, vy, vz],
					[vx, vy, vz],
					[0, 1, 0],
					color,
				);
			}

			// +Y face (forward in VOX, deep in WebGPU)
			if (!voxelSet.has(`${x},${y + 1},${z}`)) {
				addQuad(
					[vx + 1, vy, vz + 1],
					[vx + 1, vy - 1, vz + 1],
					[vx, vy - 1, vz + 1],
					[vx, vy, vz + 1],
					[0, 0, 1],
					color,
				);
			}

			// -Y face (back in VOX, back in WebGPU)
			if (!voxelSet.has(`${x},${y - 1},${z}`)) {
				addQuad(
					[vx, vy, vz],
					[vx, vy - 1, vz],
					[vx + 1, vy - 1, vz],
					[vx + 1, vy, vz],
					[0, 0, -1],
					color,
				);
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

		const sizeBoxX = maxX - minX;
		const sizeBoxY = maxY - minY;
		const sizeBoxZ = maxZ - minZ;
		const maxDimension = Math.max(sizeBoxX, sizeBoxY, sizeBoxZ, 0.0001);

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
			name: "vox_default",
			diffuseColor: [1, 1, 1, 1],
			shininess: 32.0,
			specularIntensity: 0.4,
			...options.defaultMaterial,
		};

		const meshes: Mesh3DData[] = [
			{
				id: "vox_mesh_0",
				name: "vox_geometry",
				positions,
				normals: new Float32Array(rawNormals),
				uvs: new Float32Array(rawUvs),
				colors: new Float32Array(rawColors),
				indices: indexArray,
				materialName: "vox_default",
			},
		];

		const finalMinX = (minX - offsetX) * scaleX;
		const finalMinY = (minY - offsetY) * scaleY;
		const finalMinZ = (minZ - offsetZ) * scaleZ;
		const finalMaxX = (maxX - offsetX) * scaleX;
		const finalMaxY = (maxY - offsetY) * scaleY;
		const finalMaxZ = (maxZ - offsetZ) * scaleZ;

		return {
			name: "VOX_Model",
			meshes,
			materials: { vox_default: defaultMaterial },
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
	 * Loads a MagicaVoxel VOX file from a buffer, path, or URL.
	 */
	public static load(
		srcOrData: string | ArrayBuffer | Uint8Array,
		options: LoadModelOptions = {},
	): Model3DData {
		if (typeof srcOrData !== "string") {
			return VoxLoader.parse(srcOrData, options);
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
			return VoxLoader.parse(buf, options);
		}

		throw new Error("VOX files must be binary buffers or local file paths");
	}
}

export function parseVOX(
	data: Uint8Array | ArrayBuffer,
	options: LoadModelOptions = {},
): Model3DData {
	return VoxLoader.parse(data, options);
}

export function loadVOX(
	srcOrData: string | ArrayBuffer | Uint8Array,
	options: LoadModelOptions = {},
): Model3DData {
	return VoxLoader.load(srcOrData, options);
}
