/**
 * `framefields/dna`: characters from DNA files (the format MetaHuman
 * characters export to), read in TypeScript and written as GLB files for
 * `Layer.glb`. The reader is based on OpenRigLogic's DNA library (MIT,
 * Epic Games).
 */
export { ByteReader } from "./bytes.js";
export {
	dnaMaterials,
	type FoundTextures,
	type MeshRole,
	meshRole,
	type RoleTextures,
	roleMaterial,
} from "./materials.js";
export {
	type AxisDirection,
	type ConditionalTable,
	type DnaBehavior,
	type DnaDefinition,
	type DnaDescriptor,
	type DnaFile,
	type DnaMesh,
	type JointGroup,
	type LodMapping,
	type ReadDnaOptions,
	type RotationSequence,
	readDna,
	type Vec3Array,
} from "./read.js";
export {
	JOINT_ATTRIBUTES,
	RigEvaluator,
	type RigEvaluatorOptions,
} from "./rig.js";
export { eulerQuat, type Space, spaceOf } from "./space.js";
export {
	type AddedDna,
	addDna,
	type DnaToGltfOptions,
	dnaSkeleton,
	dnaToGlb,
	lodMeshes,
} from "./to-glb.js";
