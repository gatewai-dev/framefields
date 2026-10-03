import {
	createOutputItemSchema,
	SingleOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@gitframes/core";
import { z } from "zod";

export const MeshWarpNodeConfigSchema = z
	.object({
		cols: z.number().int().min(2).max(12).default(3),
		rows: z.number().int().min(2).max(12).default(3),
		points: z
			.array(
				z.object({
					x: z.number().min(0).max(100),
					y: z.number().min(0).max(100),
				}),
			)
			.max(144)
			.optional(),
	})
	.strict()
	.superRefine((data, ctx) => {
		if (data.points && data.points.length > 0) {
			const expected = data.cols * data.rows;
			if (data.points.length !== expected) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["points"],
					message: `points array must have exactly ${expected} coordinates (cols * rows), got ${data.points.length}`,
				});
			}
		}
	});

export type MeshWarpNodeConfig = z.infer<typeof MeshWarpNodeConfigSchema>;

export const MeshWarpOperationSchema = MeshWarpNodeConfigSchema.extend({
	op: z.literal("MeshWarp"),
	metadata: z.any().optional(),
});

export type MeshWarpOperation = z.infer<typeof MeshWarpOperationSchema>;

export const MeshWarpResultSchema = SingleOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
	]),
);

export type MeshWarpResult = z.infer<typeof MeshWarpResultSchema>;

export const WARP_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF" | "SVG"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
