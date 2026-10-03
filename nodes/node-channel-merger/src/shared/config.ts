import {
	configBuilder,
	ImageResultSchema,
	VideoResultSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const ChannelColorSpaceEnum = z.enum(["RGBA", "HSLA", "CMYK", "LAB"]);

export type ChannelColorSpace = z.infer<typeof ChannelColorSpaceEnum>;

export const channelMergerConfig = configBuilder()
	.field("colorSpace", ChannelColorSpaceEnum.default("RGBA"), {
		label: "Color Model",
		description:
			"Color space used for channel recombination (RGBA, HSLA, CMYK, or LAB).",
	})
	.field(
		"defaultChannel4",
		z.number().min(0).max(1).multipleOf(0.01).default(1.0),
		{
			bindable: true,
			dataTypes: ["Number", "Signal"],
			label: "Default Channel 4 Value",
			description:
				"Fallback value used when Channel 4 is unconnected (Alpha=1.0, Black=0.0 in CMYK).",
		},
	)
	.build();

export const ChannelMergerNodeConfigSchema = channelMergerConfig.schema;

export type ChannelMergerNodeConfig = z.infer<
	typeof ChannelMergerNodeConfigSchema
>;

export const ChannelMergerResultSchema = z.union([
	ImageResultSchema,
	VideoResultSchema,
]);

export type ChannelMergerResult = z.infer<typeof ChannelMergerResultSchema>;

export const CHANNEL_MERGER_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};

export const CHANNEL_MERGER_LABELS_BY_COLORSPACE: Record<
	ChannelColorSpace,
	[string, string, string, string]
> = {
	RGBA: ["Red (R)", "Green (G)", "Blue (B)", "Alpha (A)"],
	HSLA: ["Hue (H)", "Saturation (S)", "Lightness (L)", "Alpha (A)"],
	CMYK: ["Cyan (C)", "Magenta (M)", "Yellow (Y)", "Black (K)"],
	LAB: ["Lightness (L*)", "a* (Green-Red)", "b* (Blue-Yellow)", "Alpha (A)"],
};
