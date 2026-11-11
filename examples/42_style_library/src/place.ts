import { Layer, type LayoutNode } from "framefields";

/** An absolutely placed box, the building block of every reference. */
export function at(
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
	extra: Parameters<typeof Layer.box>[0] = {},
): ReturnType<typeof Layer.box> {
	return Layer.box({ id, position: "absolute", x, y, width, height, ...extra });
}

/** A full-frame box. */
export const full = (
	id: string,
	w: number,
	h: number,
	children: LayoutNode[],
	background?: string,
) => at(id, 0, 0, w, h, { background, overflow: "hidden", children });
