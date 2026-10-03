import type { Mat4, Vec3 } from "../math3d/index.js";

export interface Mesh3DData {
	id?: string;
	name?: string;
	positions: Float32Array; // 3 floats per vertex (x, y, z)
	normals: Float32Array; // 3 floats per vertex (nx, ny, nz)
	uvs: Float32Array; // 2 floats per vertex (u, v)
	indices: Uint16Array | Uint32Array;
	colors?: Float32Array; // 4 floats per vertex (r, g, b, a)
	tangents?: Float32Array; // 4 floats per vertex (x, y, z, w)
	// Skinned Mesh / Skeletal Animation attributes
	jointIndices?: Float32Array; // 4 bone indices per vertex
	jointWeights?: Float32Array; // 4 normalized weights per vertex (sum = 1.0)
	materialName?: string;
	/** Scene node that places this mesh (Model3DData.nodes); its world matrix applies unless the mesh is skinned. */
	node?: number;
	/** Skin (Model3DData.skins) whose joints deform this mesh; jointIndices index its `joints`. */
	skin?: number;
}

export interface Material3D {
	name: string;
	diffuseColor?: [number, number, number, number]; // RGBA
	specularColor?: [number, number, number];
	ambientColor?: [number, number, number];
	shininess?: number;
	roughness?: number;
	metallic?: number;
	opacity?: number;
	diffuseTexture?: string; // Path / URL / Base64 to diffuse texture
	diffuseTextureBuffer?: Uint8Array | ArrayBuffer;
	/** MIME type of `diffuseTextureBuffer` (image/png, image/jpeg, …). */
	diffuseTextureMime?: string;
	/** Texture addressing for UVs outside [0, 1] (glTF samplers default to repeat). */
	textureWrap?: "repeat" | "clamp" | "mirror";
	normalTexture?: string;
	twoSided?: boolean;
	/** "mask" discards texels below `alphaCutoff`; "blend" draws after the opaque meshes. */
	alphaMode?: "opaque" | "mask" | "blend";
	alphaCutoff?: number;
	/** How the material wants to be lit when the layer leaves `material` unset. */
	shading?: "lit" | "unlit" | "toon";
	/** Toon shading: the color multiplier of the shadowed side. */
	shadeColor?: [number, number, number];
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
