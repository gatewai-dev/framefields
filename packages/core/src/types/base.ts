import z from "zod";

export const DataTypeVal = {
	Text: "Text",
	Number: "Number",
	Boolean: "Boolean",
	Image: "Image",
	Video: "Video",
	Audio: "Audio",
	SVG: "SVG",
	Caption: "Caption",
	Lottie: "Lottie",
	ThreeD: "ThreeD",
	GIF: "GIF",
	Signal: "Signal",
	LUT: "LUT",
} as const;

export const DataType = DataTypeVal;
export type DataType = (typeof DataTypeVal)[keyof typeof DataTypeVal];

export const DataTypes = Object.values(DataTypeVal) as [
	DataType,
	...DataType[],
];

export type DataTypeEnum = DataType;

export const HandleTypeVal = {
	Input: "Input",
	Output: "Output",
} as const;

export type HandleType = (typeof HandleTypeVal)[keyof typeof HandleTypeVal];

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonObject
	| JsonArray;

export interface JsonObject {
	[key: string]: JsonValue | undefined;
}

export interface JsonArray extends Array<JsonValue> {}

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(JsonValueSchema),
		z.record(z.string(), JsonValueSchema.optional()),
	]),
);

/**
 * Zod schema for the FileAsset model
 * Matches the Prisma schema definitions for types and nullability.
 */
export const FileAssetSchema = z.object({
	id: z.cuid2(),
	name: z.string(),
	createdAt: z.coerce.date(), // Coerces ISO strings to Date objects
	updatedAt: z.coerce.date(),

	userId: z.cuid2().nullable(),

	width: z.number().int().nullable(),
	height: z.number().int().nullable(),

	bucket: z.string(),
	size: z.number().int(), // File size in bytes
	mimeType: z.string(),
	key: z.string(),

	isUploaded: z.boolean().default(true),

	// Duration in milliseconds
	duration: z.number().int().nullable(),

	// Audio Properties
	sampleRate: z.number().int().nullable().optional(),
	channels: z.number().int().nullable().optional(),
	bitDepth: z.number().int().nullable().optional(),
	audioCodec: z.string().nullable().optional(),
	audioBitrate: z.number().int().nullable().optional(),
	fps: z.number().int().nullable(),
	fingerprint: z.string().nullable(),
});

export type FileAsset = z.infer<typeof FileAssetSchema>;

export interface XYPosition {
	x: number;
	y: number;
}

export const NodeVisualConfigSchema = z
	.object({
		position: z
			.object({
				x: z.number(),
				y: z.number(),
			})
			.optional(),
		width: z.number().nullish(),
		height: z.number().nullish(),
		locked: z.boolean().optional().default(false),
		collapsed: z.boolean().optional().default(false),
	})
	.passthrough();

export type NodeVisualConfig = z.infer<typeof NodeVisualConfigSchema>;
