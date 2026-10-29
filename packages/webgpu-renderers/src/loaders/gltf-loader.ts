import fs from "node:fs";
import path from "node:path";
import draco from "draco3dgltf";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { type Mat4, Matrix4Math, type Vec3 } from "../math3d/index.js";
import { poseNodes } from "./pose.js";
import { textureMime } from "./texture-files.js";
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

interface GltfAccessor {
	bufferView?: number;
	byteOffset?: number;
	componentType: number;
	normalized?: boolean;
	count: number;
	type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT2" | "MAT3" | "MAT4";
	max?: number[];
	min?: number[];
	sparse?: {
		count: number;
		indices: {
			bufferView: number;
			byteOffset?: number;
			componentType: 5121 | 5123 | 5125;
		};
		values: { bufferView: number; byteOffset?: number };
	};
}

interface MeshoptExtension {
	buffer: number;
	byteOffset?: number;
	byteLength: number;
	byteStride: number;
	count: number;
	mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
	filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL" | "COLOR";
}

interface GltfBufferView {
	buffer: number;
	byteOffset?: number;
	byteLength: number;
	byteStride?: number;
	target?: number;
	extensions?: {
		EXT_meshopt_compression?: MeshoptExtension;
		KHR_meshopt_compression?: MeshoptExtension;
	};
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
	targets?: { POSITION?: number; NORMAL?: number; TANGENT?: number }[];
	extensions?: {
		KHR_draco_mesh_compression?: {
			bufferView: number;
			attributes: Record<string, number>;
		};
	};
	decodedDraco?: {
		attributes: Record<number, Float32Array>;
		indices: Uint16Array | Uint32Array;
	};
}

interface GltfMesh {
	name?: string;
	weights?: number[];
	primitives: GltfPrimitive[];
}

interface GltfTextureTransform {
	offset?: [number, number];
	rotation?: number;
	scale?: [number, number];
	texCoord?: number;
}

interface GltfTextureInfo {
	index: number;
	texCoord?: number;
	extensions?: { KHR_texture_transform?: GltfTextureTransform };
}

interface GltfMaterial {
	name?: string;
	pbrMetallicRoughness?: {
		baseColorFactor?: [number, number, number, number];
		metallicFactor?: number;
		roughnessFactor?: number;
		baseColorTexture?: GltfTextureInfo;
		metallicRoughnessTexture?: GltfTextureInfo;
	};
	normalTexture?: GltfTextureInfo & { scale?: number };
	occlusionTexture?: GltfTextureInfo & { strength?: number };
	emissiveTexture?: GltfTextureInfo;
	emissiveFactor?: [number, number, number];
	doubleSided?: boolean;
	alphaMode?: "OPAQUE" | "MASK" | "BLEND";
	alphaCutoff?: number;
	extensions?: {
		KHR_materials_unlit?: Record<string, never>;
		KHR_materials_emissive_strength?: { emissiveStrength?: number };
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
	extensions?: {
		EXT_texture_webp?: { source?: number };
		KHR_texture_basisu?: { source?: number };
	};
}

interface GltfSampler {
	magFilter?: number;
	minFilter?: number;
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
	weights?: number[];
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
	extensionsUsed?: string[];
	extensionsRequired?: string[];
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

/** Required extensions whose semantics this loader implements. */
const SUPPORTED_REQUIRED_EXTENSIONS = new Set([
	"KHR_materials_unlit",
	"KHR_materials_emissive_strength",
	"KHR_texture_transform",
	"KHR_texture_basisu",
	"EXT_texture_webp",
]);

/** Converts glTF's strip, loop and fan modes to GPU list primitives. */
function expandPrimitive(
	indices: Uint16Array | Uint32Array,
	mode: number,
): {
	indices: Uint16Array | Uint32Array;
	topology: "triangle-list" | "line-list" | "point-list";
} {
	if (mode === 0) return { indices, topology: "point-list" };
	if (mode === 1) {
		if (indices.length % 2 !== 0)
			throw new Error("glTF LINES index count must be even");
		return { indices, topology: "line-list" };
	}
	if (mode === 4) return { indices, topology: "triangle-list" };
	if (![2, 3, 5, 6].includes(mode))
		throw new Error(`Invalid glTF primitive mode ${mode}`);
	const out: number[] = [];
	if (mode === 2 || mode === 3) {
		for (let i = 1; i < indices.length; i++)
			out.push(indices[i - 1]!, indices[i]!);
		if (mode === 2 && indices.length > 1)
			out.push(indices[indices.length - 1]!, indices[0]!);
	} else {
		for (let i = 2; i < indices.length; i++) {
			if (mode === 6) out.push(indices[0]!, indices[i - 1]!, indices[i]!);
			else if (i % 2 === 0)
				out.push(indices[i - 2]!, indices[i - 1]!, indices[i]!);
			else out.push(indices[i - 1]!, indices[i - 2]!, indices[i]!);
		}
	}
	return {
		indices:
			indices instanceof Uint32Array
				? Uint32Array.from(out)
				: Uint16Array.from(out),
		topology: mode <= 3 ? "line-list" : "triangle-list",
	};
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"

export class GltfLoader {
	/**
	 * Checks if the given buffer starts with the GLB binary container magic bytes.
	 */
	public static isGlb(buffer: Uint8Array | ArrayBuffer): boolean {
		const bytes =
			buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
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
		const { doc, binaryBuffers } = GltfLoader.readDocument(data, basePath);
		GltfLoader.checkExtensions(doc);
		for (const mesh of doc.meshes ?? []) {
			for (const primitive of mesh.primitives) {
				const compressed = primitive.extensions?.KHR_draco_mesh_compression;
				if (!compressed) continue;
				if (primitive.indices !== undefined) {
					const indexAccessor = doc.accessors?.[primitive.indices];
					if (
						!indexAccessor ||
						(indexAccessor.bufferView === undefined && !indexAccessor.sparse)
					) {
						throw new Error(
							"Draco indices without an uncompressed fallback require GltfLoader.parseAsync",
						);
					}
				}
				for (const semantic of Object.keys(compressed.attributes)) {
					const index = (
						primitive.attributes as Record<string, number | undefined>
					)[semantic];
					const accessor =
						index === undefined ? undefined : doc.accessors?.[index];
					if (
						!accessor ||
						(accessor.bufferView === undefined && !accessor.sparse)
					) {
						throw new Error(
							"Draco geometry without an uncompressed fallback requires GltfLoader.parseAsync",
						);
					}
				}
			}
		}
		return GltfLoader.buildModel(doc, binaryBuffers, options, basePath);
	}

	/** Asynchronous import initializes WASM decoders before reading compressed buffers. */
	public static async parseAsync(
		data: string | Uint8Array | ArrayBuffer,
		options: LoadModelOptions = {},
		basePath?: string,
	): Promise<Model3DData> {
		const { doc, binaryBuffers } = GltfLoader.readDocument(data, basePath);
		GltfLoader.checkExtensions(
			doc,
			new Set([
				"EXT_meshopt_compression",
				"KHR_meshopt_compression",
				"KHR_draco_mesh_compression",
			]),
		);
		await GltfLoader.decodeMeshopt(doc, binaryBuffers);
		await GltfLoader.decodeDraco(doc, binaryBuffers);
		return GltfLoader.buildModel(doc, binaryBuffers, options, basePath);
	}

	private static checkExtensions(
		doc: GltfDocument,
		extra: Set<string> = new Set(),
	): void {
		for (const ext of doc.extensionsRequired ?? []) {
			if (!SUPPORTED_REQUIRED_EXTENSIONS.has(ext) && !extra.has(ext)) {
				throw new Error(
					`glTF file requires ${ext}, which framefields cannot decode or render`,
				);
			}
		}
	}

	private static async decodeMeshopt(
		doc: GltfDocument,
		buffers: Uint8Array[],
	): Promise<void> {
		const views = (doc.bufferViews ?? []).filter(
			(view) =>
				view.extensions?.EXT_meshopt_compression ||
				view.extensions?.KHR_meshopt_compression,
		);
		if (!views.length) return;
		await MeshoptDecoder.ready;
		for (const view of views) {
			if (
				view.extensions?.EXT_meshopt_compression &&
				view.extensions?.KHR_meshopt_compression
			) {
				throw new Error(
					"A buffer view cannot use both EXT and KHR meshopt compression",
				);
			}
			const ext =
				view.extensions?.KHR_meshopt_compression ??
				view.extensions?.EXT_meshopt_compression;
			if (!ext) continue;
			const source = buffers[ext.buffer];
			if (!source) throw new Error(`meshopt buffer ${ext.buffer} not loaded`);
			const offset = ext.byteOffset ?? 0;
			if (
				offset < 0 ||
				ext.byteLength < 0 ||
				offset + ext.byteLength > source.byteLength
			)
				throw new Error("Invalid meshopt compressed buffer range");
			const length = ext.count * ext.byteStride;
			if (
				!Number.isSafeInteger(ext.count) ||
				ext.count < 0 ||
				!Number.isSafeInteger(ext.byteStride) ||
				ext.byteStride < 1 ||
				!Number.isSafeInteger(length) ||
				length !== view.byteLength
			) {
				throw new Error("Invalid meshopt decoded buffer length");
			}
			if (
				!["ATTRIBUTES", "TRIANGLES", "INDICES"].includes(ext.mode) ||
				!["NONE", "OCTAHEDRAL", "QUATERNION", "EXPONENTIAL", "COLOR"].includes(
					ext.filter ?? "NONE",
				)
			) {
				throw new Error("Invalid meshopt compression mode or filter");
			}
			const decoded = new Uint8Array(length);
			MeshoptDecoder.decodeGltfBuffer(
				decoded,
				ext.count,
				ext.byteStride,
				source.subarray(offset, offset + ext.byteLength),
				ext.mode,
				ext.filter ?? "NONE",
			);
			view.buffer = buffers.length;
			view.byteOffset = 0;
			buffers.push(decoded);
		}
	}

	private static async decodeDraco(
		doc: GltfDocument,
		buffers: Uint8Array[],
	): Promise<void> {
		const primitives = (doc.meshes ?? [])
			.flatMap((mesh) => mesh.primitives)
			.filter((primitive) => primitive.extensions?.KHR_draco_mesh_compression);
		if (!primitives.length) return;
		const module = await draco.createDecoderModule({});
		const decoder = new module.Decoder();
		try {
			for (const primitive of primitives) {
				const ext = primitive.extensions?.KHR_draco_mesh_compression;
				if (!ext) continue;
				const view = doc.bufferViews?.[ext.bufferView];
				if (!view)
					throw new Error(`Draco bufferView ${ext.bufferView} not found`);
				const source = buffers[view.buffer];
				if (!source) throw new Error(`Draco buffer ${view.buffer} not loaded`);
				const offset = view.byteOffset ?? 0;
				if (offset < 0 || offset + view.byteLength > source.byteLength)
					throw new Error("Invalid Draco buffer range");
				const compressed = source.subarray(offset, offset + view.byteLength);
				const input = new module.DecoderBuffer();
				const mesh = new module.Mesh();
				try {
					input.Init(
						new Int8Array(
							compressed.buffer,
							compressed.byteOffset,
							compressed.byteLength,
						),
						compressed.byteLength,
					);
					if (decoder.GetEncodedGeometryType(input) !== module.TRIANGULAR_MESH)
						throw new Error("Draco primitive is not a triangular mesh");
					const status = decoder.DecodeBufferToMesh(input, mesh);
					const success = status.ok();
					const message = success ? "" : status.error_msg();
					module.destroy(status);
					if (!success) throw new Error(`Draco decode failed: ${message}`);
					const attributes: Record<number, Float32Array> = {};
					for (const [semantic, id] of Object.entries(ext.attributes)) {
						const accessorIndex = (
							primitive.attributes as Record<string, number | undefined>
						)[semantic];
						const accessor =
							accessorIndex === undefined
								? undefined
								: doc.accessors?.[accessorIndex];
						if (accessorIndex === undefined || !accessor)
							throw new Error(`Draco ${semantic} accessor not found`);
						const attribute = decoder.GetAttributeByUniqueId(mesh, id);
						if (!attribute)
							throw new Error(`Draco ${semantic} attribute ${id} not found`);
						const array = new module.DracoFloat32Array();
						try {
							if (
								!decoder.GetAttributeFloatForAllPoints(mesh, attribute, array)
							)
								throw new Error(`Failed to decode Draco ${semantic}`);
							const count =
								mesh.num_points() * (COMPONENTS[accessor.type] ?? 1);
							if (
								accessor.count !== mesh.num_points() ||
								array.size() !== count
							)
								throw new Error(`Invalid Draco ${semantic} attribute size`);
							const values = new Float32Array(count);
							for (let i = 0; i < count; i++) {
								let value = array.GetValue(i);
								if (accessor.normalized) {
									if (accessor.componentType === 5120)
										value = Math.max(value / 127, -1);
									else if (accessor.componentType === 5121) value /= 255;
									else if (accessor.componentType === 5122)
										value = Math.max(value / 32767, -1);
									else if (accessor.componentType === 5123) value /= 65535;
								}
								values[i] = value;
							}
							attributes[accessorIndex] = values;
						} finally {
							module.destroy(array);
						}
					}
					const indices =
						mesh.num_points() > 65535
							? new Uint32Array(mesh.num_faces() * 3)
							: new Uint16Array(mesh.num_faces() * 3);
					const face = new module.DracoInt32Array();
					try {
						for (let i = 0; i < mesh.num_faces(); i++) {
							if (!decoder.GetFaceFromMesh(mesh, i, face))
								throw new Error(`Failed to decode Draco face ${i}`);
							for (let j = 0; j < 3; j++) indices[i * 3 + j] = face.GetValue(j);
						}
					} finally {
						module.destroy(face);
					}
					primitive.decodedDraco = { attributes, indices };
				} finally {
					module.destroy(mesh);
					module.destroy(input);
				}
			}
		} finally {
			module.destroy(decoder);
		}
	}

	private static readDocument(
		data: string | Uint8Array | ArrayBuffer,
		basePath?: string,
	): { doc: GltfDocument; binaryBuffers: Uint8Array[] } {
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
							binaryBuffers[i] = new Uint8Array(
								rawBuf.buffer,
								rawBuf.byteOffset,
								rawBuf.byteLength,
							);
						}
					} else if (basePath) {
						const resolved = path.isAbsolute(buf.uri)
							? buf.uri
							: path.join(basePath, buf.uri);
						if (fs.existsSync(resolved)) {
							const fileBuf = fs.readFileSync(resolved);
							binaryBuffers[i] = new Uint8Array(
								fileBuf.buffer,
								fileBuf.byteOffset,
								fileBuf.byteLength,
							);
						}
					}
				}
			}
		}

		return { doc, binaryBuffers };
	}

	private static unpackGlb(bytes: Uint8Array): {
		doc: GltfDocument;
		binBuffer?: Uint8Array;
	} {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const magic = view.getUint32(0, true);
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
		const bytes = COMPONENT_BYTES[accessor.componentType] ?? 4;
		const read = componentReader(accessor.componentType, accessor.normalized);
		if (accessor.bufferView !== undefined) {
			const view = doc.bufferViews?.[accessor.bufferView];
			if (!view) throw new Error(`BufferView ${accessor.bufferView} not found`);
			const raw = binaryBuffers[view.buffer];
			if (!raw) throw new Error(`Binary buffer ${view.buffer} not loaded`);
			const stride = view.byteStride ?? bytes * itemSize;
			const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
			const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
			for (let i = 0; i < accessor.count; i++) {
				for (let c = 0; c < itemSize; c++)
					out[i * itemSize + c] = read(dv, base + i * stride + c * bytes);
			}
		}
		if (accessor.sparse) {
			const sparse = accessor.sparse;
			const indexView = doc.bufferViews?.[sparse.indices.bufferView];
			const valueView = doc.bufferViews?.[sparse.values.bufferView];
			if (!indexView || !valueView)
				throw new Error(
					`Sparse accessor ${accessorIndex} references a missing buffer view`,
				);
			const indexData = binaryBuffers[indexView.buffer];
			const valueData = binaryBuffers[valueView.buffer];
			if (!indexData || !valueData)
				throw new Error(
					`Sparse accessor ${accessorIndex} references a missing buffer`,
				);
			const indexReader = componentReader(sparse.indices.componentType);
			const indexBytes = COMPONENT_BYTES[sparse.indices.componentType];
			const indexDv = new DataView(
				indexData.buffer,
				indexData.byteOffset,
				indexData.byteLength,
			);
			const valueDv = new DataView(
				valueData.buffer,
				valueData.byteOffset,
				valueData.byteLength,
			);
			const indexBase =
				(indexView.byteOffset ?? 0) + (sparse.indices.byteOffset ?? 0);
			const valueBase =
				(valueView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0);
			for (let i = 0; i < sparse.count; i++) {
				const index = indexReader(indexDv, indexBase + i * indexBytes);
				if (index >= accessor.count)
					throw new Error(
						`Sparse accessor ${accessorIndex} index ${index} is out of range`,
					);
				for (let c = 0; c < itemSize; c++)
					out[index * itemSize + c] = read(
						valueDv,
						valueBase + (i * itemSize + c) * bytes,
					);
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
				bytes: new Uint8Array(
					Buffer.from(image.uri.slice(comma + 1), "base64"),
				),
				mime,
			};
		}
		if (!basePath) return undefined;
		const file = path.isAbsolute(image.uri)
			? image.uri
			: path.join(basePath, decodeURIComponent(image.uri));
		if (!fs.existsSync(file)) {
			GltfLoader.warn(
				`Image "${image.uri}" was not found next to the model; textures using it are skipped.`,
			);
			return undefined;
		}
		return {
			bytes: new Uint8Array(fs.readFileSync(file)),
			mime: image.mimeType ?? textureMime(file),
		};
	}

	private static warn(message: string): void {
		console.warn(`[GltfLoader] ${message}`);
	}

	/** The UV set of a texture reference (KHR_texture_transform may override it). */
	private static texCoordOf(info: GltfTextureInfo): number {
		return (
			info.extensions?.KHR_texture_transform?.texCoord ?? info.texCoord ?? 0
		);
	}

	/**
	 * A texture's decodable image: EXT_texture_webp's source when present.
	 * Basis KTX2 and EXT_texture_webp override a texture's fallback source.
	 */
	private static textureImage(
		doc: GltfDocument,
		binaryBuffers: Uint8Array[],
		textureIndex: number,
		basePath: string | undefined,
		label: string,
	): { bytes: Uint8Array; mime: string; sampler?: GltfSampler } | undefined {
		const texture = doc.textures?.[textureIndex];
		if (!texture) return undefined;
		const source =
			texture.extensions?.KHR_texture_basisu?.source ??
			texture.extensions?.EXT_texture_webp?.source ??
			texture.source;
		if (source === undefined) return undefined;
		const image = GltfLoader.imageBytes(doc, binaryBuffers, source, basePath);
		if (!image) return undefined;
		if (!SUPPORTED_IMAGE_MIMES.has(image.mime)) {
			GltfLoader.warn(
				`${label} is ${image.mime}, which framefields cannot decode; it is skipped (use PNG, JPEG or WebP).`,
			);
			return undefined;
		}
		const sampler =
			texture.sampler !== undefined
				? doc.samplers?.[texture.sampler]
				: undefined;
		return { ...image, sampler };
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
			twoSided: mat.doubleSided ?? true,
			alphaMode:
				mat.alphaMode === "MASK"
					? "mask"
					: mat.alphaMode === "BLEND"
						? "blend"
						: "opaque",
			alphaCutoff: mat.alphaMode === "MASK" ? (mat.alphaCutoff ?? 0.5) : 0,
		};
		const e = mat.emissiveFactor;
		if (e && (e[0] > 0 || e[1] > 0 || e[2] > 0)) {
			material.emissive = [e[0], e[1], e[2]];
			material.emissiveStrength =
				mat.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
		}
		const mtoon = mat.extensions?.VRMC_materials_mtoon;
		if (mtoon) {
			material.shading = "toon";
			material.shadeColor = mtoon.shadeColorFactor ?? [1, 1, 1];
		} else if (mat.extensions?.KHR_materials_unlit) {
			material.shading = "unlit";
		}
		const image = (info: GltfTextureInfo | undefined, slot: string) => {
			if (!info) return undefined;
			return GltfLoader.textureImage(
				doc,
				binaryBuffers,
				info.index,
				basePath,
				`The ${slot} map of material "${name}"`,
			);
		};
		const base = image(pbr?.baseColorTexture, "base color");
		if (base) {
			material.diffuseTextureBuffer = base.bytes;
			material.diffuseTextureMime = base.mime;
			const wrap = base.sampler?.wrapS;
			material.textureWrap =
				wrap === 33071 ? "clamp" : wrap === 33648 ? "mirror" : "repeat";
			if (base.sampler?.magFilter === 9728) material.textureFilter = "nearest";
		}
		const mapBytes = (info: GltfTextureInfo | undefined, slot: string) =>
			image(info, slot)?.bytes;
		const normal = mapBytes(mat.normalTexture, "normal");
		if (normal) {
			material.normalTextureBuffer = normal;
			material.normalScale = mat.normalTexture?.scale ?? 1;
		}
		const mr = mapBytes(pbr?.metallicRoughnessTexture, "metallic-roughness");
		if (mr) {
			material.metallicRoughnessTextureBuffer = mr;
			// With a map the factors scale it, and glTF's default factor is 1.
			material.roughness = pbr?.roughnessFactor ?? 1;
			material.metallic = pbr?.metallicFactor ?? 1;
		}
		const occlusion = mapBytes(mat.occlusionTexture, "occlusion");
		if (occlusion) {
			material.occlusionTextureBuffer = occlusion;
			material.occlusionStrength = mat.occlusionTexture?.strength ?? 1;
		}
		// glTF's emissiveFactor defaults to 0: a map alone does not glow.
		const emissiveMap =
			material.emissive && mapBytes(mat.emissiveTexture, "emissive");
		if (emissiveMap) material.emissiveTextureBuffer = emissiveMap;
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
				if (!sampler || node === undefined) continue;
				const times = GltfLoader.readFloats(
					doc,
					binaryBuffers,
					sampler.input,
				).data;
				const values = GltfLoader.readFloats(
					doc,
					binaryBuffers,
					sampler.output,
				).data;
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
				else if (chan.target.path === "scale") track.scales = values;
				else track.weights = values;
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
			return all.findIndex((m, j) => (m.name ?? `material_${j}`) === name) ===
				idx
				? name
				: `${name}#${idx}`;
		});
		const materials: Record<string, Material3D> = {};
		(doc.materials ?? []).forEach((mat, idx) => {
			const key = materialKeys[idx]!;
			materials[key] = GltfLoader.buildMaterial(
				doc,
				binaryBuffers,
				mat,
				key,
				basePath,
			);
		});

		const nodes = GltfLoader.buildNodes(doc);
		const skins = (doc.skins ?? []).map((skin) => ({
			joints: skin.joints,
			inverseBindMatrices:
				skin.inverseBindMatrices !== undefined
					? GltfLoader.readFloats(doc, binaryBuffers, skin.inverseBindMatrices)
							.data
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
			placed.length > 0
				? placed
				: (doc.meshes ?? []).map((_, mesh) => ({ mesh }));

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

		let minX = Infinity,
			minY = Infinity,
			minZ = Infinity;
		let maxX = -Infinity,
			maxY = -Infinity,
			maxZ = -Infinity;
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
				if (prim.attributes.POSITION === undefined) {
					throw new Error(
						`glTF mesh ${inst.mesh} primitive ${primIdx} has no POSITION attribute`,
					);
				}
				const read = (acc: number | undefined) => {
					if (acc === undefined) return undefined;
					const data = prim.decodedDraco?.attributes[acc];
					if (!data) return GltfLoader.readFloats(doc, binaryBuffers, acc);
					const accessor = doc.accessors?.[acc];
					if (!accessor) throw new Error(`Accessor ${acc} not found`);
					return {
						data,
						itemSize: COMPONENTS[accessor.type] ?? 1,
						count: accessor.count,
					};
				};

				const pos = read(prim.attributes.POSITION)!;
				const numVerts = pos.count;
				const mat =
					prim.material === undefined
						? undefined
						: doc.materials?.[prim.material];
				const attributes = prim.attributes as Record<
					string,
					number | undefined
				>;
				const mapUv = (
					info: GltfTextureInfo | undefined,
				): Float32Array | undefined => {
					if (!info) return undefined;
					const set = GltfLoader.texCoordOf(info);
					const accessor = attributes[`TEXCOORD_${set}`];
					if (accessor === undefined)
						throw new Error(
							`glTF mesh ${inst.mesh} primitive ${primIdx} lacks TEXCOORD_${set} required by a texture`,
						);
					const uv = read(accessor);
					if (!uv)
						throw new Error(
							`glTF mesh ${inst.mesh} has missing texture coordinates`,
						);
					if (uv.itemSize !== 2 || uv.count !== numVerts)
						throw new Error(
							`Invalid TEXCOORD_${set} on glTF mesh ${inst.mesh} primitive ${primIdx}`,
						);
					const transform = info.extensions?.KHR_texture_transform;
					if (transform) applyTextureTransform(uv.data, transform);
					return uv.data;
				};
				const uvs =
					mapUv(mat?.pbrMetallicRoughness?.baseColorTexture) ??
					read(prim.attributes.TEXCOORD_0)?.data ??
					new Float32Array(numVerts * 2);
				const mapUvs = {
					normal: mapUv(mat?.normalTexture),
					metallicRoughness: mapUv(
						mat?.pbrMetallicRoughness?.metallicRoughnessTexture,
					),
					occlusion: mapUv(mat?.occlusionTexture),
					emissive: mapUv(mat?.emissiveTexture),
				};
				const colors = read(prim.attributes.COLOR_0);
				let rgba: Float32Array | undefined;
				if (colors) {
					// COLOR_0 is linear; Mesh3DData colors are display (sRGB), like base colors.
					rgba = new Float32Array(numVerts * 4).fill(1);
					for (let v = 0; v < numVerts; v++)
						for (let c = 0; c < colors.itemSize; c++) {
							const value = colors.data[v * colors.itemSize + c] ?? 1;
							rgba[v * 4 + c] = c < 3 ? linearToSrgb(value) : value;
						}
				}

				let indices: Uint16Array | Uint32Array;
				if (prim.decodedDraco) {
					indices = prim.decodedDraco.indices;
				} else if (prim.indices !== undefined) {
					indices = GltfLoader.readIndices(doc, binaryBuffers, prim.indices);
				} else {
					indices =
						numVerts > 65535
							? new Uint32Array(numVerts)
							: new Uint16Array(numVerts);
					for (let i = 0; i < numVerts; i++) indices[i] = i;
				}

				const primitive = expandPrimitive(indices, prim.mode ?? 4);
				indices = primitive.indices;

				// Skinned vertices are in bind (model) space; others sit under their node.
				const skinned =
					inst.skin !== undefined && prim.attributes.JOINTS_0 !== undefined;
				const place =
					!skinned && inst.node !== undefined ? rest[inst.node] : undefined;
				for (let i = 0; i < numVerts; i++) {
					const x = pos.data[i * 3]!;
					const y = pos.data[i * 3 + 1]!;
					const z = pos.data[i * 3 + 2]!;
					if (place) {
						const p = Matrix4Math.projectPoint(place, [x, y, z]);
						grow(p[0], p[1], p[2]);
					} else grow(x, y, z);
				}

				const morphTargets = prim.targets?.map((target) => {
					const positions = read(target.POSITION);
					const normals = read(target.NORMAL);
					if (
						(positions &&
							(positions.count !== numVerts || positions.itemSize !== 3)) ||
						(normals && (normals.count !== numVerts || normals.itemSize !== 3))
					) {
						throw new Error(
							`Invalid morph target on glTF mesh ${inst.mesh} primitive ${primIdx}`,
						);
					}
					return { positions: positions?.data, normals: normals?.data };
				});
				const defaultWeights =
					(inst.node === undefined
						? undefined
						: doc.nodes?.[inst.node]?.weights) ?? meshDef.weights;
				const morphWeights = morphTargets?.map(
					(_, i) => defaultWeights?.[i] ?? 0,
				);
				model.meshes.push({
					id: `gltf_mesh_${inst.mesh}_${primIdx}${inst.node !== undefined ? `_n${inst.node}` : ""}`,
					name: meshDef.name ?? `Mesh_${inst.mesh}`,
					positions: pos.data,
					normals:
						read(prim.attributes.NORMAL)?.data ??
						new Float32Array(numVerts * 3),
					uvs,
					mapUvs,
					morphTargets,
					morphWeights,
					colors: rgba,
					jointIndices: skinned
						? read(prim.attributes.JOINTS_0)?.data
						: undefined,
					jointWeights: skinned
						? read(prim.attributes.WEIGHTS_0)?.data
						: undefined,
					indices,
					topology: primitive.topology,
					materialName:
						prim.material !== undefined
							? materialKeys[prim.material]
							: undefined,
					node: inst.node,
					skin: skinned ? inst.skin : undefined,
				});
			});
		}

		if (!Number.isFinite(minX)) {
			minX = minY = minZ = 0;
			maxX = maxY = maxZ = 0;
		}

		const maxDimension = Math.max(
			maxX - minX,
			maxY - minY,
			maxZ - minZ,
			0.0001,
		);
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
			center: [
				(lo[0] + hi[0]) * 0.5,
				(lo[1] + hi[1]) * 0.5,
				(lo[2] + hi[2]) * 0.5,
			],
			size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
			boundingSphereRadius:
				Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.5,
		};
		return model;
	}

	/**
	 * Loads a glTF / GLB file synchronously or asynchronously from a path or URL.
	 */
	public static async loadAsync(
		srcOrData: string | ArrayBuffer | Uint8Array,
		options: LoadModelOptions = {},
	): Promise<Model3DData> {
		if (typeof srcOrData !== "string")
			return GltfLoader.parseAsync(srcOrData, options);
		const cleanPath = srcOrData.startsWith("file://")
			? srcOrData.replace("file://", "")
			: srcOrData;
		if (!srcOrData.trimStart().startsWith("{") && fs.existsSync(cleanPath)) {
			return GltfLoader.parseAsync(
				fs.readFileSync(cleanPath),
				options,
				path.dirname(cleanPath),
			);
		}
		return GltfLoader.parseAsync(srcOrData, options);
	}

	public static load(
		srcOrData: string | ArrayBuffer | Uint8Array,
		options: LoadModelOptions = {},
	): Model3DData {
		if (typeof srcOrData !== "string") {
			return GltfLoader.parse(srcOrData, options);
		}

		const cleanPath = srcOrData.startsWith("file://")
			? srcOrData.replace("file://", "")
			: srcOrData;
		if (
			srcOrData.startsWith("/") ||
			srcOrData.startsWith("./") ||
			srcOrData.startsWith("../") ||
			srcOrData.startsWith("file://") ||
			// A relative path such as "models/robot.glb" (inline glTF JSON starts with "{").
			(!srcOrData.trimStart().startsWith("{") && fs.existsSync(cleanPath))
		) {
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

export async function loadGLTFAsync(
	srcOrData: string | ArrayBuffer | Uint8Array,
	options: LoadModelOptions = {},
): Promise<Model3DData> {
	return GltfLoader.loadAsync(srcOrData, options);
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

function linearToSrgb(c: number): number {
	const x = Math.min(Math.max(c, 0), 1);
	return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** The image types the renderer decodes (sharp). */
const SUPPORTED_IMAGE_MIMES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/tiff",
	"image/avif",
	"image/ktx2",
]);

/**
 * Bakes KHR_texture_transform into UVs in place: uv' = T * R * S * uv
 * (offset, then rotation counter-clockwise in UV space, then scale).
 */
function applyTextureTransform(
	uvs: Float32Array,
	{ offset = [0, 0], rotation = 0, scale = [1, 1] }: GltfTextureTransform,
): void {
	const c = Math.cos(rotation);
	const s = Math.sin(rotation);
	for (let i = 0; i < uvs.length; i += 2) {
		const u = uvs[i]! * scale[0];
		const v = uvs[i + 1]! * scale[1];
		uvs[i] = c * u - s * v + offset[0];
		uvs[i + 1] = s * u + c * v + offset[1];
	}
}
