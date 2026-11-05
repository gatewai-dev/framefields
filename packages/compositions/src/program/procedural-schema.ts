/**
 * Schemas for procedural 3D content: terrain, SDF sculptures, surface
 * scattering and wind. A model node's `primitive3d` is checked against the
 * terrain / SDF schema when it names one of them.
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

/** `primitive3d`: free-form for the classic primitives, strict for terrain and SDF. */
export const Primitive3DSpecSchema = z.unknown().superRefine((value, ctx) => {
	const type = (value as { type?: unknown } | null)?.type;
	const schema =
		type === "terrain"
			? TerrainGeometrySchema
			: type === "sdf"
				? SdfGeometrySchema
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
