import {
	createOutputItemSchema,
	VirtualMediaDataSchema,
} from "@gitframes/core";
import {
	configBuilder,
	MultiOutputGenericSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const ChannelColorSpaceEnum = z.enum(["RGBA", "HSLA", "CMYK", "LAB"]);

export type ChannelColorSpace = z.infer<typeof ChannelColorSpaceEnum>;

export const channelSplitterConfig = configBuilder()
	.field("colorSpace", ChannelColorSpaceEnum.default("RGBA"), {
		label: "Color Model",
		description:
			"Color space used for channel decomposition (RGBA, HSLA, CMYK, or LAB).",
	})
	.build();

export const ChannelSplitterNodeConfigSchema = channelSplitterConfig.schema;

export type ChannelSplitterNodeConfig = z.infer<
	typeof ChannelSplitterNodeConfigSchema
>;

export const ChannelSplitterResultSchema = MultiOutputGenericSchema(
	z.union([
		createOutputItemSchema(z.literal("Video"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("Image"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("SVG"), VirtualMediaDataSchema),
		createOutputItemSchema(z.literal("GIF"), VirtualMediaDataSchema),
	]),
);

export type ChannelSplitterResult = z.infer<typeof ChannelSplitterResultSchema>;

export const CHANNEL_SPLITTER_OUTPUT_TYPE_MAP: Record<
	string,
	"Image" | "Video" | "GIF"
> = {
	Video: "Video",
	Lottie: "Video",
	GIF: "GIF",
	Image: "Image",
	SVG: "Image",
};

export const CHANNEL_LABELS_BY_COLORSPACE: Record<
	ChannelColorSpace,
	[string, string, string, string]
> = {
	RGBA: ["Red (R)", "Green (G)", "Blue (B)", "Alpha (A)"],
	HSLA: ["Hue (H)", "Saturation (S)", "Lightness (L)", "Alpha (A)"],
	CMYK: ["Cyan (C)", "Magenta (M)", "Yellow (Y)", "Black (K)"],
	LAB: ["Lightness (L*)", "a* (Green-Red)", "b* (Blue-Yellow)", "Alpha (A)"],
};
