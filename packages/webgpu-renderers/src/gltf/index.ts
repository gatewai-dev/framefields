/**
 * glTF 2.0 out of the engine: a GLB writer (meshes, PBR materials with
 * Khronos extensions, textures, skins, sparse morphs, clips, cameras,
 * punctual lights) and skeletons, and `Scene3DExporter`, which writes what
 * a frame's 3D pass draws. The model import tests build their files with
 * the same writer.
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
	type CameraRef,
	type CameraSpec,
	type ChannelSpec,
	type DriverSpec,
	GltfDocument,
	type LightRef,
	type LightSpec,
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
	type Scene3DExport,
	Scene3DExporter,
	type Scene3DExportOptions,
} from "./scene-exporter.js";
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
