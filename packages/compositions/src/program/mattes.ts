/**
 * Track mattes and reliefs: a node's `matte` or `relief` is hoisted out into
 * its own layer right after it, so layout places it like any sibling and the
 * renderer can draw owner and companion separately and combine them.
 */
import type { LayoutNode, MatteMode } from "./schema.js";

type AnyNode = LayoutNode & Record<string, unknown>;

const GEOMETRY = ["x", "y", "width", "height"] as const;

/** A companion layer drawn for its owner, never by itself. */
function companion(
	owner: AnyNode,
	src: AnyNode,
	suffix: string,
	tag: Record<string, unknown>,
): AnyNode {
	const id = (src.id as string | undefined) ?? `${String(owner.id)}__${suffix}`;
	const node: AnyNode = { position: "absolute", ...src, id, ...tag };
	// With no geometry of its own it covers its owner's box.
	if (GEOMETRY.every((k) => src[k] === undefined)) {
		for (const k of GEOMETRY) {
			if (typeof owner[k] === "number") node[k] = owner[k];
		}
	}
	// Timed with the owner: its keyframes start when the owner appears.
	const ownerStart =
		typeof owner.startFrame === "number" ? owner.startFrame : 0;
	node.startFrame =
		ownerStart + (typeof src.startFrame === "number" ? src.startFrame : 0);
	if (src.durationFrames === undefined && owner.durationFrames !== undefined) {
		node.durationFrames = owner.durationFrames;
	}
	if (Array.isArray(node.children)) {
		node.children = hoistMattes(node.children as AnyNode[]) as never;
	}
	return node;
}

function hoistOne(owner: AnyNode): AnyNode[] {
	const matte = owner.matte as { node: AnyNode; mode?: MatteMode } | undefined;
	const relief = owner.relief as { node: AnyNode; amount?: number } | undefined;
	const { matte: _matte, relief: _relief, ...rest } = owner;
	const self = { ...rest } as AnyNode;
	if (Array.isArray(self.children)) {
		self.children = hoistMattes(self.children as AnyNode[]) as never;
	}
	const out = [self];
	if (matte?.node) {
		const node = companion(owner, matte.node, "matte", {
			matteOf: String(owner.id),
			matteMode: matte.mode ?? "alpha",
		});
		self.matteId = node.id as string;
		out.push(node);
	}
	if (relief?.node) {
		// The relief is read as a flat picture over its owner's box.
		const node = companion(owner, relief.node, "relief", {
			reliefOf: String(owner.id),
			is3D: false,
			z: 0,
		});
		self.reliefId = node.id as string;
		self.reliefAmount = relief.amount ?? 0;
		out.push(node);
	}
	return out;
}

/** Returns the tree with every `matte` and `relief` turned into a sibling companion layer. */
export function hoistMattes<T extends LayoutNode>(nodes: readonly T[]): T[] {
	return nodes.flatMap((n) => hoistOne(n as AnyNode)) as unknown as T[];
}
