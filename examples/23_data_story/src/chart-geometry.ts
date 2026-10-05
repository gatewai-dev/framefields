/**
 * Layer.chart returns ordinary nodes with predictable ids
 * (`<id>-bar-<series>-<i>`, `<id>-point-<series>-<i>`, `<id>-slice-<i>`), so a
 * scene can read a bar's or point's geometry and anchor its own overlays to it.
 */
import type { LayoutNode } from "framefields";

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

type Node = LayoutNode & Partial<Box> & { children?: LayoutNode[] };

export function findNode(root: LayoutNode, id: string): Node {
	const walk = (n: Node): Node | undefined => {
		if (n.id === id) return n;
		for (const c of n.children ?? []) {
			const hit = walk(c as Node);
			if (hit) return hit;
		}
		return undefined;
	};
	const hit = walk(root as Node);
	if (!hit) throw new Error(`No node "${id}" in chart "${root.id}"`);
	return hit;
}

/** A chart child's box in the chart's parent coordinates. */
export function boxOf(chart: LayoutNode, id: string): Box {
	const c = chart as Node;
	const n = findNode(chart, id);
	return {
		x: (c.x ?? 0) + (n.x ?? 0),
		y: (c.y ?? 0) + (n.y ?? 0),
		width: Number(n.width ?? 0),
		height: Number(n.height ?? 0),
	};
}
