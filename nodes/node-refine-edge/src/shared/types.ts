import type { SignalData } from "@gitframes/core";
import type { MatteChannel, RefineEdgeOutputMode } from "./config.js";

export interface RefineEdgeOp {
	op: "RefineEdge";
	decontaminateAmount?: number;
	radius?: number;
	smooth?: number;
	feather?: number;
	shiftEdge?: number;
	matteChannel?: MatteChannel;
	outputMode?: RefineEdgeOutputMode;
	decontaminateAmountHandleId?: string | null;
	radiusHandleId?: string | null;
	smoothHandleId?: string | null;
	featherHandleId?: string | null;
	shiftEdgeHandleId?: string | null;
	opacity?: number;
	matteMedia?: unknown;
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

export type RefineEdgeSignalData = SignalData & { nodeId?: string };
