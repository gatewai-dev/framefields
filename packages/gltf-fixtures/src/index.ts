/**
 * Test fixtures: a GLB writer (meshes, PBR materials with Khronos
 * extensions, textures, skins, sparse morphs, clips) and skeletons, used to
 * build the models the engine's import tests load. Private; not published.
 */
export {
	type ColorInput,
	displayRgba,
	linearRgb,
	linearRgba,
} from "./color.js";
export {
	type AnimationPath,
	type AnimationSpec,
	type ChannelSpec,
	type DriverSpec,
	GltfDocument,
	type MaterialRef,
	type MeshRef,
	type MeshSpec,
	type MorphTargetSpec,
	type NodeRef,
	type NodeSpec,
	type PrimitiveSpec,
	type SkeletonRefs,
	type SkinRef,
	type TextureSpec,
} from "./document.js";
export {
	type AccessorData,
	type AccessorOptions,
	type AccessorType,
	GlbBuilder,
} from "./glb-builder.js";
export {
	type MaterialSpec,
	materialJson,
	type TextureRef,
	type TextureSlot,
} from "./material.js";
export { encodePng } from "./png.js";
export {
	type Joint,
	type JointSpec,
	type MirrorOptions,
	type Quat,
	quatConjugate,
	quatMultiply,
	quatRotate,
	Skeleton,
	type Vec3,
} from "./skeleton.js";
export { computeTangents } from "./tangents.js";
