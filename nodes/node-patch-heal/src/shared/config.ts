import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const MAX_RADIUS = 500;
export const MAX_FEATHER = 100;
export const MAX_OFFSET = 4096;

export const PatchItemSchema = z.object({
	id: z.string().default("patch"),
	centerX: z.number().min(0).max(1).default(0.5),
	centerY: z.number().min(0).max(1).default(0.5),
	offsetX: z.number().min(-MAX_OFFSET).max(MAX_OFFSET).default(50),
	offsetY: z.number().min(-MAX_OFFSET).max(MAX_OFFSET).default(0),
	radius: z.number().min(1).max(MAX_RADIUS).default(25),
	sourceRadius: z.number().min(1).max(MAX_RADIUS).default(25),
	feather: z.number().min(0).max(MAX_FEATHER).default(50),
	opacity: z.number().min(0).max(1.0).default(1.0),
	mode: z
		.enum(["Clone", "SeamlessHeal", "TextureTransfer"])
		.default("SeamlessHeal"),
});

export type PatchItem = z.infer<typeof PatchItemSchema>;

export const patchHealConfig = configBuilder()
	.field("patches", z.array(PatchItemSchema).optional(), {
		label: "Patches",
		description: "List of patch healing operations applied sequentially.",
	})
	.field("centerX", z.number().min(0).max(1).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Center X Signal",
		description:
			"Horizontal normalized position of destination patch (0.0 to 1.0).",
	})
	.field("centerY", z.number().min(0).max(1).default(0.5), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Center Y Signal",
		description:
			"Vertical normalized position of destination patch (0.0 to 1.0).",
	})
	.field("offsetX", z.number().min(-MAX_OFFSET).max(MAX_OFFSET).default(50), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Source Offset X Signal",
		description:
			"Horizontal pixel distance from destination to sample source patch.",
	})
	.field("offsetY", z.number().min(-MAX_OFFSET).max(MAX_OFFSET).default(0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Source Offset Y Signal",
		description:
			"Vertical pixel distance from destination to sample source patch.",
	})
	.field("radius", z.number().min(1).max(MAX_RADIUS).default(25), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Target Radius Signal",
		description:
			"Radius of the destination circular patch in pixels (used when no explicit Mask input is connected).",
	})
	.field("sourceRadius", z.number().min(1).max(MAX_RADIUS).default(25), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Source Radius Signal",
		description: "Radius of the source sample circular patch in pixels.",
	})
	.field("feather", z.number().min(0).max(MAX_FEATHER).default(50), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Feather Signal",
		description: "Softness edge falloff percentage (0–100%).",
	})
	.field("opacity", z.number().min(0).max(1.0).default(1.0), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Opacity Signal",
		description: "Blending opacity of the healed patch (0.0–1.0).",
	})
	.field(
		"mode",
		z
			.enum(["Clone", "SeamlessHeal", "TextureTransfer"])
			.default("SeamlessHeal"),
		{
			label: "Healing Mode",
			description:
				"Healing algorithm: Clone (direct stamp), SeamlessHeal (Poisson color/lighting blend), TextureTransfer (luminance structure matching).",
		},
	)
	.build();

export const PatchHealNodeConfigSchema = patchHealConfig.schema;

export type PatchHealNodeConfig = z.infer<typeof PatchHealNodeConfigSchema>;

export function normalizePatches(
	config: Partial<PatchHealNodeConfig> | undefined,
): PatchItem[] {
	if (config?.patches && config.patches.length > 0) {
		return config.patches.map((p, idx) => ({
			id: p.id || `patch-${idx + 1}`,
			centerX: p.centerX ?? 0.5,
			centerY: p.centerY ?? 0.5,
			offsetX: p.offsetX ?? 50,
			offsetY: p.offsetY ?? 0,
			radius: p.radius ?? 25,
			sourceRadius: p.sourceRadius ?? p.radius ?? 25,
			feather: p.feather ?? 50,
			opacity: p.opacity ?? 1.0,
			mode: p.mode ?? "SeamlessHeal",
		}));
	}

	const fallbackRadius = config?.radius ?? 25;
	return [
		{
			id: "patch-1",
			centerX: config?.centerX ?? 0.5,
			centerY: config?.centerY ?? 0.5,
			offsetX: config?.offsetX ?? 50,
			offsetY: config?.offsetY ?? 0,
			radius: fallbackRadius,
			sourceRadius: config?.sourceRadius ?? fallbackRadius,
			feather: config?.feather ?? 50,
			opacity: config?.opacity ?? 1.0,
			mode: config?.mode ?? "SeamlessHeal",
		},
	];
}

export const PatchHealResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type PatchHealResult = z.infer<typeof PatchHealResultSchema>;

export const PATCH_HEAL_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};
