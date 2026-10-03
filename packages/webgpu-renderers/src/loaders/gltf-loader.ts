import fs from "node:fs";
import path from "node:path";
import { type Mat4, Matrix4Math, type Vec3 } from "../math3d/index.js";
import { MAX_JOINTS, poseNodes } from "./pose.js";
import type {
	AnimationClip3D,
	LoadModelOptions,
	Material3D,
	Model3DData,
	ModelNode3D,
	NodeAnimationTrack3D,
} from "./types.js";

const COMPONENTS: Record<string, number> = {
	SCALAR: 1,
	VEC2: 2,
	VEC3: 3,
	VEC4: 4,
	MAT2: 4,
	MAT3: 9,
	MAT4: 16,
};

const COMPONENT_BYTES: Record<number, number> = {
	5120: 1,
	5121: 1,
	5122: 2,
	5123: 2,
	5125: 4,
	5126: 4,
};

/** Reads one component; normalized integers map to [0, 1] (unsigned) or [-1, 1] (signed). */
function componentReader(
	componentType: number,
	normalized = false,
): (dv: DataView, at: number) => number {
	switch (componentType) {
		case 5120:
			return normalized
				? (dv, at) => Math.max(dv.getInt8(at) / 127, -1)
				: (dv, at) => dv.getInt8(at);
		case 5121:
			return normalized
				? (dv, at) => dv.getUint8(at) / 255
				: (dv, at) => dv.getUint8(at);
		case 5122:
			return normalized
				? (dv, at) => Math.max(dv.getInt16(at, true) / 32767, -1)
				: (dv, at) => dv.getInt16(at, true);
		case 5123:
			return normalized
				? (dv, at) => dv.getUint16(at, true) / 65535
				: (dv, at) => dv.getUint16(at, true);
		case 5125:
			return (dv, at) => dv.getUint32(at, true);
		default:
			return (dv, at) => dv.getFloat32(at, true);
	}
}

interface GltfHeader {
	magic: number;
	version: number;
	length: number;
}

interface GltfAccessor {
	bufferView?: number;
	byteOffset?: number;
	componentType: number;
	normalized?: boolean;
	count: number;
	type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT2" | "MAT3" | "MAT4";
	max?: number[];
	min?: number[];
}

interface GltfBufferView {
	buffer: number;
	byteOffset?: number;
	byteLength: number;
	byteStride?: number;
	target?: number;
}

interface GltfBuffer {
	uri?: string;
	byteLength: number;
}

interface GltfPrimitive {
	attributes: {
		POSITION?: number;
		NORMAL?: number;
		TANGENT?: number;
		TEXCOORD_0?: number;
		TEXCOORD_1?: number;
		COLOR_0?: number;
		JOINTS_0?: number;
		WEIGHTS_0?: number;
	};
	indices?: number;
	material?: number;
	mode?: number; // 4 = TRIANGLES
}

interface GltfMesh {
	name?: string;
	primitives: GltfPrimitive[];
}

interface GltfMaterial {
	name?: string;
	pbrMetallicRoughness?: {
		baseColorFactor?: [number, number, number, number];
		metallicFactor?: number;
		roughnessFactor?: number;
		baseColorTexture?: { index: number; texCoord?: number };
	};
	emissiveFactor?: [number, number, number];
	doubleSided?: boolean;
	alphaMode?: "OPAQUE" | "MASK" | "BLEND";
	alphaCutoff?: number;
	extensions?: {
		KHR_materials_unlit?: Record<string, never>;
		/** VRM 1.0 toon material: the base is lit flat, the shadowed side tinted by shadeColorFactor. */
		VRMC_materials_mtoon?: { shadeColorFactor?: [number, number, number] };
	};
}

interface GltfImage {
	uri?: string;
	mimeType?: string;
	bufferView?: number;
}

interface GltfTexture {
	source?: number;
	sampler?: number;
}

interface GltfSampler {
	wrapS?: number;
	wrapT?: number;
}

interface GltfNode {
	name?: string;
	camera?: number;
	children?: number[];
	skin?: number;
	matrix?: number[];
	mesh?: number;
	rotation?: [number, number, number, number]; // [x, y, z, w] quaternion
	scale?: [number, number, number];
	translation?: [number, number, number];
}

interface GltfSkin {
	name?: string;
	inverseBindMatrices?: number;
	skeleton?: number;
	joints: number[];
}

interface GltfAnimationSampler {
	input: number; // Accessor index for timestamps
	output: number; // Accessor index for values
	interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE";
}

interface GltfAnimationChannel {
	sampler: number;
	target: {
		node?: number;
		path: "translation" | "rotation" | "scale" | "weights";
	};
}

interface GltfAnimation {
	name?: string;
	samplers: GltfAnimationSampler[];
	channels: GltfAnimationChannel[];
}

interface GltfDocument {
	asset?: { version: string };
	scene?: number;
	scenes?: Array<{ name?: string; nodes?: number[] }>;
	nodes?: GltfNode[];
	meshes?: GltfMesh[];
	materials?: GltfMaterial[];
	skins?: GltfSkin[];
	animations?: GltfAnimation[];
	images?: GltfImage[];
	textures?: GltfTexture[];
	samplers?: GltfSampler[];
	accessors?: GltfAccessor[];
	bufferViews?: GltfBufferView[];
	buffers?: GltfBuffer[];
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"

export class GltfLoader {
	/**
	 * Checks if the given buffer starts with the GLB binary container magic bytes.
	 */
	public static isGlb(buffer: Uint8Array | ArrayBuffer): boolean {
		const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
		if (bytes.length < 12) return false;
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		return view.getUint32(0, true) === GLB_MAGIC;
	}

	/**
	 * Parses glTF or GLB data into Model3DData.
	 */
	public static parse(
		data: string | Uint8Array | ArrayBuffer,
		options: LoadModelOptions = {},
		basePath?: string,
	): Model3DData {
		let doc: GltfDocument;
		const binaryBuffers: Uint8Array[] = [];

		if (typeof data === "string") {
			try {
				doc = JSON.parse(data) as GltfDocument;
			} catch (err) {
				throw new Error(`Failed to parse glTF JSON: ${String(err)}`);
			}
		} else {
			const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
			if (GltfLoader.isGlb(bytes)) {
				const glb = GltfLoader.unpackGlb(bytes);
				doc = glb.doc;
				if (glb.binBuffer) {
					binaryBuffers.push(glb.binBuffer);
				}
			} else {
				const text = new TextDecoder("utf-8").decode(bytes);
				doc = JSON.parse(text) as GltfDocument;
			}
		}

		// Load referenced external buffers or data URIs
		if (doc.buffers) {
			for (let i = 0; i < doc.buffers.length; i++) {
				if (i === 0 && binaryBuffers.length > 0) continue; // Already provided by GLB BIN chunk

				const buf = doc.buffers[i]!;
				if (buf.uri) {
					if (buf.uri.startsWith("data:")) {
						const base64Index = buf.uri.indexOf("base64,");
						if (base64Index !== -1) {
							const b64 = buf.uri.substring(base64Index + 7);
							const rawBuf = Buffer.from(b64, "base64");
							binaryBuffers[i] = new Uint8Array(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);
						}
					} else if (basePath) {
						const resolved = path.isAbsolute(buf.uri) ? buf.uri : path.join(basePath, buf.uri);
						if (fs.existsSync(resolved)) {
							const fileBuf = fs.readFileSync(resolved);
							binaryBuffers[i] = new Uint8Array(fileBuf.buffer, fileBuf.byteOffset, fileBuf.byteLength);
						}
					}
				}
			}
		}

		return GltfLoader.buildModel(doc, binaryBuffers, options, basePath);
	}

	private static unpackGlb(bytes: Uint8Array): { doc: GltfDocument; binBuffer?: Uint8Array } {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const magic = view.getUint32(0, true);
		const version = view.getUint32(4, true);
		const totalLength = view.getUint32(8, true);

		if (magic !== GLB_MAGIC) {
			throw new Error("Invalid GLB header: magic mismatch");
		}

		let offset = 12;
		let doc: GltfDocument | null = null;
		let binBuffer: Uint8Array | undefined;

		while (offset < totalLength && offset < bytes.byteLength) {
			const chunkLength = view.getUint32(offset, true);
			const chunkType = view.getUint32(offset + 4, true);
			offset += 8;

			const chunkData = bytes.subarray(offset, offset + chunkLength);
			offset += chunkLength;

			if (chunkType === CHUNK_TYPE_JSON) {
				const jsonStr = new TextDecoder("utf-8").decode(chunkData);
				doc = JSON.parse(jsonStr) as GltfDocument;
			} else if (chunkType === CHUNK_TYPE_BIN) {
				binBuffer = chunkData;
			}
		}

		if (!doc) {
			throw new Error("Invalid GLB: JSON chunk not found");
		}

		return { doc, binBuffer };
	}

	/**
	 * Reads an accessor as floats: honours interleaved views (byteStride) and
	 * normalized integer components. Integer data that is not normalized
	 * (joint indices) keeps its values.
	 */
	private static readFloats(
		doc: GltfDocument,
		binaryBuffers: Uint8Array[],
		accessorIndex: number,
	): { data: Float32Array; itemSize: number; count: number } {
		const accessor = doc.accessors?.[accessorIndex];
		if (!accessor) throw new Error(`Accessor ${accessorIndex} not found`);
		const itemSize = COMPONENTS[accessor.type] ?? 1;
		const out = new Float32Array(accessor.count * itemSize);
		if (accessor.bufferView === undefined)
			return { data: out, itemSize, count: accessor.count };

		const view = doc.bufferViews?.[accessor.bufferView];
		if (!view) throw new Error(`BufferView ${accessor.bufferView} not found`);
		const raw = binaryBuffers[view.buffer];
		if (!raw) throw new Error(`Binary buffer ${view.buffer} not loaded`);

		const bytes = COMPONENT_BYTES[accessor.componentType] ?? 4;
		const stride = view.byteStride ?? bytes * itemSize;
		const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
		const read = componentReader(accessor.componentType, accessor.normalized);
		for (let i = 0; i < accessor.count; i++) {
			for (let c = 0; c < itemSize; c++) {
				out[i * itemSize + c] = read(dv, base + i * stride + c * bytes);
			}
		}
		return { data: out, itemSize, count: accessor.count };
	}

	private static readIndices(
		doc: GltfDocument,
		binaryBuffers: Uint8Array[],
		accessorIndex: number,
	): Uint16Array | Uint32Array {
		const { data } = GltfLoader.readFloats(doc, binaryBuffers, accessorIndex);
		const max = data.reduce((m, v) => (v > m ? v : m), 0);
		return max > 65535 ? Uint32Array.from(data) : Uint16Array.from(data);
	}

	/** An image's encoded bytes, from the binary chunk, a data URI or a file next to the model. */
	private static imageBytes(
		doc: GltfDocument,
		binaryBuffers: Uint8Array[],
		imageIndex: number,
		basePath?: string,
	): { bytes: Uint8Array; mime: string } | undefined {
		const image = doc.images?.[imageIndex];
		if (!image) return undefined;
		if (image.bufferView !== undefined) {
			const view = doc.bufferViews?.[image.bufferView];
			const raw = view ? binaryBuffers[view.buffer] : undefined;
			if (!view || !raw) return undefined;
			const start = view.byteOffset ?? 0;
			return {
				bytes: raw.subarray(start, start + view.byteLength),
				mime: image.mimeType ?? "image/png",
			};
		}
		if (!image.uri) return undefined;
		if (image.uri.startsWith("data:")) {
			const comma = image.uri.indexOf(",");
			const mime = image.uri.slice(5, image.uri.indexOf(";"));
			return {
				bytes: new Uint8Array(Buffer.from(image.uri.slice(comma + 1), "base64")),
				mime,
			};
		}
		if (!basePath) return undefined;
		const file = path.isAbsolute(image.uri)
			? image.uri
			: path.join(basePath, decodeURIComponent(image.uri));
		if (!fs.existsSync(file)) return undefined;
		const ext = path.extname(file).toLowerCase();
		return {
			bytes: new Uint8Array(fs.readFileSync(file)),
			mime: image.mimeType ?? (ext === ".png" ? "image/png" : "image/jpeg"),
		};
	}

	private static buildMaterial(
		doc: GltfDocument,
		binaryBuffers: Uint8Array[],
		mat: GltfMaterial,
		name: string,
		basePath?: string,
	): Material3D {
		const pbr = mat.pbrMetallicRoughness;
		const baseColor = pbr?.baseColorFactor ?? [1, 1, 1, 1];
		const material: Material3D = {
			name,
			diffuseColor: baseColor,
			roughness: pbr?.roughnessFactor ?? 0.5,
			metallic: pbr?.metallicFactor ?? 0.0,
			shininess: 32.0 * (1.0 - (pbr?.roughnessFactor ?? 0.5)),
			opacity: baseColor[3] ?? 1.0,
			twoSided: mat.doubleSided ?? true,
			alphaMode:
				mat.alphaMode === "MASK"
					? "mask"
					: mat.alphaMode === "BLEND"
						? "blend"
						: "opaque",
			alphaCutoff: mat.alphaMode === "MASK" ? (mat.alphaCutoff ?? 0.5) : 0,
		};
		const mtoon = mat.extensions?.VRMC_materials_mtoon;
		if (mtoon) {
			material.shading = "toon";
			material.shadeColor = mtoon.shadeColorFactor ?? [1, 1, 1];
		} else if (mat.extensions?.KHR_materials_unlit) {
			material.shading = "unlit";
		}
		const texRef = pbr?.baseColorTexture;
		const texture = texRef ? doc.textures?.[texRef.index] : undefined;
		if (texture?.source !== undefined) {
			const image = GltfLoader.imageBytes(
				doc,
				binaryBuffers,
				texture.source,
				basePath,
			);
			if (image) {
				material.diffuseTextureBuffer = image.bytes;
				material.diffuseTextureMime = image.mime;
				const wrap =
					texture.sampler !== undefined
						? doc.samplers?.[texture.sampler]?.wrapS
						: undefined;
				material.textureWrap =
					wrap === 33071 ? "clamp" : wrap === 33648 ? "mirror" : "repeat";
			}
		}
		return material;
	}

	private static buildNodes(doc: GltfDocument): ModelNode3D[] {
		const nodes: ModelNode3D[] = (doc.nodes ?? []).map((n, i) => ({
			name: n.name ?? `node_${i}`,
			parent: -1,
			translation: n.translation ?? [0, 0, 0],
			rotation: n.rotation ?? [0, 0, 0, 1],
			scale: n.scale ?? [1, 1, 1],
			matrix: n.matrix ? (n.matrix as Mat4) : undefined,
		}));
		(doc.nodes ?? []).forEach((n, i) => {
			for (const c of n.children ?? []) {
				const child = nodes[c];
				if (child) child.parent = i;
			}
		});
		return nodes;
	}

	private static buildAnimations(
		doc: GltfDocument,
		binaryBuffers: Uint8Array[],
		nodes: ModelNode3D[],
	): AnimationClip3D[] {
		return (doc.animations ?? []).map((animDef, animIdx) => {
			const tracks: NodeAnimationTrack3D[] = [];
			let duration = 0;
			for (const chan of animDef.channels) {
				const sampler = animDef.samplers[chan.sampler];
				const node = chan.target.node;
				if (!sampler || node === undefined || chan.target.path === "weights")
					continue;
				const times = GltfLoader.readFloats(doc, binaryBuffers, sampler.input).data;
				const values = GltfLoader.readFloats(doc, binaryBuffers, sampler.output).data;
				duration = Math.max(duration, times[times.length - 1] ?? 0);
				const track: NodeAnimationTrack3D = {
					nodeName: nodes[node]?.name ?? `node_${node}`,
					node,
					times,
					interpolation:
						sampler.interpolation === "STEP"
							? "step"
							: sampler.interpolation === "CUBICSPLINE"
								? "cubic"
								: "linear",
				};
				if (chan.target.path === "translation") track.translations = values;
				else if (chan.target.path === "rotation") track.rotations = values;
				else track.scales = values;
				tracks.push(track);
			}
			return {
				name: animDef.name ?? `Animation_${animIdx}`,
				duration: duration > 0 ? duration : 1.0,
				fps: 30,
				tracks,
			};
		});
	}

	private static buildModel(
		doc: GltfDocument,
		binaryBuffers: Uint8Array[],
		options: LoadModelOptions,
		basePath?: string,
	): Model3DData {
		// Material keys must be unique: glTF names are optional and may repeat.
		const materialKeys = (doc.materials ?? []).map((mat, idx, all) => {
			const name = mat.name ?? `material_${idx}`;
			return all.findIndex((m, j) => (m.name ?? `material_${j}`) === name) === idx
				? name
				: `${name}#${idx}`;
		});
		const materials: Record<string, Material3D> = {};
		(doc.materials ?? []).forEach((mat, idx) => {
			const key = materialKeys[idx]!;
			materials[key] = GltfLoader.buildMaterial(doc, binaryBuffers, mat, key, basePath);
		});

		const nodes = GltfLoader.buildNodes(doc);
		const skins = (doc.skins ?? []).map((skin) => ({
			joints: skin.joints,
			inverseBindMatrices:
				skin.inverseBindMatrices !== undefined
					? GltfLoader.readFloats(doc, binaryBuffers, skin.inverseBindMatrices).data
					: Float32Array.from(
							skin.joints.flatMap(() => Matrix4Math.identity()),
						),
		}));
		const animations = GltfLoader.buildAnimations(doc, binaryBuffers, nodes);

		// Meshes are drawn where nodes place them; a file without nodes draws each mesh once.
		const placed = (doc.nodes ?? []).flatMap((n, node) =>
			n.mesh !== undefined ? [{ mesh: n.mesh, node, skin: n.skin }] : [],
		);
		const instances: { mesh: number; node?: number; skin?: number }[] =
			placed.length > 0 ? placed : (doc.meshes ?? []).map((_, mesh) => ({ mesh }));

		const model: Model3DData = {
			name: "glTF_Model",
			meshes: [],
			materials,
			nodes,
			skins,
			animations,
			bounds: {
				min: [0, 0, 0],
				max: [0, 0, 0],
				center: [0, 0, 0],
				size: [0, 0, 0],
				boundingSphereRadius: 0,
			},
		};
		const rest = poseNodes(model, undefined, 0);

		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
		const grow = (x: number, y: number, z: number) => {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		};

		for (const inst of instances) {
			const meshDef = doc.meshes?.[inst.mesh];
			if (!meshDef) continue;
			meshDef.primitives.forEach((prim, primIdx) => {
				if (prim.attributes.POSITION === undefined) return;
				if (prim.mode !== undefined && prim.mode !== 4) return;
				const read = (acc: number | undefined) =>
					acc === undefined ? undefined : GltfLoader.readFloats(doc, binaryBuffers, acc);

				const pos = read(prim.attributes.POSITION)!;
				const numVerts = pos.count;
				const colors = read(prim.attributes.COLOR_0);
				let rgba: Float32Array | undefined;
				if (colors) {
					rgba = new Float32Array(numVerts * 4).fill(1);
					for (let v = 0; v < numVerts; v++)
						for (let c = 0; c < colors.itemSize; c++)
							rgba[v * 4 + c] = colors.data[v * colors.itemSize + c] ?? 1;
				}

				let indices: Uint16Array | Uint32Array;
				if (prim.indices !== undefined) {
					indices = GltfLoader.readIndices(doc, binaryBuffers, prim.indices);
				} else {
					indices = numVerts > 65535 ? new Uint32Array(numVerts) : new Uint16Array(numVerts);
					for (let i = 0; i < numVerts; i++) indices[i] = i;
				}

				// Skinned vertices are in bind (model) space; others sit under their node.
				const skinned = inst.skin !== undefined && prim.attributes.JOINTS_0 !== undefined;
				const place = !skinned && inst.node !== undefined ? rest[inst.node] : undefined;
				for (let i = 0; i < numVerts; i++) {
					const x = pos.data[i * 3]!;
					const y = pos.data[i * 3 + 1]!;
					const z = pos.data[i * 3 + 2]!;
					if (place) {
						const p = Matrix4Math.projectPoint(place, [x, y, z]);
						grow(p[0], p[1], p[2]);
					} else grow(x, y, z);
				}

				model.meshes.push({
					id: `gltf_mesh_${inst.mesh}_${primIdx}${inst.node !== undefined ? `_n${inst.node}` : ""}`,
					name: meshDef.name ?? `Mesh_${inst.mesh}`,
					positions: pos.data,
					normals: read(prim.attributes.NORMAL)?.data ?? new Float32Array(numVerts * 3),
					uvs: read(prim.attributes.TEXCOORD_0)?.data ?? new Float32Array(numVerts * 2),
					colors: rgba,
					jointIndices: skinned ? read(prim.attributes.JOINTS_0)?.data : undefined,
					jointWeights: skinned ? read(prim.attributes.WEIGHTS_0)?.data : undefined,
					indices,
					materialName: prim.material !== undefined ? materialKeys[prim.material] : undefined,
					node: inst.node,
					skin: skinned ? inst.skin : undefined,
				});
			});
		}

		for (const skin of skins) {
			if (skin.joints.length > MAX_JOINTS)
				throw new Error(
					`glTF skin has ${skin.joints.length} joints; the mesh shader holds ${MAX_JOINTS}`,
				);
		}

		if (!Number.isFinite(minX)) {
			minX = minY = minZ = 0;
			maxX = maxY = maxZ = 0;
		}

		const maxDimension = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.0001);
		const fit =
			options.normalizeSize && options.normalizeSize > 0
				? options.normalizeSize / maxDimension
				: 1.0;
		const extra: Vec3 =
			typeof options.scale === "number"
				? [options.scale, options.scale, options.scale]
				: (options.scale ?? [1, 1, 1]);
		const scale: Vec3 = [fit * extra[0], fit * extra[1], fit * extra[2]];
		const offset: Vec3 = options.center
			? [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5]
			: [0, 0, 0];

		// Skinned vertices move with their joints, so centering and size are a
		// root transform above the scene graph rather than baked into vertices.
		model.rootTransform = Matrix4Math.multiply(
			Matrix4Math.scale(scale[0], scale[1], scale[2]),
			Matrix4Math.translate(-offset[0], -offset[1], -offset[2]),
		);

		const lo: Vec3 = [
			(minX - offset[0]) * scale[0],
			(minY - offset[1]) * scale[1],
			(minZ - offset[2]) * scale[2],
		];
		const hi: Vec3 = [
			(maxX - offset[0]) * scale[0],
			(maxY - offset[1]) * scale[1],
			(maxZ - offset[2]) * scale[2],
		];
		model.bounds = {
			min: lo,
			max: hi,
			center: [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5],
			size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
			boundingSphereRadius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.5,
		};
		return model;
	}

	/**
	 * Loads a glTF / GLB file synchronously or asynchronously from a path or URL.
	 */
	public static load(
		srcOrData: string | ArrayBuffer | Uint8Array,
		options: LoadModelOptions = {},
	): Model3DData {
		if (typeof srcOrData !== "string") {
			return GltfLoader.parse(srcOrData, options);
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
			const basePath = path.dirname(cleanPath);
			return GltfLoader.parse(buf, options, basePath);
		}

		return GltfLoader.parse(srcOrData, options);
	}
}

export function parseGLTF(
	data: string | Uint8Array | ArrayBuffer,
	options: LoadModelOptions = {},
): Model3DData {
	return GltfLoader.parse(data, options);
}

export function loadGLTF(
	srcOrData: string | ArrayBuffer | Uint8Array,
	options: LoadModelOptions = {},
): Model3DData {
	return GltfLoader.load(srcOrData, options);
}

export function parseGLB(
	data: Uint8Array | ArrayBuffer,
	options: LoadModelOptions = {},
): Model3DData {
	return GltfLoader.parse(data, options);
}

export function loadGLB(
	srcOrData: string | ArrayBuffer | Uint8Array,
	options: LoadModelOptions = {},
): Model3DData {
	return GltfLoader.load(srcOrData, options);
}
