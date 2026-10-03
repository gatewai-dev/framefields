import fs from "node:fs";
import { inflateSync } from "node:zlib";
import { type Vec3, Vector3Math } from "../math3d/index.js";
import type {
	AnimationClip3D,
	LoadModelOptions,
	Material3D,
	Mesh3DData,
	Model3DData,
	NodeAnimationTrack3D,
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
		const view =
			buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
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

		// 1. Parse Geometry Meshes
		const meshes: Mesh3DData[] = [];
		const materials: Record<string, Material3D> = {};

		function extractArrayProp(node: FBXNode | undefined): number[] | Float32Array | Float64Array | Int32Array {
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
			if (Array.isArray(node.props) && node.props.length > 0 && typeof node.props[0] === "number") {
				return node.props as number[];
			}
			return [];
		}

		for (const [id, entry] of objects) {
			if (entry.node.name === "Geometry" && (entry.type === "Mesh" || entry.node.props[2] === "Mesh" || entry.type === "")) {
				const geomNode = entry.node;

				const verticesNode = geomNode.children.find(
					(c) => c.name === "Vertices",
				);
				const indicesNode = geomNode.children.find(
					(c) => c.name === "PolygonVertexIndex",
				);
				const normalLayer = geomNode.children.find(
					(c) => c.name === "LayerElementNormal",
				);
				const uvLayer = geomNode.children.find(
					(c) => c.name === "LayerElementUV",
				);

				if (!verticesNode || !indicesNode) continue;

				const rawVerts = extractArrayProp(verticesNode);
				const rawPolyIndices = extractArrayProp(indicesNode);

				const normalsNode = normalLayer?.children.find(
					(c) => c.name === "Normals",
				);
				const rawNormals = extractArrayProp(normalsNode);

				const uvsNode = uvLayer?.children.find((c) => c.name === "UV");
				const uvIndexNode = uvLayer?.children.find(
					(c) => c.name === "UVIndex",
				);
				const rawUvs = extractArrayProp(uvsNode);
				const rawUvIndices = extractArrayProp(uvIndexNode);


				// Triangulate polygons (indices with negative termination)
				const triangles: Array<[number, number, number]> = [];
				const triVertexIndexSequence: number[] = [];

				let polygon: number[] = [];
				for (let i = 0; i < rawPolyIndices.length; i++) {
					const idx = rawPolyIndices[i]!;
					if (idx < 0) {
						// End of polygon: real index is -(idx + 1)
						polygon.push(-(idx + 1));
						triVertexIndexSequence.push(i);

						if (polygon.length >= 3) {
							for (let k = 1; k < polygon.length - 1; k++) {
								triangles.push([polygon[0]!, polygon[k]!, polygon[k + 1]!]);
							}
						}
						polygon = [];
					} else {
						polygon.push(idx);
						triVertexIndexSequence.push(i);
					}
				}

				const outPositions: number[] = [];
				const outNormals: number[] = [];
				const outUvs: number[] = [];
				const outIndices: number[] = [];

				for (let t = 0; t < triangles.length; t++) {
					const tri = triangles[t]!;
					for (let v = 0; v < 3; v++) {
						const vertIdx = tri[v]!;
						const outIdx = outPositions.length / 3;

						const px = rawVerts[vertIdx * 3] ?? 0;
						const py = rawVerts[vertIdx * 3 + 1] ?? 0;
						const pz = rawVerts[vertIdx * 3 + 2] ?? 0;
						outPositions.push(px, py, pz);

						// Normals
						if (rawNormals.length > 0) {
							const nx = rawNormals[vertIdx * 3] ?? 0;
							const ny = rawNormals[vertIdx * 3 + 1] ?? 0;
							const nz = rawNormals[vertIdx * 3 + 2] ?? 0;
							outNormals.push(nx, ny, nz);
						} else {
							outNormals.push(0, 0, 1);
						}

						// UVs
						if (rawUvs.length > 0) {
							let uvIdx = vertIdx;
							if (rawUvIndices.length > 0) {
								uvIdx = rawUvIndices[vertIdx] ?? vertIdx;
							}
							const u = rawUvs[uvIdx * 2] ?? 0;
							const v = rawUvs[uvIdx * 2 + 1] ?? 0;
							outUvs.push(u, 1.0 - v);
						} else {
							outUvs.push(0, 0);
						}

						outIndices.push(outIdx);
					}
				}

				// Generate normals if missing
				if (rawNormals.length === 0 || options.smoothNormals) {
					const computedNormals = new Float32Array(outPositions.length);
					for (let i = 0; i < outIndices.length; i += 3) {
						const i0 = outIndices[i]!;
						const i1 = outIndices[i + 1]!;
						const i2 = outIndices[i + 2]!;

						const p0: Vec3 = [
							outPositions[i0 * 3]!,
							outPositions[i0 * 3 + 1]!,
							outPositions[i0 * 3 + 2]!,
						];
						const p1: Vec3 = [
							outPositions[i1 * 3]!,
							outPositions[i1 * 3 + 1]!,
							outPositions[i1 * 3 + 2]!,
						];
						const p2: Vec3 = [
							outPositions[i2 * 3]!,
							outPositions[i2 * 3 + 1]!,
							outPositions[i2 * 3 + 2]!,
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

					for (let v = 0; v < outPositions.length / 3; v++) {
						const nx = computedNormals[v * 3]!;
						const ny = computedNormals[v * 3 + 1]!;
						const nz = computedNormals[v * 3 + 2]!;
						const len = Math.hypot(nx, ny, nz) || 1.0;
						outNormals[v * 3] = nx / len;
						outNormals[v * 3 + 1] = ny / len;
						outNormals[v * 3 + 2] = nz / len;
					}
				}

				// Find associated deformers/skins
				const skinConn = connections.find(
					(c) =>
						c.parentId === id &&
						objects.get(c.childId)?.type === "Deformer" &&
						objects.get(c.childId)?.node.props[2] === "Skin",
				);

				let jointIndices: Float32Array | undefined;
				let jointWeights: Float32Array | undefined;

				if (skinConn) {
					const numVerts = outPositions.length / 3;
					jointIndices = new Float32Array(numVerts * 4);
					jointWeights = new Float32Array(numVerts * 4);

					const clusterConns = connections.filter(
						(c) =>
							c.parentId === skinConn.childId &&
							objects.get(c.childId)?.type === "Deformer" &&
							objects.get(c.childId)?.node.props[2] === "Cluster",
					);

					clusterConns.forEach((cc, boneIdx) => {
						const clusterNode = objects.get(cc.childId)?.node;
						const indexesNode = clusterNode?.children.find(
							(c) => c.name === "Indexes",
						);
						const weightsNode = clusterNode?.children.find(
							(c) => c.name === "Weights",
						);

						if (indexesNode && weightsNode) {
							const cIndexes = extractArrayProp(indexesNode);
							const cWeights = extractArrayProp(weightsNode);

							for (let k = 0; k < cIndexes.length; k++) {
								const weight = cWeights[k] ?? 0;

								// Apply weight to all duplicated vertices referencing originalVert
								for (let v = 0; v < numVerts; v++) {
									// Slot into lowest available slot in 4-component vector
									for (let slot = 0; slot < 4; slot++) {
										if (jointWeights![v * 4 + slot] === 0) {
											jointIndices![v * 4 + slot] = boneIdx;
											jointWeights![v * 4 + slot] = weight;
											break;
										}
									}
								}
							}
						}
					});
				}

				const isLarge = outPositions.length / 3 > 65535;
				meshes.push({
					id: `fbx_mesh_${id}`,
					name: entry.name,
					positions: new Float32Array(outPositions),
					normals: new Float32Array(outNormals),
					uvs: new Float32Array(outUvs),
					indices: isLarge
						? new Uint32Array(outIndices)
						: new Uint16Array(outIndices),
					jointIndices,
					jointWeights,
					materialName: entry.name,
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
							} else if (pName === "Shininess" || pName === "ShininessExponent") {
								shininess = Number(p.props[4] ?? 32);
							} else if (pName === "Opacity") {
								opacity = Number(p.props[4] ?? 1);
								diffuseColor[3] = opacity;
							}
						}
					}
				}

				materials[entry.name] = {
					name: entry.name,
					diffuseColor,
					shininess,
					opacity,
				};
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
						if (track) tracks.push(track);
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

		// Calculate bounds across all meshes
		let minX = Infinity;
		let minY = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let maxZ = -Infinity;

		for (const mesh of meshes) {
			for (let i = 0; i < mesh.positions.length; i += 3) {
				const x = mesh.positions[i]!;
				const y = mesh.positions[i + 1]!;
				const z = mesh.positions[i + 2]!;
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (z < minZ) minZ = z;
				if (x > maxX) maxX = x;
				if (y > maxY) maxY = y;
				if (z > maxZ) maxZ = z;
			}
		}

		if (!Number.isFinite(minX)) {
			minX = -1;
			minY = -1;
			minZ = -1;
			maxX = 1;
			maxY = 1;
			maxZ = 1;
		}

		const sizeX = maxX - minX;
		const sizeY = maxY - minY;
		const sizeZ = maxZ - minZ;
		const centerX = (minX + maxX) * 0.5;
		const centerY = (minY + maxY) * 0.5;
		const centerZ = (minZ + maxZ) * 0.5;
		const sphereRadius = Math.hypot(sizeX, sizeY, sizeZ) * 0.5;

		return {
			meshes,
			materials,
			animations,
			bounds: {
				min: [minX, minY, minZ],
				max: [maxX, maxY, maxZ],
				center: [centerX, centerY, centerZ],
				size: [sizeX, sizeY, sizeZ],
				boundingSphereRadius: sphereRadius,
			},
		};
	}
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
function transformKindFromProperty(name: string | undefined): TransformKind | undefined {
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
function readProperty70(node: FBXNode | undefined, name: string): number[] | undefined {
	const props70 = node?.children.find((c) => c.name === "Properties70");
	const p = props70?.children.find((c) => c.name === "P" && c.props[0] === name);
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
		kind === "T" ? "Lcl Translation" : kind === "R" ? "Lcl Rotation" : "Lcl Scaling",
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
		if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) {
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
			trimmed.includes("FBXHeaderExtension") ||
			trimmed.includes("Kaydara FBX");
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
				}
			} catch (_) {}
		}
	}
	return FbxLoader.parse(data, options);
}

