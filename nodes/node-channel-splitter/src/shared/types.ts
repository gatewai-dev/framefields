import type { VirtualMediaData } from "@gitframes/core";
import type { ChannelColorSpace } from "./config.js";

export interface ChannelSplitterOp {
	op: "ChannelSplitter";
	colorSpace: ChannelColorSpace;
	channelIndex: 0 | 1 | 2 | 3;
	metadata?: Record<string, unknown>;
	dataType?: "Image" | "Video" | "GIF" | "SVG";
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

export type ChannelSplitterVirtualMedia = VirtualMediaData;
