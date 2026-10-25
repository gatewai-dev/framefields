/**
 * Keyframe bookkeeping shared by every component: ordering, sampling, and
 * builders that collect keys per node and prop before animating once.
 */
import {
	type AnimatableProp,
	type KeyframeTuple,
	LayerAnimation,
} from "@framefields/compositions/program";
import { evaluateEase } from "./ease.js";

/** Round to `places` decimals (default 3): keeps baked keys short and stable. */
export const round = (v: number, places = 3): number => {
	const k = 10 ** places;
	return Math.round(v * k) / k;
};

/** The last element, or `undefined`. */
export const last = <T>(list: readonly T[]): T | undefined =>
	list[list.length - 1];

/**
 * Keys in ascending frame order; of several keys on one frame, the one given
 * last wins. Input order is otherwise free.
 */
export function ascending(keys: readonly KeyframeTuple[]): KeyframeTuple[] {
	const byFrame = new Map<number, KeyframeTuple>();
	for (const k of keys) byFrame.set(k[0], k);
	return [...byFrame.values()].sort((a, b) => a[0] - b[0]);
}

/**
 * Keys written as a timeline where each key supersedes what came before at
 * or after its frame: a key earlier than the previous one drops the later
 * ones (a retarget cancels the planned rest of a move).
 */
export function supersede(keys: readonly KeyframeTuple[]): KeyframeTuple[] {
	const out: KeyframeTuple[] = [];
	for (const k of keys) {
		while (out.length > 0 && (last(out) as KeyframeTuple)[0] >= k[0]) out.pop();
		out.push(k);
	}
	return out;
}

/**
 * A numeric track's value at `frame`, the way the renderer evaluates it:
 * each segment eased by its end key's ease, `hold` stepping on the key.
 */
export function valueAt(keys: readonly KeyframeTuple[], frame: number): number {
	const first = keys[0];
	if (!first) return 0;
	if (frame <= first[0]) return first[1] as number;
	for (let i = 1; i < keys.length; i++) {
		const [f0, v0] = keys[i - 1] as KeyframeTuple;
		const [f1, v1, ease] = keys[i] as KeyframeTuple;
		if (frame > f1) continue;
		if (ease === "hold") return frame === f1 ? (v1 as number) : (v0 as number);
		const t = evaluateEase(
			typeof ease === "string" ? ease : undefined,
			(frame - f0) / Math.max(1, f1 - f0),
		);
		return (v0 as number) + ((v1 as number) - (v0 as number)) * t;
	}
	return (last(keys) as KeyframeTuple)[1] as number;
}

/** A value track built from transitions: each eases from wherever the value is to `to`. */
export class Track {
	private changes: Array<{
		start: number;
		end: number;
		to: number;
		ease: string;
	}> = [];

	constructor(private readonly initial: number) {}

	to(start: number, end: number, value: number, ease = "power2.out"): this {
		this.changes.push({ start, end: Math.max(start, end), to: value, ease });
		return this;
	}

	/** Jump to `value` on `frame` (a hold key). */
	set(frame: number, value: number): this {
		return this.to(frame, frame, value);
	}

	/** Ascending keyframes; a change that starts mid-transition starts from its target. */
	keys(): KeyframeTuple[] {
		const keys: KeyframeTuple[] = [[0, this.initial]];
		let value = this.initial;
		for (const c of [...this.changes].sort((x, y) => x.start - y.start)) {
			const prev = last(keys) as KeyframeTuple;
			const start = Math.max(c.start, prev[0] + (c.end === c.start ? 1 : 0));
			if (start > prev[0]) keys.push([start, value]);
			const end = Math.max(c.end, start);
			if (end === start) keys[keys.length - 1] = [start, c.to, "hold"];
			else keys.push([end, c.to, c.ease]);
			value = c.to;
		}
		return supersede(keys);
	}
}

/**
 * Keys collected per node and prop from anywhere in a build, merged into one
 * ascending track each and applied with one `animate()` per node.
 */
export class KeyBook<N extends { animate(...anims: unknown[]): unknown }> {
	private readonly book = new Map<N, Map<string, KeyframeTuple[]>>();

	/** Append keys for `node`'s `prop` (merged with any already given). */
	key(
		node: N,
		prop: AnimatableProp | (string & {}),
		keys: KeyframeTuple[],
	): this {
		const byProp = this.book.get(node) ?? new Map<string, KeyframeTuple[]>();
		this.book.set(node, byProp);
		byProp.set(prop, [...(byProp.get(prop) ?? []), ...keys]);
		return this;
	}

	/** Animate every node once with its merged tracks. */
	apply(): void {
		for (const [node, byProp] of this.book) {
			const anim = LayerAnimation.create();
			for (const [prop, keys] of byProp)
				anim.keys(prop as AnimatableProp, ascending(keys));
			node.animate(anim);
		}
	}
}
