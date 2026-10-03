import { createContext, useContext } from "react";

export interface RenderTimelineContextValue {
	/**
	 * Total seek offset into the source media (seconds).
	 * This is the sum of (segment.startSec - segmentOffsetInComposition).
	 */
	accumulatedSeekOffsetSec: number;
	/**
	 * Total clock offset introduced by <Sequence> shifts (seconds).
	 */
	accumulatedClockOffsetSec: number;
}

const RenderTimelineContext = createContext<RenderTimelineContextValue>({
	accumulatedSeekOffsetSec: 0,
	accumulatedClockOffsetSec: 0,
});

export const RenderTimelineProvider = RenderTimelineContext.Provider;

export const useRenderTimeline = () => useContext(RenderTimelineContext);
