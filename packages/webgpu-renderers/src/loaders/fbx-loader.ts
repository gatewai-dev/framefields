import fs from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { type Mat4, Matrix4Math, type Vec3 } from "../math3d/index.js";
import {
	accumulateVertexNormals,
	resolveModelTransform,
} from "./mesh-utils.js";
import { MAX_JOINTS, poseNodes, type Quat } from "./pose.js";
import {
	isSupportedTexture,
	readTextureFile,
	textureMime,
	warnMissingTexture,
} from "./texture-files.js";
import type {
	AnimationClip3D,
	LoadModelOptions,
	Material3D,
	Mesh3DData,
	Model3DData,
	ModelNode3D,
	NodeAnimationTrack3D,
	Skin3D,
} from "./types.js";

interface FBXNode {
	name: string;
	props: unknown[];
	children: FBXNode[];
}

export class FbxLoader {
	public static readonly FBX_KTIME = 46186158000.0;

	/**
	 * Parses binary or text FBX buffer/string into Model3DData.
	 */
	public static parse(
		bufferOrString: ArrayBuffer | Uint8Array | string,
		options: LoadModelOptions = {},
	): Model3DData {
		const rootNode =
			typeof bufferOrString === "string"
				? FbxLoader.parseAscii(bufferOrString)
				: FbxLoader.isBinary(bufferOrString)
					? FbxLoader.parseBinary(bufferOrString)
					: FbxLoader.parseAscii(new TextDecoder().decode(bufferOrString));

		return FbxLoader.buildModelFromTree(rootNode, options);
	}

	public static isBinary(buffer: ArrayBuffer | Uint8Array): boolean {
		const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
		if (view.length < 27) return false;
		const header = "Kaydara FBX Binary  \0\x1a\0";
		for (let i = 0; i < header.length; i++) {
			if (view[i] !== header.charCodeAt(i)) return false;
		}
		return true;
	}

	/**
	 * Parses Binary FBX 7.x/6.x format.
	 */
	public static parseBinary(buffer: ArrayBuffer | Uint8Array): FBXNode {
		const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
		const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

		const version = view.getUint32(23, true);
		const is64Bit = version >= 7500;
		let offset = 27;

		const root: FBXNode = { name: "Root", props: [], children: [] };

		const readNode = (): FBXNode | null => {
			if (offset >= u8.byteLength) return null;

			let endOffset: number;
			let numProperties: number;
			let nameLen: number;

			if (is64Bit) {
				if (offset + 25 > u8.byteLength) return null;
				endOffset = Number(view.getBigUint64(offset, true));
				numProperties = Number(view.getBigUint64(offset + 8, true));
				nameLen = view.getUint8(offset + 24);
				offset += 25;
			} else {
				if (offset + 13 > u8.byteLength) return null;
				endOffset = view.getUint32(offset, true);
				numProperties = view.getUint32(offset + 4, true);
				nameLen = view.getUint8(offset + 12);
				offset += 13;
			}

			// Null node (0 endOffset) signifies end of child block
			if (endOffset === 0) {
				return null;
			}

			const name = new TextDecoder().decode(
				u8.subarray(offset, offset + nameLen),
			);
			offset += nameLen;

			const props: unknown[] = [];
			for (let p = 0; p < numProperties; p++) {
				const typeCode = String.fromCharCode(u8[offset]!);
				offset += 1;

				switch (typeCode) {
					case "Y": {
						props.push(view.getInt16(offset, true));
						offset += 2;
						break;
					}
					case "C":
					case "B": {
						props.push(view.getUint8(offset) !== 0);
						offset += 1;
						break;
					}
					case "I": {
						props.push(view.getInt32(offset, true));
						offset += 4;
						break;
					}
					case "F": {
						props.push(view.getFloat32(offset, true));
						offset += 4;
						break;
					}
					case "D": {
						props.push(view.getFloat64(offset, true));
						offset += 8;
						break;
					}
					case "L": {
						props.push(Number(view.getBigInt64(offset, true)));
						offset += 8;
						break;
					}
					case "S": {
						const len = view.getUint32(offset, true);
						offset += 4;
						const str = new TextDecoder().decode(
							u8.subarray(offset, offset + len),
						);
						props.push(str);
						offset += len;
						break;
					}
					case "R": {
						const len = view.getUint32(offset, true);
						offset += 4;
						const raw = u8.subarray(offset, offset + len);
						props.push(raw);
						offset += len;
						break;
					}
					case "f":
					case "d":
					case "i":
					case "l":
					case "b":
					case "c": {
						const arrayLen = view.getUint32(offset, true);
						const encoding = view.getUint32(offset + 4, true);
						const compressedLen = view.getUint32(offset + 8, true);
						offset += 12;

						let arrayBuffer: Uint8Array;
						if (encoding === 1) {
							const compressedData = u8.subarray(
								offset,
								offset + compressedLen,
							);
							arrayBuffer = inflateSync(compressedData);
							offset += compressedLen;
						} else {
							const byteSize =
								typeCode === "d" || typeCode === "l"
									? 8
									: typeCode === "f" || typeCode === "i"
										? 4
										: 1;
							const totalBytes = arrayLen * byteSize;
							arrayBuffer = u8.subarray(offset, offset + totalBytes);
							offset += totalBytes;
						}

						const arrayView = new DataView(
							arrayBuffer.buffer,
							arrayBuffer.byteOffset,
							arrayBuffer.byteLength,
						);
						if (typeCode === "f") {
							const arr = new Float32Array(arrayLen);
							for (let k = 0; k < arrayLen; k++) {
								arr[k] = arrayView.getFloat32(k * 4, true);
							}
							props.push(arr);
						} else if (typeCode === "d") {
							const arr = new Float64Array(arrayLen);
							for (let k = 0; k < arrayLen; k++) {
								arr[k] = arrayView.getFloat64(k * 8, true);
							}
							props.push(arr);
						} else if (typeCode === "i") {
							const arr = new Int32Array(arrayLen);
							for (let k = 0; k < arrayLen; k++) {
								arr[k] = arrayView.getInt32(k * 4, true);
							}
							props.push(arr);
						} else if (typeCode === "l") {
							const arr = new Float64Array(arrayLen);
							for (let k = 0; k < arrayLen; k++) {
								arr[k] = Number(arrayView.getBigInt64(k * 8, true));
							}
							props.push(arr);
						} else if (typeCode === "b") {
							const arr = new Uint8Array(arrayLen);
							for (let k = 0; k < arrayLen; k++) {
								arr[k] = arrayView.getUint8(k);
							}
							props.push(arr);
						} else {
							props.push(arrayBuffer);
						}
						break;
					}
					default:
						break;
				}
			}

			const children: FBXNode[] = [];
			while (offset < endOffset) {
				const child = readNode();
				if (child) {
					children.push(child);
				} else {
					break;
				}
			}

			offset = endOffset;
			return { name, props, children };
		};

		while (offset < u8.byteLength - (is64Bit ? 25 : 13)) {
			const node = readNode();
			if (node) {
				root.children.push(node);
			} else {
				break;
			}
		}

		return root;
	}

	/**
	 * Parses ASCII FBX format.
	 */
	public static parseAscii(text: string): FBXNode {
		const root: FBXNode = { name: "Root", props: [], children: [] };
		const stack: FBXNode[] = [root];

		const lines = text.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]?.trim();
			if (!line || line.startsWith(";")) continue;

			if (line === "}") {
				if (stack.length > 1) stack.pop();
				continue;
			}

			const colonIdx = line.indexOf(":");
			if (colonIdx === -1) continue;

			const name = line.substring(0, colonIdx).trim();
			const rest = line.substring(colonIdx + 1).trim();

			const hasBrace = rest.endsWith("{");
			const propStr = hasBrace ? rest.slice(0, -1).trim() : rest;

			const props: unknown[] = [];
			if (propStr) {
				const rawProps = propStr.split(",").map((p) => p.trim());
				for (const p of rawProps) {
					if (p.startsWith('"') && p.endsWith('"')) {
						props.push(p.slice(1, -1));
					} else if (!Number.isNaN(Number(p))) {
						props.push(Number(p));
					} else {
						props.push(p);
					}
				}
			}

			const node: FBXNode = { name, props, children: [] };
			const parent = stack[stack.length - 1];
			if (parent) {
				parent.children.push(node);
			}

			if (hasBrace) {
				stack.push(node);
			}
		}

		return root;
	}

	/** Material properties a texture can feed, by the FBX (or Maya / 3ds Max) property name. */
	private static textureSlot(prop: string): "diffuse" | "normal" | undefined {
		const p = prop.toLowerCase();
		if (
			p === "diffusecolor" ||
			p === "diffuse" ||
			p.endsWith("|basecolor") ||
			p.endsWith("|base_color") ||
			p === "basecolor"
		)
			return "diffuse";
		if (
			p === "normalmap" ||
			p.endsWith("|normalcamera") ||
			p.endsWith("|bump_map")
		)
			return "normal";
		return undefined;
	}

	/**
	 * Fills a material's diffuse / normal map from its connected Texture
	 * objects: the bytes embedded in the Video's `Content`, else the file
	 * named by `RelativeFilename` / `FileName`, looked up next to the model.
	 */
	private static attachTextures(
		material: Material3D,
		materialId: number | string,
		objects: Map<number | string, { name: string; node: FBXNode }>,
		connections: Array<{
			childId: number | string;
			parentId: number | string;
			propName?: string;
		}>,
		basePath: string | undefined,
	): void {
		const stringChild = (node: FBXNode | undefined, name: string) => {
			const value = node?.children.find((c) => c.name === name)?.props[0];
			return typeof value === "string" && value ? value : undefined;
		};
		for (const c of connections) {
			if (c.parentId !== materialId || !c.propName) continue;
			const slot = FbxLoader.textureSlot(c.propName);
			const texture = objects.get(c.childId);
			if (!slot || texture?.node.name !== "Texture") continue;
			if (
				slot === "diffuse"
					? material.diffuseTextureBuffer
					: material.normalTextureBuffer
			)
				continue;

			const video = connections
				.filter((v) => v.parentId === c.childId && !v.propName)
				.map((v) => objects.get(v.childId)?.node)
				.find((n) => n?.name === "Video");
			const ref =
				stringChild(texture.node, "RelativeFilename") ??
				stringChild(texture.node, "FileName") ??
				stringChild(video, "RelativeFilename") ??
				stringChild(video, "Filename");

			if (ref && !isSupportedTexture(ref)) {
				warnMissingTexture("FbxLoader", material.name, ref);
				continue;
			}
			let bytes: Uint8Array | undefined;
			const content = video?.children.find((n) => n.name === "Content")
				?.props[0];
			if (content instanceof Uint8Array && content.length > 0) bytes = content;
			else if (ref) bytes = readTextureFile(ref, basePath)?.bytes;

			if (!bytes) {
				if (ref) warnMissingTexture("FbxLoader", material.name, ref);
				continue;
			}
			if (slot === "diffuse") {
				material.diffuseTextureBuffer = bytes;
				material.diffuseTextureMime = textureMime(ref ?? "");
				if (ref) material.diffuseTexture = ref;
				// FBX UVs commonly tile; textures repeat by default in FBX tools.
				material.textureWrap = "repeat";
			} else {
				material.normalTextureBuffer = bytes;
				if (ref) material.normalTexture = ref;
			}
		}
	}

	/**
	 * Builds ready-to-render Model3DData from parsed FBX node tree.
	 */
	public static buildModelFromTree(
		root: FBXNode,
		options: LoadModelOptions = {},
	): Model3DData {
		const objectsNode = root.children.find((c) => c.name === "Objects");
		const connectionsNode = root.children.find((c) => c.name === "Connections");

		interface ObjectEntry {
			id: number | string;
			name: string;
			type: string;
			node: FBXNode;
		}

		const objects = new Map<number | string, ObjectEntry>();
		if (objectsNode) {
			for (const child of objectsNode.children) {
				const id = (child.props[0] as number | string) ?? 0;
				const nameWithSub = String(child.props[1] ?? "");
				const parts = nameWithSub.split("::");
				const name = parts.length > 1 ? parts[1]! : parts[0]!;
				const type = String(child.props[2] ?? child.name);
				objects.set(id, { id, name, type, node: child });
			}
		}

		// Parse connections DAG: OO (Object-Object) and OP (Object-Property)
		interface Connection {
			childId: number | string;
			parentId: number | string;
			propName?: string;
		}
		const connections: Connection[] = [];
		if (connectionsNode) {
			for (const connNode of connectionsNode.children) {
				if (connNode.name === "C" || connNode.name === "Connect") {
					const mode = String(connNode.props[0]);
					const childId = (connNode.props[1] as number | string) ?? 0;
					const parentId = (connNode.props[2] as number | string) ?? 0;
					const propName =
						mode === "OP" ? String(connNode.props[3]) : undefined;
					connections.push({ childId, parentId, propName });
				}
			}
		}

		// Geometry -> Model -> Material: a mesh uses its model's first material.
		const materialNameForGeometry = (geometryId: number | string) => {
			for (const c of connections) {
				// Some exporters connect the material to the geometry itself.
				const mat =
					c.parentId === geometryId ? objects.get(c.childId) : undefined;
				if (mat?.node.name === "Material" && !c.propName) return mat.name;
			}
			for (const g of connections) {
				if (g.childId !== geometryId || g.propName) continue;
				for (const m of connections) {
					if (m.parentId !== g.parentId || m.propName) continue;
					const mat = objects.get(m.childId);
					if (mat?.node.name === "Material") return mat.name;
				}
			}
			return undefined;
		};

		// 1. Parse Geometry Meshes
		const meshes: Mesh3DData[] = [];
		const materials: Record<string, Material3D> = {};

		function extractArrayProp(
			node: FBXNode | undefined,
		): number[] | Float32Array | Float64Array | Int32Array {
			if (!node) return [];
			if (
				node.props[0] instanceof Float32Array ||
				node.props[0] instanceof Float64Array ||
				node.props[0] instanceof Int32Array ||
				Array.isArray(node.props[0])
			) {
				return node.props[0];
			}
			const aChild = node.children.find((c) => c.name === "a");
			if (aChild && aChild.props.length > 0) {
				return aChild.props as number[];
			}
			if (
				Array.isArray(node.props) &&
				node.props.length > 0 &&
				typeof node.props[0] === "number"
			) {
				return node.props as number[];
			}
			return [];
		}

		// Scene graph: every Model is a node (glTF semantics), parented by its
		// OO connection to another Model. Pre-/post-rotations fold into the
		// rotation; pivots and offsets are not supported.
		const modelIds = [...objects.values()]
			.filter((o) => o.node.name === "Model")
			.map((o) => o.id);
		const nodeIndexById = new Map(modelIds.map((id, i) => [id, i]));
		const nodes: ModelNode3D[] = modelIds.map((id) => {
			const model = objects.get(id)!;
			const parentConn = connections.find(
				(c) => c.childId === id && !c.propName && nodeIndexById.has(c.parentId),
			);
			return {
				name: model.name,
				parent: parentConn ? nodeIndexById.get(parentConn.parentId)! : -1,
				translation: readVec3(model.node, "Lcl Translation", 0),
				rotation: modelRotation(
					model.node,
					fbxEulerToQuat(
						readVec3(model.node, "Lcl Rotation", 0),
						rotationOrder(model.node),
					),
				),
				scale: readVec3(model.node, "Lcl Scaling", 1),
			};
		});
		const modelOfGeometry = (geometryId: number | string) =>
			connections.find(
				(c) =>
					c.childId === geometryId &&
					!c.propName &&
					nodeIndexById.has(c.parentId),
			)?.parentId;

		const skins: Skin3D[] = [];
		for (const [id, entry] of objects) {
			if (
				entry.node.name === "Geometry" &&
				(entry.type === "Mesh" ||
					entry.node.props[2] === "Mesh" ||
					entry.type === "")
			) {
				const geomNode = entry.node;

				const verticesNode = geomNode.children.find(
					(c) => c.name === "Vertices",
				);
				const indicesNode = geomNode.children.find(
					(c) => c.name === "PolygonVertexIndex",
				);
				if (!verticesNode || !indicesNode) continue;

				const rawVerts = extractArrayProp(verticesNode);
				const rawPolyIndices = extractArrayProp(indicesNode);
				const layer = (
					name: string,
					data: string,
					index: string,
					size: number,
				) => {
					const node = geomNode.children.find((c) => c.name === name);
					if (!node) return undefined;
					return layerElement(
						node,
						extractArrayProp(node.children.find((c) => c.name === data)),
						extractArrayProp(node.children.find((c) => c.name === index)),
						size,
					);
				};
				const normalAt = layer(
					"LayerElementNormal",
					"Normals",
					"NormalsIndex",
					3,
				);
				const uvAt = layer("LayerElementUV", "UV", "UVIndex", 2);

				// Triangulate polygons (the last index of each is stored as -(i + 1)).
				// Each corner keeps its control point and its polygon-vertex index,
				// which ByPolygonVertex layers (normals, UVs) are indexed by.
				const corners: Array<{ cp: number; pv: number; poly: number }> = [];
				let polygon: Array<{ cp: number; pv: number }> = [];
				let polyIndex = 0;
				for (let i = 0; i < rawPolyIndices.length; i++) {
					const idx = rawPolyIndices[i]!;
					polygon.push({ cp: idx < 0 ? -(idx + 1) : idx, pv: i });
					if (idx >= 0) continue;
					for (let k = 1; k < polygon.length - 1; k++) {
						for (const c of [polygon[0]!, polygon[k]!, polygon[k + 1]!])
							corners.push({ ...c, poly: polyIndex });
					}
					polygon = [];
					polyIndex++;
				}

				const numVerts = corners.length;
				const outPositions = new Float32Array(numVerts * 3);
				const outNormals = new Float32Array(numVerts * 3);
				const outUvs = new Float32Array(numVerts * 2);
				const outIndices = new Array<number>(numVerts);
				corners.forEach(({ cp, pv, poly }, v) => {
					outPositions[v * 3] = rawVerts[cp * 3] ?? 0;
					outPositions[v * 3 + 1] = rawVerts[cp * 3 + 1] ?? 0;
					outPositions[v * 3 + 2] = rawVerts[cp * 3 + 2] ?? 0;
					const n = normalAt?.(cp, pv, poly);
					outNormals.set(n ?? [0, 0, 1], v * 3);
					const uv = uvAt?.(cp, pv, poly);
					outUvs[v * 2] = uv?.[0] ?? 0;
					outUvs[v * 2 + 1] = 1.0 - (uv?.[1] ?? 0);
					outIndices[v] = v;
				});

				if (!normalAt || options.smoothNormals) {
					outNormals.fill(0);
					accumulateVertexNormals(outPositions, outIndices, outNormals);
				}

				// Skin: each cluster deforms the control points in its Indexes by its
				// Weights, driven by the bone Model linked to it.
				const skinConn = connections.find(
					(c) =>
						c.parentId === id &&
						objects.get(c.childId)?.node.name === "Deformer" &&
						objects.get(c.childId)?.node.props[2] === "Skin",
				);

				let jointIndices: Float32Array | undefined;
				let jointWeights: Float32Array | undefined;
				let skinIndex: number | undefined;
				if (skinConn) {
					const joints: number[] = [];
					const inverseBinds: number[] = [];
					// Per control point: up to 4 (joint, weight) influences.
					const influences = new Map<number, Array<[number, number]>>();
					for (const cc of connections) {
						const cluster = objects.get(cc.childId);
						if (
							cc.parentId !== skinConn.childId ||
							cluster?.node.name !== "Deformer" ||
							cluster.node.props[2] !== "Cluster"
						)
							continue;
						const boneId = connections.find(
							(b) => b.parentId === cluster.id && nodeIndexById.has(b.childId),
						)?.childId;
						if (boneId === undefined) continue;
						const joint = joints.length;
						joints.push(nodeIndexById.get(boneId)!);
						// Vertices sit in the mesh's bind space (Transform); the bone's
						// bind-pose world matrix is TransformLink.
						const transform = matrixChild(cluster.node, "Transform");
						const link = matrixChild(cluster.node, "TransformLink");
						inverseBinds.push(
							...Matrix4Math.multiply(
								Matrix4Math.invert(link) ?? Matrix4Math.identity(),
								transform,
							),
						);
						const cpIndexes = extractArrayProp(
							cluster.node.children.find((c) => c.name === "Indexes"),
						);
						const cpWeights = extractArrayProp(
							cluster.node.children.find((c) => c.name === "Weights"),
						);
						for (let k = 0; k < cpIndexes.length; k++) {
							const weight = Number(cpWeights[k] ?? 0);
							if (!(weight > 0)) continue;
							const cp = Number(cpIndexes[k]);
							const list = influences.get(cp) ?? [];
							list.push([joint, weight]);
							influences.set(cp, list);
						}
					}
					if (joints.length > MAX_JOINTS)
						throw new Error(
							`FBX skin has ${joints.length} bones; the mesh shader holds ${MAX_JOINTS}`,
						);
					if (joints.length > 0) {
						skinIndex = skins.length;
						skins.push({
							joints,
							inverseBindMatrices: new Float32Array(inverseBinds),
						});
						jointIndices = new Float32Array(numVerts * 4);
						jointWeights = new Float32Array(numVerts * 4);
						corners.forEach(({ cp }, v) => {
							// The 4 strongest influences, renormalized to sum to 1.
							const top = (influences.get(cp) ?? [])
								.sort((a, b) => b[1] - a[1])
								.slice(0, 4);
							const total = top.reduce((sum, [, w]) => sum + w, 0);
							top.forEach(([joint, weight], slot) => {
								jointIndices![v * 4 + slot] = joint;
								jointWeights![v * 4 + slot] = total > 0 ? weight / total : 0;
							});
						});
					}
				}

				const modelId = modelOfGeometry(id);
				const isLarge = numVerts > 65535;
				meshes.push({
					id: `fbx_mesh_${id}`,
					name: entry.name,
					positions: outPositions,
					normals: outNormals,
					uvs: outUvs,
					indices: isLarge
						? new Uint32Array(outIndices)
						: new Uint16Array(outIndices),
					jointIndices,
					jointWeights,
					materialName: materialNameForGeometry(id) ?? entry.name,
					node: modelId !== undefined ? nodeIndexById.get(modelId) : undefined,
					skin: skinIndex,
				});
			}
		}

		// 2. Parse Materials
		for (const [, entry] of objects) {
			if (entry.node.name === "Material") {
				const matNode = entry.node;
				const props70 = matNode.children.find((c) => c.name === "Properties70");

				let diffuseColor: [number, number, number, number] = [1, 1, 1, 1];
				let shininess = 32.0;
				let opacity = 1.0;

				if (props70) {
					for (const p of props70.children) {
						if (p.name === "P") {
							const pName = String(p.props[0]);
							if (pName === "DiffuseColor" || pName === "Color") {
								const r = Number(p.props[4] ?? 1);
								const g = Number(p.props[5] ?? 1);
								const b = Number(p.props[6] ?? 1);
								diffuseColor = [r, g, b, 1.0];
							} else if (
								pName === "Shininess" ||
								pName === "ShininessExponent"
							) {
								shininess = Number(p.props[4] ?? 32);
							} else if (pName === "Opacity") {
								opacity = Number(p.props[4] ?? 1);
								diffuseColor[3] = opacity;
							}
						}
					}
				}

				const material: Material3D = {
					name: entry.name,
					diffuseColor,
					shininess,
					opacity,
				};
				FbxLoader.attachTextures(
					material,
					entry.id,
					objects,
					connections,
					options.basePath,
				);
				materials[entry.name] = material;
			}
		}

		// 3. Parse Animation Stacks & Takes
		const animations: AnimationClip3D[] = [];
		for (const [id, entry] of objects) {
			if (entry.node.name === "AnimationStack") {
				const stackName = entry.name || "Take 001";
				const tracks: NodeAnimationTrack3D[] = [];

				// Find connected AnimationLayer
				const layerConn = connections.find(
					(c) =>
						c.parentId === id &&
						objects.get(c.childId)?.node.name === "AnimationLayer",
				);

				if (layerConn) {
					// Find connected AnimationCurveNodes
					const curveNodeConns = connections.filter(
						(c) =>
							c.parentId === layerConn.childId &&
							objects.get(c.childId)?.node.name === "AnimationCurveNode",
					);

					// One entry per (model, transform); its X/Y/Z curves merge into one track.
					const groups = new Map<
						string,
						{
							nodeName: string;
							modelId: number | string | undefined;
							model: FBXNode | undefined;
							kind: TransformKind;
							defaults: Vec3;
							channels: Array<FbxCurve | undefined>;
						}
					>();

					for (const cnc of curveNodeConns) {
						const curveNodeObj = objects.get(cnc.childId);
						if (!curveNodeObj) continue;

						// Find connected Model/Bone; the OP connection names the property.
						const modelConn = connections.find(
							(c) =>
								c.childId === curveNodeObj.id &&
								objects.get(c.parentId)?.node.name === "Model",
						);
						const targetModel = modelConn
							? objects.get(modelConn.parentId)
							: undefined;
						const kind =
							transformKindFromProperty(modelConn?.propName) ??
							transformKindFromProperty(curveNodeObj.name);
						if (!kind) continue;

						const key = `${targetModel?.id ?? curveNodeObj.id}|${kind}`;
						let group = groups.get(key);
						if (!group) {
							const model = targetModel?.node;
							group = {
								nodeName: targetModel?.name ?? curveNodeObj.name,
								modelId: targetModel?.id,
								model,
								kind,
								defaults: staticTransform(model, curveNodeObj.node, kind),
								channels: [undefined, undefined, undefined],
							};
							groups.set(key, group);
						}

						// Find connected AnimationCurves; "d|X" / "d|Y" / "d|Z" pick the channel.
						const curveConns = connections.filter(
							(c) =>
								c.parentId === curveNodeObj.id &&
								objects.get(c.childId)?.node.name === "AnimationCurve",
						);
						curveConns.forEach((cc, order) => {
							const axis = axisFromProperty(cc.propName) ?? order;
							if (axis > 2) return;
							const curveObj = objects.get(cc.childId)?.node;
							const times = extractArrayProp(
								curveObj?.children.find((c) => c.name === "KeyTime"),
							);
							const values = extractArrayProp(
								curveObj?.children.find((c) => c.name === "KeyValueFloat"),
							);
							const n = Math.min(times.length, values.length);
							if (n === 0) return;
							group.channels[axis] = {
								times: Array.from(times.slice(0, n), (t) => Number(t)),
								values: Array.from(values.slice(0, n), (v) => Number(v)),
							};
						});
					}

					for (const group of groups.values()) {
						const track = buildTransformTrack(group);
						if (!track) continue;
						if (group.modelId !== undefined)
							track.node = nodeIndexById.get(group.modelId);
						// Rotation keys are Lcl Rotation; the node also carries pre/post rotation.
						if (track.rotations && group.model) {
							for (let k = 0; k < track.rotations.length; k += 4) {
								const q = Array.from(
									track.rotations.subarray(k, k + 4),
								) as Quat;
								track.rotations.set(modelRotation(group.model, q), k);
							}
						}
						tracks.push(track);
					}
				}

				let maxDuration = 1.0;
				for (const t of tracks) {
					if (t.times.length > 0) {
						const lastT = t.times[t.times.length - 1] ?? 0;
						if (lastT > maxDuration) maxDuration = lastT;
					}
				}

				animations.push({
					name: stackName,
					duration: maxDuration,
					fps: 30,
					tracks,
				});
			}
		}

		// Bounds of the meshes where the rest pose places them; centering and
		// size become a root transform, since skinned vertices move with bones.
		const model: Model3DData = {
			meshes,
			materials,
			animations,
			nodes,
			skins,
			bounds: {
				min: [0, 0, 0],
				max: [0, 0, 0],
				center: [0, 0, 0],
				size: [0, 0, 0],
				boundingSphereRadius: 0,
			},
		};
		const rest = poseNodes(model, undefined, 0);
		const lo: Vec3 = [Infinity, Infinity, Infinity];
		const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
		for (const mesh of meshes) {
			const place = mesh.node !== undefined ? rest[mesh.node] : undefined;
			for (let i = 0; i < mesh.positions.length; i += 3) {
				const p: Vec3 = [
					mesh.positions[i]!,
					mesh.positions[i + 1]!,
					mesh.positions[i + 2]!,
				];
				const q = place ? Matrix4Math.projectPoint(place, p) : p;
				for (let a = 0; a < 3; a++) {
					if (q[a]! < lo[a]!) lo[a] = q[a]!;
					if (q[a]! > hi[a]!) hi[a] = q[a]!;
				}
			}
		}
		if (!Number.isFinite(lo[0])) {
			lo.fill(-1);
			hi.fill(1);
		}
		const { offset, scale } = resolveModelTransform(
			{
				min: lo,
				max: hi,
				center: [
					(lo[0] + hi[0]) * 0.5,
					(lo[1] + hi[1]) * 0.5,
					(lo[2] + hi[2]) * 0.5,
				],
				size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
			},
			options,
		);
		model.rootTransform = Matrix4Math.multiply(
			Matrix4Math.scale(scale[0], scale[1], scale[2]),
			Matrix4Math.translate(-offset[0], -offset[1], -offset[2]),
		);
		const min: Vec3 = [0, 1, 2].map(
			(a) => (lo[a]! - offset[a]!) * scale[a]!,
		) as Vec3;
		const max: Vec3 = [0, 1, 2].map(
			(a) => (hi[a]! - offset[a]!) * scale[a]!,
		) as Vec3;
		model.bounds = {
			min,
			max,
			center: [
				(min[0] + max[0]) * 0.5,
				(min[1] + max[1]) * 0.5,
				(min[2] + max[2]) * 0.5,
			],
			size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
			boundingSphereRadius:
				Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 0.5,
		};
		return model;
	}
}

/** A Properties70 vector (Lcl Translation / Rotation / Scaling), `fallback` where absent. */
function readVec3(node: FBXNode, name: string, fallback: number): Vec3 {
	const v = readProperty70(node, name);
	return [0, 1, 2].map((a) => {
		const x = v?.[a];
		return x !== undefined && Number.isFinite(x) ? x : fallback;
	}) as Vec3;
}

function multiplyQuat(a: Quat, b: Quat): Quat {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

/**
 * A Model's full local rotation for an Lcl Rotation `q`:
 * PreRotation · q · PostRotation⁻¹ (FBX always applies pre/post in XYZ order).
 */
function modelRotation(model: FBXNode, q: Quat): Quat {
	const pre = readProperty70(model, "PreRotation");
	const post = readProperty70(model, "PostRotation");
	let out = q;
	if (pre)
		out = multiplyQuat(fbxEulerToQuat(readVec3(model, "PreRotation", 0)), out);
	if (post) {
		const p = fbxEulerToQuat(readVec3(model, "PostRotation", 0));
		out = multiplyQuat(out, [-p[0], -p[1], -p[2], p[3]]);
	}
	return out;
}

/** A 4×4 matrix child (`Transform: *16 { a: … }`), identity when absent. */
function matrixChild(node: FBXNode, name: string): Mat4 {
	const child = node.children.find((c) => c.name === name);
	const raw =
		child?.children.find((c) => c.name === "a")?.props ?? child?.props;
	const values =
		raw?.[0] instanceof Float64Array || raw?.[0] instanceof Float32Array
			? Array.from(raw[0] as ArrayLike<number>)
			: (raw ?? []).map(Number);
	return values.length === 16 ? (values as Mat4) : Matrix4Math.identity();
}

/**
 * A geometry layer (normals, UVs) as a lookup by corner: its mapping says
 * whether values are per control point, per polygon vertex, per polygon or
 * one for all; IndexToDirect layers go through their index array.
 */
function layerElement(
	layer: FBXNode,
	data: ArrayLike<number>,
	index: ArrayLike<number>,
	size: number,
): ((cp: number, pv: number, poly: number) => number[]) | undefined {
	if (data.length === 0) return undefined;
	const text = (name: string) =>
		String(layer.children.find((c) => c.name === name)?.props[0] ?? "");
	const mapping = text("MappingInformationType");
	const indexed =
		/^Index/.test(text("ReferenceInformationType")) && index.length > 0;
	return (cp, pv, poly) => {
		let i =
			mapping === "ByPolygonVertex"
				? pv
				: mapping === "ByPolygon"
					? poly
					: mapping === "AllSame"
						? 0
						: cp; // ByControlPoint / ByVertice
		if (indexed) i = Number(index[i] ?? i);
		return Array.from({ length: size }, (_, c) =>
			Number(data[i * size + c] ?? 0),
		);
	};
}

/** Which local transform an AnimationCurveNode drives. */
type TransformKind = "T" | "R" | "S";

/** One AnimationCurve channel; times stay in FBX KTime ticks. */
interface FbxCurve {
	times: number[];
	values: number[];
}

/**
 * Classifies a curve node from its OP connection property ("Lcl Translation",
 * "Lcl Rotation", "Lcl Scaling") or, failing that, its short name ("T", "R", "S").
 */
function transformKindFromProperty(
	name: string | undefined,
): TransformKind | undefined {
	switch (name) {
		case "Lcl Translation":
		case "T":
			return "T";
		case "Lcl Rotation":
		case "R":
			return "R";
		case "Lcl Scaling":
		case "S":
			return "S";
		default:
			return undefined;
	}
}

/** Channel index of a curve from its curve-node connection property ("d|X" → 0). */
function axisFromProperty(name: string | undefined): number | undefined {
	switch (name) {
		case "d|X":
			return 0;
		case "d|Y":
			return 1;
		case "d|Z":
			return 2;
		default:
			return undefined;
	}
}

/** Numeric values of a Properties70 `P` entry (they start at props[4]). */
function readProperty70(
	node: FBXNode | undefined,
	name: string,
): number[] | undefined {
	const props70 = node?.children.find((c) => c.name === "Properties70");
	const p = props70?.children.find(
		(c) => c.name === "P" && c.props[0] === name,
	);
	if (!p) return undefined;
	return p.props.slice(4).map((v) => Number(v));
}

/** A model's rest value for one transform, used where a channel has no curve. */
function staticTransform(
	model: FBXNode | undefined,
	curveNode: FBXNode,
	kind: TransformKind,
): Vec3 {
	const fallback = kind === "S" ? 1 : 0;
	const modelProp = readProperty70(
		model,
		kind === "T"
			? "Lcl Translation"
			: kind === "R"
				? "Lcl Rotation"
				: "Lcl Scaling",
	);
	const out: Vec3 = [fallback, fallback, fallback];
	for (let axis = 0; axis < 3; axis++) {
		const fromModel = modelProp?.[axis];
		const fromCurveNode = readProperty70(curveNode, `d|${"XYZ"[axis]}`)?.[0];
		const value = fromModel ?? fromCurveNode;
		if (value !== undefined && Number.isFinite(value)) out[axis] = value;
	}
	return out;
}

/** FBX EOrder enum (Model "RotationOrder"): axes in the order they are applied. */
const FBX_ROTATION_ORDERS = ["XYZ", "XZY", "YZX", "YXZ", "ZXY", "ZYX"] as const;

function rotationOrder(model: FBXNode | undefined): string {
	const order = readProperty70(model, "RotationOrder")?.[0] ?? 0;
	// 6 (eSphericXYZ) and anything unknown fall back to XYZ.
	return FBX_ROTATION_ORDERS[order] ?? "XYZ";
}

/**
 * Euler degrees → [x, y, z, w] quaternion. FBX applies the axes in `order`
 * (XYZ: X first, so R = Rz·Ry·Rx).
 */
export function fbxEulerToQuat(
	degrees: Vec3,
	order = "XYZ",
): [number, number, number, number] {
	let q: [number, number, number, number] = [0, 0, 0, 1];
	for (const axisName of order) {
		const axis = "XYZ".indexOf(axisName);
		const half = ((degrees[axis] ?? 0) * Math.PI) / 360;
		const s = Math.sin(half);
		const a: [number, number, number, number] = [0, 0, 0, Math.cos(half)];
		a[axis] = s;
		// q = a · q: each later axis is applied after the ones before it.
		q = [
			a[3] * q[0] + a[0] * q[3] + a[1] * q[2] - a[2] * q[1],
			a[3] * q[1] - a[0] * q[2] + a[1] * q[3] + a[2] * q[0],
			a[3] * q[2] + a[0] * q[1] - a[1] * q[0] + a[2] * q[3],
			a[3] * q[3] - a[0] * q[0] - a[1] * q[1] - a[2] * q[2],
		];
	}
	return q;
}

/** Linear sample of a curve at `t` (KTime ticks), clamped to its ends. */
function sampleCurve(curve: FbxCurve, t: number): number {
	const { times, values } = curve;
	const last = times.length - 1;
	if (t <= times[0]!) return values[0]!;
	if (t >= times[last]!) return values[last]!;
	let k = 0;
	while (k < last - 1 && times[k + 1]! <= t) k++;
	const t0 = times[k]!;
	const t1 = times[k + 1]!;
	const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
	return values[k]! + (values[k + 1]! - values[k]!) * u;
}

/**
 * Merges a transform's X/Y/Z curves onto one sorted key set: channels without
 * a key at some time are interpolated, channels without a curve keep the
 * static value. Rotations become quaternions in the model's RotationOrder.
 */
function buildTransformTrack(group: {
	nodeName: string;
	model: FBXNode | undefined;
	kind: TransformKind;
	defaults: Vec3;
	channels: Array<FbxCurve | undefined>;
}): NodeAnimationTrack3D | undefined {
	const keySet = new Set<number>();
	for (const channel of group.channels) {
		for (const t of channel?.times ?? []) keySet.add(t);
	}
	if (keySet.size === 0) return undefined;
	const keys = [...keySet].sort((a, b) => a - b);

	const times = new Float32Array(keys.length);
	const isRotation = group.kind === "R";
	const values = new Float32Array(keys.length * (isRotation ? 4 : 3));
	const order = isRotation ? rotationOrder(group.model) : "XYZ";
	let prev: [number, number, number, number] | undefined;

	keys.forEach((key, k) => {
		times[k] = key / FbxLoader.FBX_KTIME;
		const v: Vec3 = [0, 1, 2].map((axis) => {
			const channel = group.channels[axis];
			return channel ? sampleCurve(channel, key) : group.defaults[axis]!;
		}) as Vec3;
		if (!isRotation) {
			values.set(v, k * 3);
			return;
		}
		const q = fbxEulerToQuat(v, order);
		// Keep neighbours in the same hemisphere so slerp takes the short way.
		if (
			prev &&
			prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0
		) {
			for (let i = 0; i < 4; i++) q[i] = -q[i]!;
		}
		prev = q;
		values.set(q, k * 4);
	});

	return {
		nodeName: group.nodeName,
		times,
		translations: group.kind === "T" ? values : undefined,
		rotations: isRotation ? values : undefined,
		scales: group.kind === "S" ? values : undefined,
	};
}

export function parseFBX(
	bufferOrText: ArrayBuffer | Uint8Array | string,
	options: LoadModelOptions = {},
): Model3DData {
	return FbxLoader.parse(bufferOrText, options);
}

export function loadFBX(
	srcOrData: string | ArrayBuffer | Uint8Array,
	options: LoadModelOptions = {},
): Model3DData {
	let data: string | ArrayBuffer | Uint8Array = srcOrData;
	if (typeof srcOrData === "string") {
		const trimmed = srcOrData.trim();
		const isInline =
			trimmed.includes("FBXHeaderExtension") || trimmed.includes("Kaydara FBX");
		if (!isInline && typeof fs !== "undefined" && fs.existsSync) {
			try {
				let filePath = srcOrData.startsWith("file://")
					? srcOrData.slice(7)
					: srcOrData;
				try {
					filePath = decodeURIComponent(filePath);
				} catch (_) {}
				if (fs.existsSync(filePath)) {
					const buf = fs.readFileSync(filePath);
					data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
					// Textures are looked up next to the model.
					options = { basePath: path.dirname(filePath), ...options };
				}
			} catch (_) {}
		}
	}
	return FbxLoader.parse(data, options);
}
