/**
 * `framefields/forge`: rigged characters and props built in code, written
 * as standard GLB files that `Layer.glb` (and every other glTF tool) loads.
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
export { type BoneGizmoOptions, boneGizmo } from "./gizmo.js";
export {
	type AccessorData,
	type AccessorOptions,
	type AccessorType,
	GlbBuilder,
} from "./glb-builder.js";
export { type HumanoidOptions, humanoidSkeleton } from "./humanoid.js";
export {
	type MaterialSpec,
	materialJson,
	type TextureRef,
	type TextureSlot,
} from "./material.js";
export {
	type Joint,
	type JointSpec,
	type MirrorOptions,
	Skeleton,
	type Vec3,
} from "./skeleton.js";
