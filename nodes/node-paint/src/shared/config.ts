import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

// ─── Stroke schemas ────────────────────────────────────────────────────────────

export const BrushStrokeSchema = z.object({
	id: z.string().min(1).default("brush"),
	tool: z.literal("brush"),
	path: z.string(),
	color: z
		.string()
		.regex(
			/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
			"must be a hex color",
		),
	size: z.number().positive(),
	opacity: z.number().min(0).max(1).default(1),
});

export const EraserStrokeSchema = z.object({
	id: z.string().min(1).default("eraser"),
	tool: z.literal("eraser"),
	path: z.string(),
	size: z.number().positive(),
});

export const FillStrokeSchema = z.object({
	id: z.string().min(1).default("fill"),
	tool: z.literal("fill"),
	imageData: z.string().min(1),
	width: z.number().int().positive().max(16384),
	height: z.number().int().positive().max(16384),
});

export const StrokeSchema = z.discriminatedUnion("tool", [
	BrushStrokeSchema,
	EraserStrokeSchema,
	FillStrokeSchema,
]);

export type BrushStroke = z.infer<typeof BrushStrokeSchema>;
export type EraserStroke = z.infer<typeof EraserStrokeSchema>;
export type FillStroke = z.infer<typeof FillStrokeSchema>;
export type Stroke = z.infer<typeof StrokeSchema>;

// ─── Node config ───────────────────────────────────────────────────────────────

export const PaintNodeConfigSchema = z
	.object({
		width: z.number().int().min(1).max(16384).default(1080),
		height: z.number().int().min(1).max(16384).default(1080),
		maintainAspect: z.boolean().default(true),
		aspectRatio: z.number().positive().optional(),
		backgroundColor: z
			.string()
			.regex(
				/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
				"must be a hex color",
			)
			.default("#ffffff"),
		strokes: z.array(StrokeSchema).max(10000).optional(),
	})
	.strict();

export type PaintNodeConfig = z.infer<typeof PaintNodeConfigSchema>;

export const PaintResultSchema = MultiOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
	]),
);
export type PaintResult = z.infer<typeof PaintResultSchema>;

export const PAINT_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF" | "SVG"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
