import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@framefields/node-sdk";
import { z } from "zod";

export const rotateConfig = configBuilder()
	.field("angle", z.number().default(90), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Angle Signal",
		description:
			"Rotation in degrees about the frame center, clockwise. Any value; 90 / 180 / 270 fix footage shot sideways or upside down.",
	})
	.field("fit", z.enum(["cover", "contain", "fill"]).default("cover"), {
		description:
			"How the rotated source sits in the output: cover fills it (cropping the overhang), contain shows all of it (transparent margins), fill keeps the unrotated source stretched to the output and only turns it.",
	})
	.field("scale", z.number().min(0.01).max(20).default(1), {
		bindable: true,
		dataTypes: ["Number", "Signal"],
		label: "Scale Signal",
		description: "Extra zoom applied after the fit (1 = exactly fitted).",
	})
	.build();

export const RotateNodeConfigSchema = rotateConfig.schema;

export type RotateNodeConfig = z.infer<typeof RotateNodeConfigSchema>;

export const RotateResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type RotateResult = z.infer<typeof RotateResultSchema>;

export const ROTATE_OUTPUT_TYPE_MAP: Record<string, "Image" | "Video" | "GIF"> =
	{
		Video: "Video",
		Lottie: "Video",
		GIF: "GIF",
		Image: "Image",
		SVG: "Image",
	};

/**
 * Size (px) of the rotated source inside a `targetWidth × targetHeight` output.
 * `cover` is the smallest size whose rotated rectangle still covers the whole
 * output; `contain` the largest whose rotated bounding box fits inside it.
 */
export function rotatedSourceSize(
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
	angleDeg: number,
	fit: "cover" | "contain" | "fill",
): { width: number; height: number } {
	if (fit === "fill") return { width: targetWidth, height: targetHeight };
	const rad = (angleDeg * Math.PI) / 180;
	const c = Math.abs(Math.cos(rad));
	const s = Math.abs(Math.sin(rad));
	const k =
		fit === "cover"
			? Math.max(
					(c * targetWidth + s * targetHeight) / sourceWidth,
					(s * targetWidth + c * targetHeight) / sourceHeight,
				)
			: Math.min(
					targetWidth / (c * sourceWidth + s * sourceHeight),
					targetHeight / (s * sourceWidth + c * sourceHeight),
				);
	return { width: sourceWidth * k, height: sourceHeight * k };
}
