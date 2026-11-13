import type { ClayField } from "../clayfield/field.js";
import type { Mat4, Vec3 } from "../math3d/index.js";

/**
 * One morph target's deltas. Dense: 3 floats per vertex. Sparse (with
 * `indices`): 3 floats per listed vertex, every other vertex unmoved.
 */
export interface MorphTarget3D {
	positions?: Float32Array;
	normals?: Float32Array;
	/** The moved vertices, ascending; absent for dense deltas. */
	indices?: Uint32Array;
}

/** A morph target's position (or normal) deltas as a dense array. */
export function denseMorphDeltas(
	target: MorphTarget3D,
	vertexCount: number,
	kind: "positions" | "normals" = "positions",
): Float32Array {
	const data = target[kind];
	if (!target.indices) return data ?? new Float32Array(vertexCount * 3);
	const out = new Float32Array(vertexCount * 3);
	if (data)
		target.indices.forEach((v, i) => {
			out.set(data.subarray(i * 3, i * 3 + 3), v * 3);
		});
	return out;
}

export interface Mesh3DData {
	id?: string;
	name?: string;
	positions: Float32Array; // 3 floats per vertex (x, y, z)
	normals: Float32Array; // 3 floats per vertex (nx, ny, nz)
	uvs: Float32Array; // 2 floats per vertex (u, v), for the base color map
	/** Object-space morph deltas, applied before skinning. */
	morphTargets?: MorphTarget3D[];
	/** Default morph weights for this mesh instance. */
	morphWeights?: number[];
	/** Morph target names (glTF mesh `extras.targetNames`), one per target. */
	morphTargetNames?: string[];
	/** Per-map UVs, with the map's own texture transform already applied. */
	mapUvs?: {
		normal?: Float32Array;
		metallicRoughness?: Float32Array;
		occlusion?: Float32Array;
		emissive?: Float32Array;
	};
	indices: Uint16Array | Uint32Array;
	/** GPU primitive topology; defaults to triangles. */
	topology?: "triangle-list" | "line-list" | "point-list";
	colors?: Float32Array; // 4 floats per vertex (r, g, b, a), display (sRGB) 0..1; multiplies the base color
	tangents?: Float32Array; // 4 floats per vertex (x, y, z, w)
	// Skinned Mesh / Skeletal Animation attributes
	jointIndices?: Float32Array; // 4 bone indices per vertex
	jointWeights?: Float32Array; // 4 normalized weights per vertex (sum = 1.0)
	/** A second set of 4 influences per vertex (glTF JOINTS_1 / WEIGHTS_1): up to 8 in all, the weights of both sets summing to 1. */
	jointIndices1?: Float32Array;
	jointWeights1?: Float32Array;
	materialName?: string;
	/** Scene node that places this mesh (Model3DData.nodes); its world matrix applies unless the mesh is skinned. */
	node?: number;
	/** Skin (Model3DData.skins) whose joints deform this mesh; jointIndices index its `joints`. */
	skin?: number;
	/**
	 * The clay field these triangles were taken from. The raster pass draws
	 * the field itself, per pixel; the triangles serve what needs a mesh.
	 */
	clay?: ClayField;
}

/** The maps of a material besides its base color. */
export type MaterialMapSlot =
	| "normal"
	| "metallicRoughness"
	| "occlusion"
	| "emissive";

/** Addressing and filtering of one texture. */
export interface TextureSampling {
	wrapU: "repeat" | "clamp" | "mirror";
	wrapV: "repeat" | "clamp" | "mirror";
	/** Magnification filter. */
	filter: "linear" | "nearest";
}

export interface Material3D {
	name: string;
	diffuseColor?: [number, number, number, number]; // RGBA, display (sRGB) 0..1
	specularColor?: [number, number, number];
	ambientColor?: [number, number, number];
	shininess?: number;
	/**
	 * Specular strength parsed from the file (e.g. OBJ `Ks`). The mesh pass
	 * lights with the layer's `specularIntensity`; this is not applied yet.
	 */
	specularIntensity?: number;
	roughness?: number;
	metallic?: number;
	opacity?: number;
	diffuseTexture?: string; // Path / URL / Base64 to diffuse texture
	diffuseTextureBuffer?: Uint8Array | ArrayBuffer;
	/** MIME type of `diffuseTextureBuffer` (image/png, image/jpeg, …). */
	diffuseTextureMime?: string;
	/** Texture addressing for UVs outside [0, 1] (glTF samplers default to repeat). */
	textureWrap?: "repeat" | "clamp" | "mirror";
	/** Magnification filter (glTF sampler magFilter); "nearest" keeps texels sharp. */
	textureFilter?: "linear" | "nearest";
	/**
	 * How each other map is sampled, when it says (glTF: its own sampler).
	 * A map without an entry samples like the base color map.
	 */
	mapSampling?: Partial<Record<MaterialMapSlot, TextureSampling>>;
	normalTexture?: string;
	twoSided?: boolean;
	/** "mask" discards texels below `alphaCutoff`; "blend" draws after the opaque meshes. */
	alphaMode?: "opaque" | "mask" | "blend";
	alphaCutoff?: number;
	/** How the material wants to be lit when the layer leaves `material` unset. */
	shading?: "lit" | "unlit" | "toon" | "glass";
	/** Glass (KHR_materials_transmission): index of refraction (KHR_materials_ior). */
	ior?: number;
	/** Glass: thickness in model units (KHR_materials_volume thicknessFactor). */
	thickness?: number;
	/** Toon shading: the color multiplier of the shadowed side. */
	shadeColor?: [number, number, number];
	/** Linear-ish emissive color 0..1 (glTF emissiveFactor). */
	emissive?: [number, number, number];
	/** Emissive multiplier (glTF KHR_materials_emissive_strength). */
	emissiveStrength?: number;
	/** Encoded tangent-space normal map (glTF convention: +Y up / OpenGL). */
	normalTextureBuffer?: Uint8Array;
	normalScale?: number;
	/** Encoded map: G = roughness, B = metallic (glTF). */
	metallicRoughnessTextureBuffer?: Uint8Array;
	/** Encoded map: R = ambient occlusion. */
	occlusionTextureBuffer?: Uint8Array;
	occlusionStrength?: number;
	/** Encoded emissive color map (multiplies `emissive`). */
	emissiveTextureBuffer?: Uint8Array;
	/** Layered shading lobes from the file's material extensions (display colors, degrees). */
	surface?: MaterialSurface;
}

/**
 * Physical lobes a model file's material asks for, in the units layers use:
 * KHR_materials_clearcoat / _sheen / _anisotropy / _iridescence, and
 * subsurface from `extras.framefields.subsurface` (glTF has no skin lobe).
 */
export interface MaterialSurface {
	clearcoat?: number;
	clearcoatRoughness?: number;
	sheen?: number;
	sheenColor?: [number, number, number];
	sheenRoughness?: number;
	anisotropy?: number;
	/** Degrees. */
	anisotropyRotation?: number;
	iridescence?: number;
	iridescenceIor?: number;
	/** Film thickness, nm. */
	iridescenceThickness?: number;
	subsurface?: number;
	subsurfaceColor?: [number, number, number];
}

/** A scene-graph node: its rest transform and parent (glTF node semantics). */
export interface ModelNode3D {
	name: string;
	/** Index into Model3DData.nodes, -1 for a root. */
	parent: number;
	translation: Vec3;
	/** Unit quaternion [x, y, z, w]. */
	rotation: [number, number, number, number];
	scale: Vec3;
	/** A fixed local matrix (glTF `matrix`): such a node is not animated by TRS tracks. */
	matrix?: Mat4;
}

export interface Skin3D {
	/** Joint node indices (Model3DData.nodes), in the order jointIndices refer to them. */
	joints: number[];
	/** One column-major 4x4 per joint. */
	inverseBindMatrices: Float32Array;
}

export interface Bone3D {
	name: string;
	index: number;
	parentIndex: number; // -1 for root
	inverseBindMatrix: Mat4;
	bindMatrix: Mat4;
	localTransform: Mat4;
	worldTransform?: Mat4;
}

export interface Skeleton3D {
	bones: Bone3D[];
	boneIndicesByName: Record<string, number>;
}

export interface NodeAnimationTrack3D {
	nodeName: string;
	/** Target node index (Model3DData.nodes) when the model has a scene graph. */
	node?: number;
	times: Float32Array; // Keyframe timestamps in seconds
	translations?: Float32Array; // 3 floats per keyframe [x, y, z]
	rotations?: Float32Array; // 4 floats per keyframe [x, y, z, w] quaternion or Euler [rx, ry, rz]
	scales?: Float32Array; // 3 floats per keyframe [sx, sy, sz]
	weights?: Float32Array; // morph weights, target count values per keyframe
	/** "cubic" (glTF CUBICSPLINE) stores [inTangent, value, outTangent] per keyframe. */
	interpolation?: "linear" | "step" | "cubic";
}

export interface AnimationClip3D {
	name: string;
	duration: number; // in seconds
	fps: number;
	tracks: NodeAnimationTrack3D[];
}

export interface Model3DData {
	name?: string;
	meshes: Mesh3DData[];
	materials: Record<string, Material3D>;
	skeleton?: Skeleton3D;
	/** Scene graph (glTF): meshes, skins and animation tracks refer to these by index. */
	nodes?: ModelNode3D[];
	skins?: Skin3D[];
	/** Centering and size normalization, applied above the scene graph instead of baked into vertices. */
	rootTransform?: Mat4;
	/**
	 * Joints the file drives from other joints (scene `extras.framefields.drivers`):
	 * eyelids following the eyes, twist bones, correctives.
	 */
	drivers?: {
		joint: string;
		from: string;
		rotate: { x?: number; y?: number; z?: number };
	}[];
	animations: AnimationClip3D[];
	bounds: {
		min: Vec3;
		max: Vec3;
		center: Vec3;
		size: Vec3;
		boundingSphereRadius: number;
	};
}

export interface LoadModelOptions {
	center?: boolean;
	normalizeSize?: number; // scale bounding sphere / max dimension to this size
	scale?: number | [number, number, number];
	smoothNormals?: boolean;
	defaultMaterial?: Partial<Material3D>;
	basePath?: string;
	mtlText?: string;
}
