import type {
	EdgeMode,
	TileOffsetNodeConfig,
	TileOffsetOperation,
	TileOffsetResult,
} from "./config.js";

export type {
	EdgeMode,
	TileOffsetNodeConfig,
	TileOffsetOperation,
	TileOffsetResult,
};

export interface TileOffsetRenderProps {
	offsetX: number;
	offsetY: number;
	wrap: boolean;
	edgeMode: EdgeMode;
}
