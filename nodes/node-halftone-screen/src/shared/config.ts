import {
	ColorSchema,
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const HalftoneModeEnum = z.enum(["Monochrome", "CMYK"]);
export type HalftoneMode = z.infer<typeof HalftoneModeEnum>;

export const DotShapeEnum = z.enum(["Circle", "Diamond", "Line", "Square"]);
export type DotShape = z.infer<typeof DotShapeEnum>;

export const halftoneScreenConfig = configBuilder()
	.field("mode", HalftoneModeEnum.default("Monochrome"), {
		label: "Screening Mode",
		description:
			"Monochrome (single-ink raster on paper) or CMYK (4-color subtractive process with standard angle rosette separation).",
	})
	.field("dotShape", DotShapeEnum.default("Circle"), {
		label: "Dot Geometry",
		description:
			"Geometric shape of the halftone raster cells: Circle, Diamond, Line, or Square.",
	})
	.field("frequency", z.number().min(1).max(200).default(30), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Screen Frequency (LPI)",
		description:
			"Line frequency in lines per unit / LPI. Higher values produce smaller, finer raster dots.",
	})
	.field("angle", z.number().min(0).max(360).default(45), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Screen Angle (deg)",
		description:
			"Global rotational angle of the screening grid in degrees (standard offset angle).",
	})
	.field("contrast", z.number().min(0.1).max(5.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Contrast Multiplier",
		description:
			"Tonal contrast curve multiplier applied to the luminance/ink density values.",
	})
	.field("dotColor", ColorSchema.default("#000000"), {
		label: "Dot / Ink Color",
		description:
			"Foreground ink color used in Monochrome mode (default #000000).",
	})
	.field("paperColor", ColorSchema.default("#ffffff"), {
		label: "Paper / Background Color",
		description:
			"Substrate background color for Monochrome and CMYK subtractive print rendering.",
	})
	.field("smooth", z.boolean().default(true), {
		label: "Anti-aliasing (Smooth)",
		description:
			"Applies screen-space derivative smoothstep anti-aliasing to dot contours.",
	})
	.field("invert", z.boolean().default(false), {
		label: "Invert Raster",
		description:
			"Inverts ink density values (negative / photographic print effect).",
	})
	.field("cyanAngle", z.number().min(0).max(360).default(15), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Cyan Angle Offset (deg)",
		description:
			"Rotational angle offset for Cyan channel in CMYK mode (standard offset: 15°).",
	})
	.field("magentaAngle", z.number().min(0).max(360).default(75), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Magenta Angle Offset (deg)",
		description:
			"Rotational angle offset for Magenta channel in CMYK mode (standard offset: 75°).",
	})
	.field("yellowAngle", z.number().min(0).max(360).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Yellow Angle Offset (deg)",
		description:
			"Rotational angle offset for Yellow channel in CMYK mode (standard offset: 0°).",
	})
	.field("blackAngle", z.number().min(0).max(360).default(45), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Black Angle Offset (deg)",
		description:
			"Rotational angle offset for Black (Key) channel in CMYK mode (standard offset: 45°).",
	})
	.field("opacity", z.number().min(0).max(1.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Effect Opacity",
		description:
			"Blend opacity between the original input media and the screened halftone result.",
	})
	.build();

export const HalftoneScreenNodeConfigSchema = halftoneScreenConfig.schema;
export type HalftoneScreenNodeConfig = z.infer<
	typeof HalftoneScreenNodeConfigSchema
>;

export const HalftoneScreenResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);
export type HalftoneScreenResult = z.infer<typeof HalftoneScreenResultSchema>;

export const HalftoneScreenOperationSchema =
	HalftoneScreenNodeConfigSchema.extend({
		op: z.literal("HalftoneScreen"),
		metadata: z.record(z.string(), z.unknown()).optional(),
		frequencyHandleId: z.string().nullable().optional(),
		angleHandleId: z.string().nullable().optional(),
		contrastHandleId: z.string().nullable().optional(),
		cyanAngleHandleId: z.string().nullable().optional(),
		magentaAngleHandleId: z.string().nullable().optional(),
		yellowAngleHandleId: z.string().nullable().optional(),
		blackAngleHandleId: z.string().nullable().optional(),
		opacityHandleId: z.string().nullable().optional(),
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

export type HalftoneScreenOperation = z.infer<
	typeof HalftoneScreenOperationSchema
>;

export const HALFTONE_SCREEN_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
