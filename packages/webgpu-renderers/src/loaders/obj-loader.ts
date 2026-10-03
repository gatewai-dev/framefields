import fs from "node:fs";
import path from "node:path";
import { Matrix4Math, type Vec3, Vector3Math } from "../math3d/index.js";
import type {
	LoadModelOptions,
	Material3D,
	Mesh3DData,
	Model3DData,
} from "./types.js";

export class ObjLoader {
	/**
	 * Parses Wavefront .obj text content (and optional .mtl text) into Model3DData.
	 */
	public static parse(
		objText: string,
		mtlTextOrOptions?: string | LoadModelOptions,
		maybeOptions?: LoadModelOptions,
	): Model3DData {
		const options: LoadModelOptions =
			typeof mtlTextOrOptions === "object" && mtlTextOrOptions !== null
				? mtlTextOrOptions
				: maybeOptions ?? {};
		const mtlText =
			typeof mtlTextOrOptions === "string"
				? mtlTextOrOptions
				: options.mtlText;

		const rawPositions: Vec3[] = [];
		const rawNormals: Vec3[] = [];
		const rawUvs: Vec2[] = [];

		interface FaceVertex {
			v: number;
			vt: number;
			vn: number;
		}

		interface MeshBuilder {
			materialName: string;
			faces: FaceVertex[][];
		}

		const meshBuilders: MeshBuilder[] = [];
		let currentBuilder: MeshBuilder = {
			materialName: "default",
			faces: [],
		};
		meshBuilders.push(currentBuilder);

		const materials: Record<string, Material3D> = {};
		if (mtlText) {
			Object.assign(materials, ObjLoader.parseMtl(mtlText));
		}

		const lines = objText.split(/\r?\n/);

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]?.trim();
			if (!line || line.startsWith("#")) continue;

			const parts = line.split(/\s+/);
			const cmd = parts[0]?.toLowerCase();

			if (cmd === "mtllib") {
				const mtlFileName = parts.slice(1).join(" ").trim();
				if (options.basePath && typeof fs !== "undefined" && fs.existsSync) {
					try {
						const resolvedMtlPath = path.resolve(options.basePath, mtlFileName);
						if (fs.existsSync(resolvedMtlPath)) {
							const content = fs.readFileSync(resolvedMtlPath, "utf-8");
							Object.assign(materials, ObjLoader.parseMtl(content));
						}
					} catch (_) {}
				}
			} else if (cmd === "v") {
				// Geometric vertex: v x y z [w]
				const x = Number.parseFloat(parts[1] ?? "0");
				const y = Number.parseFloat(parts[2] ?? "0");
				const z = Number.parseFloat(parts[3] ?? "0");
				rawPositions.push([x, y, z]);
			} else if (cmd === "vn") {
				// Vertex normal: vn i j k
				const nx = Number.parseFloat(parts[1] ?? "0");
				const ny = Number.parseFloat(parts[2] ?? "0");
				const nz = Number.parseFloat(parts[3] ?? "0");
				rawNormals.push([nx, ny, nz]);
			} else if (cmd === "vt") {
				// Texture coordinate: vt u [v] [w]
				const u = Number.parseFloat(parts[1] ?? "0");
				const v = parts[2] !== undefined ? Number.parseFloat(parts[2]) : 0;
				rawUvs.push([u, v]);
			} else if (cmd === "usemtl") {
				const matName = parts[1] ?? "default";
				if (currentBuilder.faces.length > 0) {
					currentBuilder = { materialName: matName, faces: [] };
					meshBuilders.push(currentBuilder);
				} else {
					currentBuilder.materialName = matName;
				}
			} else if (cmd === "f") {
				// Face definition: f v1/vt1/vn1 v2/vt2/vn2 ...
				const faceVertices: FaceVertex[] = [];
				for (let p = 1; p < parts.length; p++) {
					const vertDef = parts[p];
					if (!vertDef) continue;
					const indices = vertDef.split("/");
					let vIdx = Number.parseInt(indices[0] ?? "0", 10);
					let vtIdx =
						indices[1] && indices[1].length > 0
							? Number.parseInt(indices[1], 10)
							: 0;
					let vnIdx =
						indices[2] && indices[2].length > 0
							? Number.parseInt(indices[2], 10)
							: 0;

					// Resolve relative (negative) indexing
					if (vIdx < 0) vIdx = rawPositions.length + vIdx + 1;
					if (vtIdx < 0) vtIdx = rawUvs.length + vtIdx + 1;
					if (vnIdx < 0) vnIdx = rawNormals.length + vnIdx + 1;

					faceVertices.push({
						v: vIdx - 1, // Convert 1-based OBJ index to 0-based
						vt: vtIdx - 1,
						vn: vnIdx - 1,
					});
				}

				if (faceVertices.length >= 3) {
					// Triangulate polygons using triangle fan: (0, 1, 2), (0, 2, 3), (0, 3, 4)...
					for (let k = 1; k < faceVertices.length - 1; k++) {
						const v0 = faceVertices[0];
						const v1 = faceVertices[k];
						const v2 = faceVertices[k + 1];
						if (v0 && v1 && v2) {
							currentBuilder.faces.push([v0, v1, v2]);
						}
					}
				}
			}
		}

		// Calculate initial bounding box across all raw vertices
		let minX = Infinity;
		let minY = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let maxZ = -Infinity;

		for (const pos of rawPositions) {
			const [px, py, pz] = pos;
			if (px === undefined || py === undefined || pz === undefined) continue;
			if (px < minX) minX = px;
			if (py < minY) minY = py;
			if (pz < minZ) minZ = pz;
			if (px > maxX) maxX = px;
			if (py > maxY) maxY = py;
			if (pz > maxZ) maxZ = pz;
		}

		if (!Number.isFinite(minX)) {
			minX = -1;
			minY = -1;
			minZ = -1;
			maxX = 1;
			maxY = 1;
			maxZ = 1;
		}

		let centerX = (minX + maxX) * 0.5;
		let centerY = (minY + maxY) * 0.5;
		let centerZ = (minZ + maxZ) * 0.5;
		let sizeX = Math.max(1e-4, maxX - minX);
		let sizeY = Math.max(1e-4, maxY - minY);
		let sizeZ = Math.max(1e-4, maxZ - minZ);
		const maxDim = Math.max(sizeX, sizeY, sizeZ);

		let scaleMultiplier = 1.0;
		if (options.normalizeSize && options.normalizeSize > 0) {
			scaleMultiplier = options.normalizeSize / maxDim;
		}
		if (typeof options.scale === "number") {
			scaleMultiplier *= options.scale;
		}

		const shouldCenter = options.center ?? false;
		const offsetX = shouldCenter ? centerX : 0;
		const offsetY = shouldCenter ? centerY : 0;
		const offsetZ = shouldCenter ? centerZ : 0;

		// Convert builders into Mesh3DData instances
		const meshes: Mesh3DData[] = [];

		for (let bIdx = 0; bIdx < meshBuilders.length; bIdx++) {
			const builder = meshBuilders[bIdx];
			if (!builder || builder.faces.length === 0) continue;

			const vertexMap = new Map<string, number>();
			const positions: number[] = [];
			const normals: number[] = [];
			const uvs: number[] = [];
			const indices: number[] = [];

			let hasParsedNormals = false;

			for (const tri of builder.faces) {
				for (const vert of tri) {
					const key = `${vert.v}_${vert.vt}_${vert.vn}`;
					let outIndex = vertexMap.get(key);

					if (outIndex === undefined) {
						outIndex = positions.length / 3;
						vertexMap.set(key, outIndex);

						const rawPos = rawPositions[vert.v] ?? [0, 0, 0];
						const px = ((rawPos[0] ?? 0) - offsetX) * scaleMultiplier;
						const py = ((rawPos[1] ?? 0) - offsetY) * scaleMultiplier;
						const pz = ((rawPos[2] ?? 0) - offsetZ) * scaleMultiplier;
						positions.push(px, py, pz);

						if (vert.vt >= 0 && rawUvs[vert.vt]) {
							const uv = rawUvs[vert.vt]!;
							uvs.push(uv[0] ?? 0, 1.0 - (uv[1] ?? 0)); // Flip V for WebGPU standard
						} else {
							uvs.push(0, 0);
						}

						if (vert.vn >= 0 && rawNormals[vert.vn]) {
							hasParsedNormals = true;
							const norm = rawNormals[vert.vn]!;
							normals.push(norm[0] ?? 0, norm[1] ?? 0, norm[2] ?? 0);
						} else {
							normals.push(0, 0, 0);
						}
					}

					indices.push(outIndex);
				}
			}

			// If no normals were parsed, calculate smooth area-weighted vertex normals
			if (!hasParsedNormals || options.smoothNormals) {
				const computedNormals = new Float32Array(positions.length);
				for (let i = 0; i < indices.length; i += 3) {
					const i0 = indices[i]!;
					const i1 = indices[i + 1]!;
					const i2 = indices[i + 2]!;

					const p0: Vec3 = [
						positions[i0 * 3]!,
						positions[i0 * 3 + 1]!,
						positions[i0 * 3 + 2]!,
					];
					const p1: Vec3 = [
						positions[i1 * 3]!,
						positions[i1 * 3 + 1]!,
						positions[i1 * 3 + 2]!,
					];
					const p2: Vec3 = [
						positions[i2 * 3]!,
						positions[i2 * 3 + 1]!,
						positions[i2 * 3 + 2]!,
					];

					const edge1 = Vector3Math.subtract(p1, p0);
					const edge2 = Vector3Math.subtract(p2, p0);
					const faceNormal = Vector3Math.cross(edge1, edge2);

					computedNormals[i0 * 3] += faceNormal[0];
					computedNormals[i0 * 3 + 1] += faceNormal[1];
					computedNormals[i0 * 3 + 2] += faceNormal[2];

					computedNormals[i1 * 3] += faceNormal[0];
					computedNormals[i1 * 3 + 1] += faceNormal[1];
					computedNormals[i1 * 3 + 2] += faceNormal[2];

					computedNormals[i2 * 3] += faceNormal[0];
					computedNormals[i2 * 3 + 1] += faceNormal[1];
					computedNormals[i2 * 3 + 2] += faceNormal[2];
				}

				// Normalize all vertex normals
				for (let v = 0; v < positions.length / 3; v++) {
					const nx = computedNormals[v * 3]!;
					const ny = computedNormals[v * 3 + 1]!;
					const nz = computedNormals[v * 3 + 2]!;
					const len = Math.hypot(nx, ny, nz) || 1.0;
					normals[v * 3] = nx / len;
					normals[v * 3 + 1] = ny / len;
					normals[v * 3 + 2] = nz / len;
				}
			}

			const isLargeMesh = positions.length / 3 > 65535;
			const indexArray = isLargeMesh
				? new Uint32Array(indices)
				: new Uint16Array(indices);

			meshes.push({
				id: `mesh_${bIdx}`,
				name: builder.materialName,
				positions: new Float32Array(positions),
				normals: new Float32Array(normals),
				uvs: new Float32Array(uvs),
				indices: indexArray,
				materialName: builder.materialName,
			});
		}

		// Recompute final bounds after centering and scaling
		const finalMinX = (minX - offsetX) * scaleMultiplier;
		const finalMinY = (minY - offsetY) * scaleMultiplier;
		const finalMinZ = (minZ - offsetZ) * scaleMultiplier;
		const finalMaxX = (maxX - offsetX) * scaleMultiplier;
		const finalMaxY = (maxY - offsetY) * scaleMultiplier;
		const finalMaxZ = (maxZ - offsetZ) * scaleMultiplier;
		const finalSizeX = finalMaxX - finalMinX;
		const finalSizeY = finalMaxY - finalMinY;
		const finalSizeZ = finalMaxZ - finalMinZ;
		const finalCenterX = (finalMinX + finalMaxX) * 0.5;
		const finalCenterY = (finalMinY + finalMaxY) * 0.5;
		const finalCenterZ = (finalMinZ + finalMaxZ) * 0.5;
		const sphereRadius =
			Math.hypot(finalSizeX, finalSizeY, finalSizeZ) * 0.5;

		return {
			meshes,
			materials,
			animations: [],
			bounds: {
				min: [finalMinX, finalMinY, finalMinZ],
				max: [finalMaxX, finalMaxY, finalMaxZ],
				center: [finalCenterX, finalCenterY, finalCenterZ],
				size: [finalSizeX, finalSizeY, finalSizeZ],
				boundingSphereRadius: sphereRadius,
			},
		};
	}

	/**
	 * Parses Wavefront .mtl material text into Material3D dictionary.
	 */
	public static parseMtl(mtlText: string): Record<string, Material3D> {
		const materials: Record<string, Material3D> = {};
		let currentMat: Material3D | null = null;

		const lines = mtlText.split(/\r?\n/);
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;

			const parts = line.split(/\s+/);
			const cmd = parts[0]?.toLowerCase();

			if (cmd === "newmtl") {
				const name = parts[1] ?? "default";
				currentMat = {
					name,
					diffuseColor: [1, 1, 1, 1],
					specularColor: [1, 1, 1],
					ambientColor: [0.2, 0.2, 0.2],
					shininess: 32.0,
					opacity: 1.0,
				};
				materials[name] = currentMat;
			} else if (currentMat) {
				if (cmd === "kd") {
					// Diffuse color: Kd r g b
					const r = Number.parseFloat(parts[1] ?? "1");
					const g = Number.parseFloat(parts[2] ?? "1");
					const b = Number.parseFloat(parts[3] ?? "1");
					currentMat.diffuseColor = [r, g, b, currentMat.diffuseColor?.[3] ?? 1.0];
				} else if (cmd === "ks") {
					// Specular color: Ks r g b
					const r = Number.parseFloat(parts[1] ?? "1");
					const g = Number.parseFloat(parts[2] ?? "1");
					const b = Number.parseFloat(parts[3] ?? "1");
					currentMat.specularColor = [r, g, b];
					currentMat.specularIntensity = (r + g + b) / 3;
				} else if (cmd === "ka") {
					// Ambient color: Ka r g b
					const r = Number.parseFloat(parts[1] ?? "0.2");
					const g = Number.parseFloat(parts[2] ?? "0.2");
					const b = Number.parseFloat(parts[3] ?? "0.2");
					currentMat.ambientColor = [r, g, b];
				} else if (cmd === "ns") {
					// Specular shininess exponent: Ns 0..1000
					currentMat.shininess = Number.parseFloat(parts[1] ?? "32");
				} else if (cmd === "d" || cmd === "tr") {
					// Opacity (d) or transparency (Tr = 1 - d)
					const val = Number.parseFloat(parts[1] ?? "1");
					currentMat.opacity = cmd === "d" ? val : 1.0 - val;
					if (currentMat.diffuseColor) {
						currentMat.diffuseColor[3] = currentMat.opacity;
					}
				} else if (cmd === "map_kd") {
					// Diffuse texture map
					currentMat.diffuseTexture = parts.slice(1).join(" ");
				} else if (cmd === "map_bump" || cmd === "bump") {
					// Normal / bump map
					currentMat.normalTexture = parts.slice(1).join(" ");
				}
			}
		}

		return materials;
	}
}

export function parseOBJ(
	objText: string,
	mtlText?: string,
	options: LoadModelOptions = {},
): Model3DData {
	return ObjLoader.parse(objText, mtlText, options);
}

export function parseMTL(mtlText: string): Record<string, Material3D> {
	return ObjLoader.parseMtl(mtlText);
}

export function loadOBJ(
	srcOrData: string | ArrayBuffer | Uint8Array,
	mtlText?: string,
	options: LoadModelOptions = {},
): Model3DData {
	let text: string;
	if (typeof srcOrData !== "string") {
		text = new TextDecoder().decode(srcOrData);
	} else {
		const trimmed = srcOrData.trim();
		const isInline =
			trimmed.startsWith("v ") ||
			trimmed.startsWith("#") ||
			trimmed.includes("\nv ") ||
			trimmed.includes("\rv ");
		if (!isInline && typeof fs !== "undefined" && fs.existsSync) {
			try {
				let filePath = srcOrData.startsWith("file://")
					? srcOrData.slice(7)
					: srcOrData;
				try {
					filePath = decodeURIComponent(filePath);
				} catch (_) {}
				if (fs.existsSync(filePath)) {
					text = fs.readFileSync(filePath, "utf-8");
					options = {
						basePath: options.basePath ?? path.dirname(filePath),
						...options,
					};
				} else {
					text = srcOrData;
				}
			} catch (_) {
				text = srcOrData;
			}
		} else {
			text = srcOrData;
		}
	}
	return ObjLoader.parse(text, mtlText, options);
}

