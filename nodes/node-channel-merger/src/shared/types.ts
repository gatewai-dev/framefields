import type { VirtualMediaData } from "@gitframes/core";
import type { ChannelColorSpace } from "./config.js";

export interface ChannelMergerOp {
	op: "ChannelMerger";
	colorSpace: ChannelColorSpace;
	defaultChannel4?: number;
	metadata?: Record<string, unknown>;
	dataType?: "Image" | "Video" | "GIF" | "SVG";
	channel1Media?: VirtualMediaData | null;
	channel2Media?: VirtualMediaData | null;
	channel3Media?: VirtualMediaData | null;
	channel4Media?: VirtualMediaData | null;
	inputs?: Record<
		string,
		{
			connectionValid: boolean;
			outputItem: {
				type: string;
				data: unknown;
			} | null;
		}
	>;
}

export type ChannelMergerVirtualMedia = VirtualMediaData;
