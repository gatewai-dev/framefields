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
export { type BoneGizmoOptions, boneGizmo } from "./gizmo.js";
export {
	type AccessorData,
	type AccessorOptions,
	type AccessorType,
	GlbBuilder,
} from "./glb-builder.js";
export {
	type AddedHuman,
	type AddHumanOptions,
	addHuman,
} from "./human/add-human.js";
export { type HumanModel, type HumanOptions, human } from "./human/human.js";
export { MAKEHUMAN_SOURCE } from "./human/source.js";
export {
	HumanAssetStore,
	type HumanAssetStoreOptions,
	humanCacheDir,
} from "./human/store.js";
export { type HumanoidOptions, humanoidSkeleton } from "./humanoid.js";
export {
	type MaterialSpec,
	materialJson,
	type TextureRef,
	type TextureSlot,
} from "./material.js";
export {
	type Displacement,
	type Part,
	type PartOp,
	SculptField,
} from "./sculpt/field.js";
export {
	type LimbOptions,
	limb,
	type MirrorPartsOptions,
	mirrorParts,
} from "./sculpt/helpers.js";
export {
	type IndexedMesh,
	meshDefects,
	meshField,
	meshVolume,
} from "./sculpt/mesh.js";
export { Noise3 } from "./sculpt/noise.js";
export {
	type SculptOptions,
	type SculptReport,
	type SculptResult,
	sculpt,
} from "./sculpt/sculpt.js";
export type { Shape } from "./sculpt/shapes.js";
export { type SimplifyOptions, simplify } from "./sculpt/simplify.js";
export {
	type Joint,
	type JointSpec,
	type MirrorOptions,
	Skeleton,
	type Vec3,
} from "./skeleton.js";
