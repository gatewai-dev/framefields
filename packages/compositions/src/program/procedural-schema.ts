/**
 * Schemas for procedural 3D content: terrain, SDF and clay sculptures,
 * surface scattering and wind. A model node's `primitive3d` is checked
 * against the terrain / SDF / clay schema when it names one of them.
 */
import { z } from "zod";

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const RangeSchema = (min: number, max: number) =>
	z.tuple([z.number().min(min).max(max), z.number().min(min).max(max)]);
const ShadingSchema = z.enum(["lit", "unlit", "toon"]);

const PrimitiveSurfaceFields = {
	color: z.string().optional(),
	material: ShadingSchema.optional(),
	shininess: z.number().min(0).optional(),
	roughness: z.number().min(0).max(1).optional(),
	metallic: z.number().min(0).max(1).optional(),
};

export const TerrainNoiseSchema = z
	.object({
		seed: z.number().optional(),
		/** Size of the largest landforms, px. */
		scale: z.number().positive().optional(),
		octaves: z.number().int().min(1).max(10).optional(),
		persistence: z.number().min(0).max(1).optional(),
		lacunarity: z.number().min(1).max(4).optional(),
		ridgeMode: z.enum(["fbm", "ridged", "terrace"]).optional(),
		terraceSteps: z.number().int().min(2).max(32).optional(),
	})
	.strict();

export const TerrainColorByElevationSchema = z
	.object({
		lowColor: z.string(),
		midColor: z.string().optional(),
		highColor: z.string(),
		cliffColor: z.string().optional(),
		cliffThreshold: z.number().min(0).max(1).optional(),
		bands: RangeSchema(0, 1).optional(),
	})
	.strict();

export const TerrainGeometrySchema = z
	.object({
		type: z.literal("terrain"),
		width: z.number().positive(),
		depth: z.number().positive(),
		height: z.number().min(0).optional(),
		segments: z
			.union([
				z.number().int().min(1).max(512),
				z.tuple([
					z.number().int().min(1).max(512),
					z.number().int().min(1).max(512),
				]),
			])
			.optional(),
		noise: TerrainNoiseSchema.optional(),
		heights: z.array(z.number().min(0).max(1)).optional(),
		overhangWarp: z.number().min(0).optional(),
		colorByElevation: TerrainColorByElevationSchema.optional(),
		flatShaded: z.boolean().optional(),
		base: z.number().min(0).optional(),
		...PrimitiveSurfaceFields,
	})
	.strict();

const SdfBaseFields = {
	op: z.enum(["union", "subtract", "intersect"]).optional(),
	smoothness: z.number().min(0).optional(),
	center: Vec3Schema.optional(),
	rotation: Vec3Schema.optional(),
	color: z.string().optional(),
};

export const SdfPrimitiveSchema = z.discriminatedUnion("shape", [
	z
		.object({
			...SdfBaseFields,
			shape: z.literal("sphere"),
			radius: z.number().positive(),
		})
		.strict(),
	z
		.object({
			...SdfBaseFields,
			shape: z.literal("box"),
			size: z.tuple([
				z.number().positive(),
				z.number().positive(),
				z.number().positive(),
			]),
			radius: z.number().min(0).optional(),
		})
		.strict(),
	z
		.object({
			...SdfBaseFields,
			shape: z.literal("cylinder"),
			radius: z.number().positive(),
			height: z.number().positive(),
		})
		.strict(),
	z
		.object({
			...SdfBaseFields,
			shape: z.literal("capsule"),
			radius: z.number().positive(),
			height: z.number().positive(),
		})
		.strict(),
	z
		.object({
			...SdfBaseFields,
			shape: z.literal("torus"),
			radius: z.number().positive(),
			tube: z.number().positive(),
		})
		.strict(),
	z
		.object({
			...SdfBaseFields,
			shape: z.literal("gyroid"),
			scale: z.number().positive(),
			thickness: z.number().positive(),
		})
		.strict(),
]);

export const SdfGeometrySchema = z
	.object({
		type: z.literal("sdf"),
		primitives: z.array(SdfPrimitiveSchema).min(1),
		bounds: z.tuple([
			z.number().positive(),
			z.number().positive(),
			z.number().positive(),
		]),
		resolution: z.number().int().min(16).max(160).optional(),
		flatShaded: z.boolean().optional(),
		...PrimitiveSurfaceFields,
	})
	.strict();

const ClayMaterialFields = {
	mode: z.enum(["add", "carve", "intersect"]).optional(),
	smoothness: z.number().min(0).optional(),
	color: z.string().optional(),
};
const ClaySolidFields = {
	...ClayMaterialFields,
	center: Vec3Schema.optional(),
	rotation: Vec3Schema.optional(),
};
const ClayWarpFields = {
	center: Vec3Schema,
	radius: z.number().positive(),
	reach: z.number().positive().optional(),
};
const PositiveVec3Schema = z.tuple([
	z.number().positive(),
	z.number().positive(),
	z.number().positive(),
]);

export const ClayOpSchema = z.discriminatedUnion("type", [
	z
		.object({
			...ClaySolidFields,
			type: z.literal("sphere"),
			radius: z.number().positive(),
		})
		.strict(),
	z
		.object({
			...ClaySolidFields,
			type: z.literal("box"),
			size: PositiveVec3Schema,
			radius: z.number().min(0).optional(),
		})
		.strict(),
	z
		.object({
			...ClaySolidFields,
			type: z.enum(["cylinder", "capsule"]),
			radius: z.number().positive(),
			height: z.number().positive(),
		})
		.strict(),
	z
		.object({
			...ClaySolidFields,
			type: z.literal("torus"),
			radius: z.number().positive(),
			tube: z.number().positive(),
		})
		.strict(),
	z
		.object({
			...ClayMaterialFields,
			type: z.literal("stroke"),
			path: z
				.array(
					z.union([
						Vec3Schema,
						z.tuple([
							z.number(),
							z.number(),
							z.number(),
							z.number().positive(),
						]),
					]),
				)
				.min(1),
			radius: z.number().positive(),
			progress: z.number().min(0).max(1).optional(),
		})
		.strict(),
	z
		.object({ ...ClayWarpFields, type: z.literal("grab"), delta: Vec3Schema })
		.strict(),
	z
		.object({
			...ClayWarpFields,
			type: z.literal("twist"),
			axis: Vec3Schema,
			angle: z.number(),
		})
		.strict(),
	z
		.object({
			...ClayWarpFields,
			type: z.literal("bulge"),
			amount: z.number().min(-0.9).max(4),
		})
		.strict(),
	z
		.object({
			type: z.literal("inflate"),
			center: Vec3Schema,
			radius: z.number().positive(),
			amount: z.number(),
		})
		.strict(),
	z
		.object({
			type: z.literal("detail"),
			amplitude: z.number(),
			scale: z.number().positive(),
			octaves: z.number().int().min(1).max(8).optional(),
			persistence: z.number().min(0).max(1).optional(),
			lacunarity: z.number().min(1).max(4).optional(),
			ridged: z.boolean().optional(),
			seed: z.number().optional(),
			center: Vec3Schema.optional(),
			radius: z.number().positive().optional(),
		})
		.strict(),
]);

export const ClayGeometrySchema = z
	.object({
		type: z.literal("clay"),
		ops: z.array(ClayOpSchema).min(1),
		symmetry: z
			.string()
			.regex(/^[xyz]{1,3}$/i)
			.optional(),
		bounds: PositiveVec3Schema.optional(),
		bricks: z.number().int().min(4).max(48).optional(),
		resolution: z.number().int().min(16).max(160).optional(),
		...PrimitiveSurfaceFields,
	})
	.strict();

const PROCEDURAL_SCHEMAS: Record<string, z.ZodType> = {
	terrain: TerrainGeometrySchema,
	sdf: SdfGeometrySchema,
	clay: ClayGeometrySchema,
};

/** `primitive3d`: free-form for the classic primitives, strict for terrain, SDF and clay. */
export const Primitive3DSpecSchema = z.unknown().superRefine((value, ctx) => {
	const type = (value as { type?: unknown } | null)?.type;
	const schema =
		typeof type === "string" && Object.hasOwn(PROCEDURAL_SCHEMAS, type)
			? PROCEDURAL_SCHEMAS[type]
			: undefined;
	if (!schema) return;
	const parsed = schema.safeParse(value);
	if (parsed.success) return;
	for (const issue of parsed.error.issues) {
		ctx.addIssue({ ...issue, code: "custom", message: issue.message });
	}
});

export const WindSchema = z
	.object({
		/** Peak lean, degrees. Default 8. */
		amplitudeDeg: z.number().min(0).max(90).optional(),
		/** Sways per second. Default 0.4. */
		frequency: z.number().min(0).max(20).optional(),
		/** Downwind on the ground plane [x, z]. Default [1, 0]. */
		direction: z.tuple([z.number(), z.number()]).optional(),
		/** Gust wavelength across the field, px. Default 600. */
		waveScale: z.number().positive().optional(),
	})
	.strict();
export type WindConfig = z.infer<typeof WindSchema>;

export const ScatterExclusionSchema = z
	.object({
		x: z.number(),
		z: z.number(),
		radius: z.number().min(0),
		falloff: z.number().min(0).optional(),
	})
	.strict();

export const Scatter3DSchema = z
	.object({
		/** The surface node (any model3d node: terrain, sdf, primitive, file). */
		surface: z.custom<Record<string, unknown>>(
			(v) => typeof v === "object" && v !== null,
		),
		count: z.number().int().min(0).max(200_000),
		minDistance: z.number().min(0).optional(),
		seed: z.number().optional(),
		slopeRange: RangeSchema(0, 180).optional(),
		elevationRange: RangeSchema(0, 1).optional(),
		alignToNormal: z.number().min(0).max(1).optional(),
		scaleRange: z
			.tuple([z.number().positive(), z.number().positive()])
			.optional(),
		randomYaw: z.boolean().optional(),
		exclude: z.array(ScatterExclusionSchema).optional(),
		/** Push each instance this far into the surface, px. */
		sink: z.number().optional(),
	})
	.strict();
export type Scatter3DSpec = z.infer<typeof Scatter3DSchema>;

/** A layer drawn offscreen every frame and wrapped onto a model's surface. */
export const TextureLayerSchema = z
	.object({
		node: z.custom<unknown>((v) => typeof v === "object" && v !== null),
	})
	.strict();

/**
 * Voronoi destruction (`world.fracture`): the model is cut into `cells`
 * pieces, drawn as one rigidly skinned mesh posed per frame from `track`.
 * Without a track the pieces rest in place and the model looks whole.
 */
export const Fracture3DSchema = z
	.object({
		/** Voronoi pieces, 2..256. Default 48. */
		cells: z.number().int().min(2).max(256).optional(),
		seed: z.number().optional(),
		/** Object-space point the pieces crowd around. */
		impactPoint: Vec3Schema.optional(),
		/** Exposed faces' color. Default "#d8d2c4". */
		interiorColor: z.string().optional(),
		interiorRoughness: z.number().min(0).max(1).optional(),
		/** Per composition frame, per piece: x, y, z (scene px), qx, qy, qz, qw. */
		track: z.array(z.number()).optional(),
	})
	.strict();
export type Fracture3DSpec = z.infer<typeof Fracture3DSchema>;
