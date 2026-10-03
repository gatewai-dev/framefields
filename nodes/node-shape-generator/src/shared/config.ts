import {
	ColorSchema,
	configBuilder,
	createOutputItemSchema,
	MultiOutputGenericSchema,
	VirtualMediaDataSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const ShapeTypeEnum = z.enum([
	"Rectangle",
	"Ellipse",
	"Polygon",
	"Star",
	"Arrow",
	"CustomPath",
]);
export type ShapeType = z.infer<typeof ShapeTypeEnum>;

export const FillTypeEnum = z.enum(["solid", "linear", "radial", "none"]);
export type FillType = z.infer<typeof FillTypeEnum>;

export const StrokeLineCapEnum = z.enum(["butt", "round", "square"]);
export type StrokeLineCap = z.infer<typeof StrokeLineCapEnum>;

export const StrokeLineJoinEnum = z.enum(["miter", "round", "bevel"]);
export type StrokeLineJoin = z.infer<typeof StrokeLineJoinEnum>;

export const OutputTypeEnum = z.enum(["SVG", "Image"]);
export type OutputType = z.infer<typeof OutputTypeEnum>;

export const shapeGeneratorConfig = configBuilder()
	.field("shapeType", ShapeTypeEnum.default("Rectangle"), {
		label: "Shape Type",
		description: "Parametric vector geometry type.",
	})
	.field("width", z.number().int().min(1).max(8192).default(500), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Width (px)",
		description: "Vector canvas bounding box width in pixels.",
	})
	.field("height", z.number().int().min(1).max(8192).default(500), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Height (px)",
		description: "Vector canvas bounding box height in pixels.",
	})
	.field("radiusTL", z.number().min(0).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Top-Left Radius (px)",
		description: "Top-left corner rounding for rectangular shapes.",
	})
	.field("radiusTR", z.number().min(0).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Top-Right Radius (px)",
		description: "Top-right corner rounding for rectangular shapes.",
	})
	.field("radiusBR", z.number().min(0).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Bottom-Right Radius (px)",
		description: "Bottom-right corner rounding for rectangular shapes.",
	})
	.field("radiusBL", z.number().min(0).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Bottom-Left Radius (px)",
		description: "Bottom-left corner rounding for rectangular shapes.",
	})
	.field("polygonSides", z.number().int().min(3).max(64).default(5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Polygon Sides",
		description:
			"Number of regular polygon vertices (3 for triangle, 5 for pentagon, etc.).",
	})
	.field("starPoints", z.number().int().min(3).max(64).default(5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Star Points",
		description: "Number of star spikes (3 to 64).",
	})
	.field("starInnerRadius", z.number().min(0.01).max(0.99).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Star Inner Radius Ratio",
		description:
			"Ratio of inner vertex radius to outer tip radius (0.01 to 0.99).",
	})
	.field("arrowHeadWidth", z.number().min(0).default(40), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Arrow Head Width (px)",
		description: "Total cross-width of the arrowhead barb in pixels.",
	})
	.field("arrowHeadLength", z.number().min(0).default(40), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Arrow Head Length (px)",
		description: "Length of the arrowhead tip in pixels.",
	})
	.field("arrowShaftWidth", z.number().min(1).default(20), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Arrow Shaft Width (px)",
		description: "Thickness of the arrow stem in pixels.",
	})
	.field("customPath", z.string().optional(), {
		label: "Custom SVG Path Data",
		description: "Standard SVG path data string (e.g. 'M 10,10 L 90,90 ...').",
	})
	.field("customPathScale", z.number().min(0.01).max(100).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Path Scale",
		description: "Scale factor applied to custom SVG path geometry.",
	})
	.field("fillType", FillTypeEnum.default("solid"), {
		label: "Fill Type",
		description:
			"Fill style: solid color, linear gradient, radial gradient, or none.",
	})
	.field("fillColor", ColorSchema.default("#3b82f6"), {
		label: "Fill Color / Gradient Start",
		description: "Primary fill color or starting color for gradient fills.",
	})
	.field("gradientEndColor", ColorSchema.default("#1d4ed8"), {
		label: "Gradient End Color",
		description:
			"Secondary termination color for linear or radial gradient fills.",
	})
	.field("gradientAngle", z.number().default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Gradient Angle (deg)",
		description:
			"Linear gradient direction in degrees (0 = left to right, 90 = top to bottom).",
	})
	.field("strokeColor", ColorSchema.default("#ffffff"), {
		label: "Stroke Color",
		description: "Color of the outline stroke.",
	})
	.field("strokeWidth", z.number().min(0).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Stroke Width (px)",
		description: "Width of outline border stroke in pixels (0 for no stroke).",
	})
	.field("strokeDashArray", z.string().optional(), {
		label: "Stroke Dash Pattern",
		description:
			"Dash array pattern, e.g. '5,5' for dashed, '2,4' for dotted, or empty for solid.",
	})
	.field("strokeLineCap", StrokeLineCapEnum.default("round"), {
		label: "Stroke Line Cap",
		description:
			"Shape used at the ends of open subpaths (butt, round, square).",
	})
	.field("strokeLineJoin", StrokeLineJoinEnum.default("round"), {
		label: "Stroke Line Join",
		description: "Shape used at the corners of paths (miter, round, bevel).",
	})
	.field("strokeDashOffset", z.number().default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Stroke Dash Offset (px)",
		description: "Offset distance into the dash pattern in pixels.",
	})
	.field("rotation", z.number().default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Rotation (deg)",
		description: "Center rotation angle in degrees.",
	})
	.field("opacity", z.number().min(0).max(1).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Opacity",
		description:
			"Overall shape layer opacity from 0.0 (transparent) to 1.0 (opaque).",
	})
	.field("outputType", OutputTypeEnum.default("SVG"), {
		label: "Output Data Type",
		description:
			"Output format stream: SVG (vector) or Image (rasterized bitmap).",
	})
	.build();

export const ShapeGeneratorNodeConfigSchema = shapeGeneratorConfig.schema;
export type ShapeGeneratorNodeConfig = z.infer<
	typeof ShapeGeneratorNodeConfigSchema
>;

export const ShapeGeneratorResultSchema = MultiOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
	]),
);
export type ShapeGeneratorResult = z.infer<typeof ShapeGeneratorResultSchema>;

export const ShapeGeneratorOperationSchema =
	ShapeGeneratorNodeConfigSchema.extend({
		op: z.enum(["ShapeGenerator", "source"]).default("source"),
		svgContent: z.string().optional(),
		svgDataUrl: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		inputs: z
			.record(
				z.string(),
				z.object({
					connectionValid: z.boolean(),
					outputItem: z
						.object({
							type: z.string(),
							data: z.unknown(),
						})
						.nullable()
						.optional(),
				}),
			)
			.optional(),
	});
export type ShapeGeneratorOperation = z.infer<
	typeof ShapeGeneratorOperationSchema
>;
