import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@gitframes/core";
import { z } from "zod";

export const CurvePointSchema = z.object({
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
});

export type CurvePoint = z.infer<typeof CurvePointSchema>;

export const ScalePointSchema = z.object({
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(2),
});

export type ScalePoint = z.infer<typeof ScalePointSchema>;

export const CurveTypeSchema = z.enum([
	"rgb",
	"hue-vs-hue",
	"hue-vs-sat",
	"lum-vs-sat",
	"sat-vs-sat",
]);
export type CurveType = z.infer<typeof CurveTypeSchema>;

export const CurvesNodeConfigSchema = z
	.object({
		curveType: CurveTypeSchema.default("rgb"),
		master: z
			.array(CurvePointSchema)
			.min(2)
			.default([
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			]),
		red: z
			.array(CurvePointSchema)
			.min(2)
			.default([
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			]),
		green: z
			.array(CurvePointSchema)
			.min(2)
			.default([
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			]),
		blue: z
			.array(CurvePointSchema)
			.min(2)
			.default([
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			]),
		// Secondary HSL curves — each is a 1D adjustment curve
		// X = input dimension (Hue 0-1, Luma 0-1, Sat 0-1)
		// Y = output adjustment (0.5 = no change for shift curves, 0-2 for scale curves)
		hueVsHue: z
			.array(CurvePointSchema)
			.min(2)
			.default([
				{ x: 0, y: 0.5 },
				{ x: 1, y: 0.5 },
			]),
		hueVsSat: z
			.array(ScalePointSchema)
			.min(2)
			.default([
				{ x: 0, y: 1.0 },
				{ x: 1, y: 1.0 },
			]),
		lumVsSat: z
			.array(ScalePointSchema)
			.min(2)
			.default([
				{ x: 0, y: 1.0 },
				{ x: 1, y: 1.0 },
			]),
		satVsSat: z
			.array(ScalePointSchema)
			.min(2)
			.default([
				{ x: 0, y: 1.0 },
				{ x: 1, y: 1.0 },
			]),
	})
	.strict();

export type CurvesNodeConfig = z.infer<typeof CurvesNodeConfigSchema>;

export const CurvesResultSchema = MultiOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Lottie"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
	]),
);

export type CurvesResult = z.infer<typeof CurvesResultSchema>;

export const CURVES_OUTPUT_TYPE_MAP: Record<
	string,
	"Video" | "Image" | "GIF" | "Lottie" | "SVG"
> = {
	Video: "Video",
	Image: "Image",
	GIF: "GIF",
	Lottie: "Lottie",
	SVG: "SVG",
};
