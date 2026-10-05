/**
 * Data that changes over time. Build the same chart once per data state (same
 * options, same fixed axes, so every state has the same node ids), then
 * `morph` the states into one tree: wherever a node's geometry differs between
 * states, it gets keyframes that ease it from one state to the next.
 *
 * Bars, candles, points, rings and labels morph this way. Path `d` and text
 * content can't be keyframed, so changing lines are drawn as segment boxes
 * (`segments`) and changing numbers roll on odometers.
 */
import { LayerAnimation, type LayoutNode } from "framefields";

export interface DataState {
	/** Scene frame the morph into this state starts (ignored for the first state). */
	at: number;
	node: LayoutNode;
}

export interface MorphOptions {
	/** Frames each transition takes. */
	duration?: number;
	ease?: string;
	props?: readonly string[];
}

type Node = LayoutNode & Record<string, unknown> & { children?: LayoutNode[] };

const GEOMETRY = ["x", "y", "width", "height", "rotation"] as const;

function index(root: LayoutNode): Map<string, Node> {
	const out = new Map<string, Node>();
	const walk = (n: Node) => {
		out.set(n.id, n);
		for (const c of n.children ?? []) walk(c as Node);
	};
	walk(root as Node);
	return out;
}

/** Appends keyframes to `prop`'s keyframe track, creating it if needed. */
export function appendKeys(
	node: LayoutNode,
	prop: string,
	keys: readonly (readonly [number, number, string?])[],
): void {
	const fresh = LayerAnimation.create().keys(prop as never, keys).tracks[0];
	const tracks = node.animation?.tracks ?? [];
	const existing = tracks.find(
		(t) => t.prop === prop && (!t.source || t.source.type === "keyframe"),
	);
	if (!existing) {
		node.animation = { ...node.animation, tracks: [...tracks, fresh] };
		return;
	}
	const last = existing.keyframes[existing.keyframes.length - 1]?.frame ?? -1;
	const first = fresh.keyframes[0]?.frame ?? 0;
	if (first <= last)
		throw new Error(
			`morph: "${node.id}" ${prop} keys at ${first} overlap its animation (ends ${last})`,
		);
	existing.keyframes.push(
		...fresh.keyframes.map((k, i) => ({
			...k,
			id: `morph_${prop}_${i}_f${k.frame}`,
		})),
	);
}

/** The first state's tree, keyed to ease through every later state. */
export function morph(
	states: readonly DataState[],
	options: MorphOptions = {},
): LayoutNode {
	const duration = options.duration ?? 24;
	const ease = options.ease ?? "power3.inOut";
	const props = options.props ?? GEOMETRY;
	const [base, ...rest] = states;
	const maps = states.map((s) => index(s.node));

	for (const [id, node] of maps[0]) {
		// A layer with its own startFrame reads keyframes on its own clock.
		const clock = typeof node.startFrame === "number" ? node.startFrame : 0;
		for (const prop of props) {
			const values = maps.map((m) => m.get(id)?.[prop]);
			if (!values.every((v) => typeof v === "number")) continue;
			const nums = values as number[];
			if (nums.every((v) => Math.abs(v - nums[0]) < 0.01)) continue;
			const keys: [number, number, string?][] = [];
			rest.forEach((state, k) => {
				const from = nums[k];
				const to = nums[k + 1];
				if (Math.abs(to - from) < 0.01) return;
				// Back-to-back changes: the last one already ends where this one starts.
				const at = state.at - clock;
				if (keys[keys.length - 1]?.[0] !== at) keys.push([at, from]);
				keys.push([at + duration, to, ease]);
			});
			if (keys.length) appendKeys(node, prop, keys);
		}
	}
	return base.node;
}

/** A straight line between two points, as a rotated box: something `morph` can move. */
export function segment(
	from: { x: number; y: number },
	to: { x: number; y: number },
	thickness: number,
): { x: number; y: number; width: number; height: number; rotation: number } {
	return {
		x: from.x,
		y: from.y - thickness / 2,
		width: Math.hypot(to.x - from.x, to.y - from.y),
		height: thickness,
		rotation: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
	};
}
