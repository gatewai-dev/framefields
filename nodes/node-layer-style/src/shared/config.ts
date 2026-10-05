import type { DataType } from "@framefields/core";
import {
	ColorSchema,
	ImageResultSchema,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const LAYER_STYLE_BLEND_MODES = [
	{ value: "normal", label: "Normal" },
	{ value: "multiply", label: "Multiply" },
	{ value: "screen", label: "Screen" },
	{ value: "overlay", label: "Overlay" },
	{ value: "darken", label: "Darken" },
	{ value: "lighten", label: "Lighten" },
	{ value: "color-dodge", label: "Color Dodge" },
	{ value: "color-burn", label: "Color Burn" },
	{ value: "hard-light", label: "Hard Light" },
	{ value: "soft-light", label: "Soft Light" },
	{ value: "difference", label: "Difference" },
	{ value: "exclusion", label: "Exclusion" },
	{ value: "hue", label: "Hue" },
	{ value: "saturation", label: "Saturation" },
	{ value: "color", label: "Color" },
	{ value: "luminosity", label: "Luminosity" },
	{ value: "lighter", label: "Lighter (Add)" },
	{ value: "copy", label: "Copy" },
	{ value: "xor", label: "XOR" },
	{ value: "source-over", label: "Source Over" },
	{ value: "source-in", label: "Source In" },
	{ value: "source-out", label: "Source Out" },
	{ value: "source-atop", label: "Source Atop" },
	{ value: "destination-over", label: "Destination Over" },
	{ value: "destination-in", label: "Destination In" },
	{ value: "destination-out", label: "Destination Out" },
	{ value: "destination-atop", label: "Destination Atop" },
] as const;

export const DropShadowStyleSchema = z.object({
	enabled: z.boolean().default(false),
	color: ColorSchema.default("#000000"),
	opacity: z.number().min(0).max(1).default(0.75),
	angle: z.number().min(0).max(360).default(120),
	distance: z.number().min(0).max(500).default(10),
	spread: z.number().min(0).max(100).default(0),
	size: z.number().min(0).max(250).default(10),
	blendMode: z.string().default("multiply"),
});

export const InnerShadowStyleSchema = z.object({
	enabled: z.boolean().default(false),
	color: ColorSchema.default("#000000"),
	opacity: z.number().min(0).max(1).default(0.75),
	angle: z.number().min(0).max(360).default(120),
	distance: z.number().min(0).max(500).default(5),
	choke: z.number().min(0).max(100).default(0),
	size: z.number().min(0).max(250).default(5),
	blendMode: z.string().default("multiply"),
});

export const StrokeStyleSchema = z.object({
	enabled: z.boolean().default(false),
	size: z.number().min(0).max(100).default(2),
	position: z.enum(["inside", "center", "outside"]).default("outside"),
	color: ColorSchema.default("#ffffff"),
	opacity: z.number().min(0).max(1).default(1.0),
	blendMode: z.string().default("normal"),
});

export const GlowStyleSchema = z.object({
	enabled: z.boolean().default(false),
	color: ColorSchema.default("#ffffff"),
	opacity: z.number().min(0).max(1).default(0.75),
	size: z.number().min(0).max(250).default(15),
	spread: z.number().min(0).max(100).default(0),
	blendMode: z.string().default("screen"),
});

export const BevelEmbossStyleSchema = z.object({
	enabled: z.boolean().default(false),
	style: z
		.enum(["InnerBevel", "OuterBevel", "Emboss", "PillowEmboss"])
		.default("InnerBevel"),
	technique: z.enum(["Smooth", "ChiselHard", "ChiselSoft"]).default("Smooth"),
	depth: z.number().min(1).max(1000).default(100),
	direction: z.enum(["Up", "Down"]).default("Up"),
	size: z.number().min(0).max(250).default(5),
	soften: z.number().min(0).max(50).default(0),
	angle: z.number().min(0).max(360).default(120),
	altitude: z.number().min(0).max(90).default(30),
	highlightColor: ColorSchema.default("#ffffff"),
	highlightOpacity: z.number().min(0).max(1).default(0.75),
	shadowColor: ColorSchema.default("#000000"),
	shadowOpacity: z.number().min(0).max(1).default(0.75),
});

export const ColorOverlayStyleSchema = z.object({
	enabled: z.boolean().default(false),
	color: ColorSchema.default("#ff0000"),
	opacity: z.number().min(0).max(1).default(1.0),
	blendMode: z.string().default("normal"),
});

export const DEFAULT_DROP_SHADOW = {
	enabled: false,
	color: "#000000",
	opacity: 0.75,
	angle: 120,
	distance: 10,
	spread: 0,
	size: 10,
	blendMode: "multiply",
};

export const DEFAULT_INNER_SHADOW = {
	enabled: false,
	color: "#000000",
	opacity: 0.75,
	angle: 120,
	distance: 5,
	choke: 0,
	size: 5,
	blendMode: "multiply",
};

export const DEFAULT_GLOW = {
	enabled: false,
	color: "#ffffff",
	opacity: 0.75,
	size: 15,
	spread: 0,
	blendMode: "screen",
};

export const DEFAULT_STROKE: {
	enabled: boolean;
	size: number;
	position: "inside" | "center" | "outside";
	color: string;
	opacity: number;
	blendMode: string;
} = {
	enabled: false,
	size: 2,
	position: "outside",
	color: "#ffffff",
	opacity: 1.0,
	blendMode: "normal",
};

export const DEFAULT_BEVEL_EMBOSS: {
	enabled: boolean;
	style: "InnerBevel" | "OuterBevel" | "Emboss" | "PillowEmboss";
	technique: "Smooth" | "ChiselHard" | "ChiselSoft";
	depth: number;
	direction: "Up" | "Down";
	size: number;
	soften: number;
	angle: number;
	altitude: number;
	highlightColor: string;
	highlightOpacity: number;
	shadowColor: string;
	shadowOpacity: number;
} = {
	enabled: false,
	style: "InnerBevel",
	technique: "Smooth",
	depth: 100,
	direction: "Up",
	size: 5,
	soften: 0,
	angle: 120,
	altitude: 30,
	highlightColor: "#ffffff",
	highlightOpacity: 0.75,
	shadowColor: "#000000",
	shadowOpacity: 0.75,
};

export const DEFAULT_COLOR_OVERLAY = {
	enabled: false,
	color: "#ff0000",
	opacity: 1.0,
	blendMode: "normal",
};

export const LayerStyleNodeConfigSchema = z.object({
	dropShadow: DropShadowStyleSchema.default(DEFAULT_DROP_SHADOW),
	innerShadow: InnerShadowStyleSchema.default(DEFAULT_INNER_SHADOW),
	outerGlow: GlowStyleSchema.default(DEFAULT_GLOW),
	innerGlow: GlowStyleSchema.default(DEFAULT_GLOW),
	stroke: StrokeStyleSchema.default(DEFAULT_STROKE),
	bevelEmboss: BevelEmbossStyleSchema.default(DEFAULT_BEVEL_EMBOSS),
	colorOverlay: ColorOverlayStyleSchema.default(DEFAULT_COLOR_OVERLAY),

	// Signal & Dynamic Bindable Handle IDs
	dropShadowAngleHandleId: z.string().nullable().optional(),
	dropShadowDistanceHandleId: z.string().nullable().optional(),
	dropShadowSpreadHandleId: z.string().nullable().optional(),
	dropShadowSizeHandleId: z.string().nullable().optional(),
	dropShadowOpacityHandleId: z.string().nullable().optional(),

	innerShadowAngleHandleId: z.string().nullable().optional(),
	innerShadowDistanceHandleId: z.string().nullable().optional(),
	innerShadowChokeHandleId: z.string().nullable().optional(),
	innerShadowSizeHandleId: z.string().nullable().optional(),
	innerShadowOpacityHandleId: z.string().nullable().optional(),

	outerGlowSizeHandleId: z.string().nullable().optional(),
	outerGlowSpreadHandleId: z.string().nullable().optional(),
	outerGlowOpacityHandleId: z.string().nullable().optional(),

	innerGlowSizeHandleId: z.string().nullable().optional(),
	innerGlowSpreadHandleId: z.string().nullable().optional(),
	innerGlowOpacityHandleId: z.string().nullable().optional(),

	strokeSizeHandleId: z.string().nullable().optional(),
	strokeOpacityHandleId: z.string().nullable().optional(),

	bevelEmbossDepthHandleId: z.string().nullable().optional(),
	bevelEmbossSizeHandleId: z.string().nullable().optional(),
	bevelEmbossSoftenHandleId: z.string().nullable().optional(),
	bevelEmbossAngleHandleId: z.string().nullable().optional(),
	bevelEmbossAltitudeHandleId: z.string().nullable().optional(),
	bevelEmbossHighlightOpacityHandleId: z.string().nullable().optional(),
	bevelEmbossShadowOpacityHandleId: z.string().nullable().optional(),

	colorOverlayOpacityHandleId: z.string().nullable().optional(),
});

export type DropShadowStyle = z.infer<typeof DropShadowStyleSchema>;
export type InnerShadowStyle = z.infer<typeof InnerShadowStyleSchema>;
export type StrokeStyle = z.infer<typeof StrokeStyleSchema>;
export type GlowStyle = z.infer<typeof GlowStyleSchema>;
export type BevelEmbossStyle = z.infer<typeof BevelEmbossStyleSchema>;
export type ColorOverlayStyle = z.infer<typeof ColorOverlayStyleSchema>;
export type LayerStyleNodeConfig = z.infer<typeof LayerStyleNodeConfigSchema>;

export function computeLayerStylePadding(config: LayerStyleNodeConfig): {
	padX: number;
	padY: number;
} {
	let padX = 0;
	let padY = 0;

	// Drop Shadow: offset distance expansion only (blur size does not increase metadata dimensions)
	if (config.dropShadow?.enabled) {
		const angleRad = ((config.dropShadow.angle ?? 120) * Math.PI) / 180;
		const dist = config.dropShadow.distance ?? 0;
		const dx = Math.ceil(Math.abs(Math.cos(angleRad)) * dist);
		const dy = Math.ceil(Math.abs(Math.sin(angleRad)) * dist);
		padX = Math.max(padX, dx);
		padY = Math.max(padY, dy);
	}

	// Stroke expansion (outside / center)
	if (config.stroke?.enabled && config.stroke.position !== "inside") {
		const strokePad =
			config.stroke.position === "outside"
				? Math.ceil(config.stroke.size ?? 2)
				: Math.ceil((config.stroke.size ?? 2) * 0.5);
		padX = Math.max(padX, strokePad);
		padY = Math.max(padY, strokePad);
	}

	return { padX, padY };
}

export interface ConfigHandleBinding {
	configKey: string;
	dataTypes: DataType[];
	label: string;
	description?: string;
}

export const LAYER_STYLE_CONFIG_HANDLES: ConfigHandleBinding[] = [
	{
		configKey: "dropShadowAngle",
		dataTypes: ["Number", "Signal"],
		label: "Drop Shadow Angle Signal",
		description: "Light angle for drop shadow in degrees (0–360°).",
	},
	{
		configKey: "dropShadowDistance",
		dataTypes: ["Number", "Signal"],
		label: "Drop Shadow Distance Signal",
		description: "Offset distance for drop shadow in pixels.",
	},
	{
		configKey: "dropShadowSize",
		dataTypes: ["Number", "Signal"],
		label: "Drop Shadow Blur Signal",
		description: "Blur radius for drop shadow in pixels.",
	},
	{
		configKey: "dropShadowSpread",
		dataTypes: ["Number", "Signal"],
		label: "Drop Shadow Spread Signal",
		description:
			"Edge expansion/sharpness percentage for drop shadow (0–100%).",
	},
	{
		configKey: "dropShadowOpacity",
		dataTypes: ["Number", "Signal"],
		label: "Drop Shadow Opacity Signal",
		description: "Opacity multiplier for drop shadow (0–1).",
	},
	{
		configKey: "innerShadowAngle",
		dataTypes: ["Number", "Signal"],
		label: "Inner Shadow Angle Signal",
		description: "Light angle for inner shadow in degrees (0–360°).",
	},
	{
		configKey: "innerShadowDistance",
		dataTypes: ["Number", "Signal"],
		label: "Inner Shadow Distance Signal",
		description: "Offset distance for inner shadow in pixels.",
	},
	{
		configKey: "innerShadowSize",
		dataTypes: ["Number", "Signal"],
		label: "Inner Shadow Blur Signal",
		description: "Blur radius for inner shadow in pixels.",
	},
	{
		configKey: "innerShadowChoke",
		dataTypes: ["Number", "Signal"],
		label: "Inner Shadow Choke Signal",
		description: "Choke sharpness percentage for inner shadow (0–100%).",
	},
	{
		configKey: "innerShadowOpacity",
		dataTypes: ["Number", "Signal"],
		label: "Inner Shadow Opacity Signal",
		description: "Opacity multiplier for inner shadow (0–1).",
	},
	{
		configKey: "outerGlowSize",
		dataTypes: ["Number", "Signal"],
		label: "Outer Glow Size Signal",
		description: "Glow radius for outer glow in pixels.",
	},
	{
		configKey: "outerGlowSpread",
		dataTypes: ["Number", "Signal"],
		label: "Outer Glow Spread Signal",
		description: "Spread percentage for outer glow (0–100%).",
	},
	{
		configKey: "outerGlowOpacity",
		dataTypes: ["Number", "Signal"],
		label: "Outer Glow Opacity Signal",
		description: "Opacity multiplier for outer glow (0–1).",
	},
	{
		configKey: "innerGlowSize",
		dataTypes: ["Number", "Signal"],
		label: "Inner Glow Size Signal",
		description: "Glow radius for inner glow in pixels.",
	},
	{
		configKey: "innerGlowSpread",
		dataTypes: ["Number", "Signal"],
		label: "Inner Glow Spread Signal",
		description: "Spread percentage for inner glow (0–100%).",
	},
	{
		configKey: "innerGlowOpacity",
		dataTypes: ["Number", "Signal"],
		label: "Inner Glow Opacity Signal",
		description: "Opacity multiplier for inner glow (0–1).",
	},
	{
		configKey: "strokeSize",
		dataTypes: ["Number", "Signal"],
		label: "Stroke Width Signal",
		description: "Stroke line width in pixels.",
	},
	{
		configKey: "strokeOpacity",
		dataTypes: ["Number", "Signal"],
		label: "Stroke Opacity Signal",
		description: "Opacity multiplier for stroke (0–1).",
	},
	{
		configKey: "bevelEmbossDepth",
		dataTypes: ["Number", "Signal"],
		label: "Bevel Depth Signal",
		description: "Bevel depth / extrusion percentage (1–1000%).",
	},
	{
		configKey: "bevelEmbossSize",
		dataTypes: ["Number", "Signal"],
		label: "Bevel Size Signal",
		description: "Bevel beveling size in pixels.",
	},
	{
		configKey: "bevelEmbossSoften",
		dataTypes: ["Number", "Signal"],
		label: "Bevel Soften Signal",
		description: "Edge softening blur radius in pixels.",
	},
	{
		configKey: "bevelEmbossAngle",
		dataTypes: ["Number", "Signal"],
		label: "Bevel Light Angle Signal",
		description: "Azimuth light direction in degrees (0–360°).",
	},
	{
		configKey: "bevelEmbossAltitude",
		dataTypes: ["Number", "Signal"],
		label: "Bevel Light Altitude Signal",
		description: "Elevation light altitude in degrees (0–90°).",
	},
	{
		configKey: "bevelEmbossHighlightOpacity",
		dataTypes: ["Number", "Signal"],
		label: "Bevel Highlight Opacity Signal",
		description: "Highlight specular intensity (0–1).",
	},
	{
		configKey: "bevelEmbossShadowOpacity",
		dataTypes: ["Number", "Signal"],
		label: "Bevel Shadow Opacity Signal",
		description: "Shadow diffuse intensity (0–1).",
	},
	{
		configKey: "colorOverlayOpacity",
		dataTypes: ["Number", "Signal"],
		label: "Color Overlay Opacity Signal",
		description: "Color overlay blend opacity (0–1).",
	},
];

export const LayerStyleResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type LayerStyleResult = z.infer<typeof LayerStyleResultSchema>;

export const LAYER_STYLE_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};

export interface LayerStylePreset {
	id: string;
	name: string;
	description: string;
	config: Partial<LayerStyleNodeConfig>;
}

export const LAYER_STYLE_PRESETS: LayerStylePreset[] = [
	{
		id: "subtle-drop-shadow",
		name: "Subtle Drop Shadow",
		description: "Clean modern floating shadow for UI and graphics",
		config: {
			dropShadow: {
				enabled: true,
				color: "#000000",
				opacity: 0.35,
				angle: 120,
				distance: 8,
				spread: 0,
				size: 16,
				blendMode: "multiply",
			},
			innerShadow: {
				enabled: false,
				color: "#000000",
				opacity: 0.75,
				angle: 120,
				distance: 5,
				choke: 0,
				size: 5,
				blendMode: "multiply",
			},
			outerGlow: {
				enabled: false,
				color: "#ffffff",
				opacity: 0.75,
				size: 15,
				spread: 0,
				blendMode: "screen",
			},
			innerGlow: {
				enabled: false,
				color: "#ffffff",
				opacity: 0.75,
				size: 15,
				spread: 0,
				blendMode: "screen",
			},
			stroke: {
				enabled: false,
				size: 2,
				position: "outside",
				color: "#ffffff",
				opacity: 1.0,
				blendMode: "normal",
			},
			bevelEmboss: {
				enabled: false,
				style: "InnerBevel",
				technique: "Smooth",
				depth: 100,
				direction: "Up",
				size: 5,
				soften: 0,
				angle: 120,
				altitude: 30,
				highlightColor: "#ffffff",
				highlightOpacity: 0.75,
				shadowColor: "#000000",
				shadowOpacity: 0.75,
			},
			colorOverlay: {
				enabled: false,
				color: "#ff0000",
				opacity: 1.0,
				blendMode: "normal",
			},
		},
	},
	{
		id: "sticker-outline-shadow",
		name: "Sticker Border & Shadow",
		description: "Crisp white die-cut sticker border with contact shadow",
		config: {
			dropShadow: {
				enabled: true,
				color: "#000000",
				opacity: 0.4,
				angle: 120,
				distance: 6,
				spread: 0,
				size: 10,
				blendMode: "multiply",
			},
			stroke: {
				enabled: true,
				size: 6,
				position: "outside",
				color: "#ffffff",
				opacity: 1.0,
				blendMode: "normal",
			},
			innerShadow: {
				enabled: false,
				color: "#000000",
				opacity: 0.75,
				angle: 120,
				distance: 5,
				choke: 0,
				size: 5,
				blendMode: "multiply",
			},
			outerGlow: {
				enabled: false,
				color: "#ffffff",
				opacity: 0.75,
				size: 15,
				spread: 0,
				blendMode: "screen",
			},
			innerGlow: {
				enabled: false,
				color: "#ffffff",
				opacity: 0.75,
				size: 15,
				spread: 0,
				blendMode: "screen",
			},
			bevelEmboss: {
				enabled: false,
				style: "InnerBevel",
				technique: "Smooth",
				depth: 100,
				direction: "Up",
				size: 5,
				soften: 0,
				angle: 120,
				altitude: 30,
				highlightColor: "#ffffff",
				highlightOpacity: 0.75,
				shadowColor: "#000000",
				shadowOpacity: 0.75,
			},
			colorOverlay: {
				enabled: false,
				color: "#ff0000",
				opacity: 1.0,
				blendMode: "normal",
			},
		},
	},
	{
		id: "neon-cyber-glow",
		name: "Neon Glow",
		description:
			"Vibrant outer and inner luminescence with soft cyan radiation",
		config: {
			dropShadow: {
				enabled: false,
				color: "#000000",
				opacity: 0.75,
				angle: 120,
				distance: 10,
				spread: 0,
				size: 10,
				blendMode: "multiply",
			},
			innerShadow: {
				enabled: false,
				color: "#000000",
				opacity: 0.75,
				angle: 120,
				distance: 5,
				choke: 0,
				size: 5,
				blendMode: "multiply",
			},
			outerGlow: {
				enabled: true,
				color: "#00f0ff",
				opacity: 0.9,
				size: 28,
				spread: 12,
				blendMode: "screen",
			},
			innerGlow: {
				enabled: true,
				color: "#ffffff",
				opacity: 0.8,
				size: 10,
				spread: 5,
				blendMode: "screen",
			},
			stroke: {
				enabled: true,
				size: 2,
				position: "center",
				color: "#00f0ff",
				opacity: 0.9,
				blendMode: "screen",
			},
			bevelEmboss: {
				enabled: false,
				style: "InnerBevel",
				technique: "Smooth",
				depth: 100,
				direction: "Up",
				size: 5,
				soften: 0,
				angle: 120,
				altitude: 30,
				highlightColor: "#ffffff",
				highlightOpacity: 0.75,
				shadowColor: "#000000",
				shadowOpacity: 0.75,
			},
			colorOverlay: {
				enabled: false,
				color: "#ff0000",
				opacity: 1.0,
				blendMode: "normal",
			},
		},
	},
	{
		id: "glass-emboss",
		name: "Glass & Emboss",
		description: "Pristine glass beveling with specular highlights and depth",
		config: {
			dropShadow: {
				enabled: true,
				color: "#000000",
				opacity: 0.25,
				angle: 120,
				distance: 6,
				spread: 0,
				size: 12,
				blendMode: "multiply",
			},
			innerShadow: {
				enabled: true,
				color: "#000000",
				opacity: 0.3,
				angle: 120,
				distance: 4,
				choke: 0,
				size: 6,
				blendMode: "multiply",
			},
			outerGlow: {
				enabled: false,
				color: "#ffffff",
				opacity: 0.75,
				size: 15,
				spread: 0,
				blendMode: "screen",
			},
			innerGlow: {
				enabled: true,
				color: "#ffffff",
				opacity: 0.6,
				size: 8,
				spread: 0,
				blendMode: "screen",
			},
			stroke: {
				enabled: false,
				size: 2,
				position: "outside",
				color: "#ffffff",
				opacity: 1.0,
				blendMode: "normal",
			},
			bevelEmboss: {
				enabled: true,
				style: "InnerBevel",
				technique: "Smooth",
				depth: 180,
				direction: "Up",
				size: 8,
				soften: 2,
				angle: 120,
				altitude: 35,
				highlightColor: "#ffffff",
				highlightOpacity: 0.9,
				shadowColor: "#000000",
				shadowOpacity: 0.5,
			},
			colorOverlay: {
				enabled: false,
				color: "#ff0000",
				opacity: 1.0,
				blendMode: "normal",
			},
		},
	},
	{
		id: "letterpress-carved",
		name: "Letterpress / Carved",
		description: "Debossed letterpress engraving into paper surface",
		config: {
			dropShadow: {
				enabled: true,
				color: "#ffffff",
				opacity: 0.85,
				angle: 300,
				distance: 2,
				spread: 0,
				size: 1,
				blendMode: "screen",
			},
			innerShadow: {
				enabled: true,
				color: "#000000",
				opacity: 0.7,
				angle: 120,
				distance: 3,
				choke: 10,
				size: 4,
				blendMode: "multiply",
			},
			outerGlow: {
				enabled: false,
				color: "#ffffff",
				opacity: 0.75,
				size: 15,
				spread: 0,
				blendMode: "screen",
			},
			innerGlow: {
				enabled: false,
				color: "#ffffff",
				opacity: 0.75,
				size: 15,
				spread: 0,
				blendMode: "screen",
			},
			stroke: {
				enabled: false,
				size: 2,
				position: "outside",
				color: "#ffffff",
				opacity: 1.0,
				blendMode: "normal",
			},
			bevelEmboss: {
				enabled: true,
				style: "InnerBevel",
				technique: "ChiselHard",
				depth: 150,
				direction: "Down",
				size: 3,
				soften: 0,
				angle: 120,
				altitude: 30,
				highlightColor: "#ffffff",
				highlightOpacity: 0.6,
				shadowColor: "#000000",
				shadowOpacity: 0.8,
			},
			colorOverlay: {
				enabled: false,
				color: "#ff0000",
				opacity: 1.0,
				blendMode: "normal",
			},
		},
	},
	{
		id: "gold-bevel",
		name: "Metallic Gold Bevel",
		description: "High-specular chisel gold badge with deep relief",
		config: {
			dropShadow: {
				enabled: true,
				color: "#000000",
				opacity: 0.6,
				angle: 120,
				distance: 8,
				spread: 5,
				size: 12,
				blendMode: "multiply",
			},
			innerShadow: {
				enabled: true,
				color: "#573a08",
				opacity: 0.5,
				angle: 120,
				distance: 3,
				choke: 0,
				size: 5,
				blendMode: "multiply",
			},
			outerGlow: {
				enabled: true,
				color: "#ffc83b",
				opacity: 0.4,
				size: 20,
				spread: 5,
				blendMode: "screen",
			},
			innerGlow: {
				enabled: true,
				color: "#fff7d1",
				opacity: 0.5,
				size: 6,
				spread: 0,
				blendMode: "screen",
			},
			stroke: {
				enabled: true,
				size: 2,
				position: "outside",
				color: "#b38728",
				opacity: 1.0,
				blendMode: "normal",
			},
			bevelEmboss: {
				enabled: true,
				style: "InnerBevel",
				technique: "ChiselHard",
				depth: 350,
				direction: "Up",
				size: 10,
				soften: 1,
				angle: 120,
				altitude: 40,
				highlightColor: "#fff4cc",
				highlightOpacity: 0.95,
				shadowColor: "#422b00",
				shadowOpacity: 0.85,
			},
			colorOverlay: {
				enabled: true,
				color: "#f5b324",
				opacity: 0.35,
				blendMode: "overlay",
			},
		},
	},
];
