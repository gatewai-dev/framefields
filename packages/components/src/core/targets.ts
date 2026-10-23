/**
 * Targets: what a pointer lands on, an annotation marks, a camera frames.
 * Static targets resolve to rects at build time; tracked objects and
 * functions resolve to per-frame rects.
 */
import type { Rect } from "./draw.js";
import type { Vec2 } from "./path.js";
import {
	findRange,
	type MeasureFn,
	type MeasureOptions,
	rangeRects,
} from "./text.js";

export type Anchor =
	| "center"
	| "top"
	| "bottom"
	| "left"
	| "right"
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right"
	/** Where a pointer should land: the centre, or mid-left for text. */
	| "tip";

/** A node as targets read it: absolute numeric geometry, or text. */
export interface TargetNode {
	id?: string;
	kind?: string;
	x?: unknown;
	y?: unknown;
	width?: unknown;
	height?: unknown;
	text?: unknown;
	content?: unknown;
	[key: string]: unknown;
}

/** The frame context signals are read with. */
export interface FrameContextLike {
	frame: number;
	fps: number;
	time: number;
	duration: number;
	durationMs: number;
	progress: number;
	deltaTime: number;
}

/** A per-frame value: a signal (what tracked objects expose) or a function. */
export type FrameValue =
	| { get(ctx?: FrameContextLike): number }
	| ((frame: number) => number);

export interface TrackedObjectLike {
	x: FrameValue;
	y: FrameValue;
	width: FrameValue;
	height: FrameValue;
}

export type Target =
	| Vec2
	| Rect
	| { node: TargetNode; anchor?: Anchor }
	| {
			text: TargetNode;
			match?: string | RegExp;
			range?: [number, number];
			nth?: number;
			anchor?: Anchor;
	  }
	| { track: TrackedObjectLike; anchor?: Anchor }
	| ((frame: number) => Vec2 | Rect);

export interface TargetContext {
	measure?: MeasureFn;
	/** Frame rate signals are sampled at (tracked targets). Default 30. */
	fps?: number;
	/** Font defaults for text nodes that don't set them. */
	textDefaults?: Partial<MeasureOptions>;
}

export type ResolvedTarget =
	| { kind: "static"; rects: Rect[]; anchor: Anchor }
	| { kind: "dynamic"; at: (frame: number) => Rect; anchor: Anchor };

const isVec2 = (t: unknown): t is Vec2 =>
	Array.isArray(t) && t.length === 2 && t.every((n) => typeof n === "number");

const isRect = (t: unknown): t is Rect =>
	typeof t === "object" &&
	t !== null &&
	["x", "y", "width", "height"].every(
		(k) => typeof (t as Record<string, unknown>)[k] === "number",
	);

const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined;

function frameValue(v: FrameValue, frame: number, fps: number): number {
	if (typeof v === "function") return v(frame);
	if (v && typeof v.get === "function") {
		const time = frame / fps;
		return v.get({
			frame,
			fps,
			time,
			duration: 0,
			durationMs: 0,
			progress: 0,
			deltaTime: 1 / fps,
		});
	}
	throw new Error(
		"Tracked target values must be signals or (frame) => number.",
	);
}

/** Resolve a target to rects (static) or a per-frame rect (dynamic). */
export function resolveTarget(
	target: Target,
	ctx: TargetContext = {},
): ResolvedTarget {
	if (typeof target === "function") {
		return {
			kind: "dynamic",
			anchor: "center",
			at: (frame) => {
				const v = target(frame);
				return isVec2(v) ? { x: v[0], y: v[1], width: 0, height: 0 } : v;
			},
		};
	}
	if (isVec2(target)) {
		return {
			kind: "static",
			anchor: "center",
			rects: [{ x: target[0], y: target[1], width: 0, height: 0 }],
		};
	}
	if (isRect(target))
		return { kind: "static", anchor: "center", rects: [target] };

	if ("track" in target) {
		const t = target.track;
		const fps = ctx.fps ?? 30;
		return {
			kind: "dynamic",
			anchor: target.anchor ?? "center",
			at: (frame) => ({
				x: frameValue(t.x, frame, fps),
				y: frameValue(t.y, frame, fps),
				width: frameValue(t.width, frame, fps),
				height: frameValue(t.height, frame, fps),
			}),
		};
	}

	if ("text" in target) {
		return {
			kind: "static",
			anchor: target.anchor ?? "tip",
			rects: textRects(target, ctx),
		};
	}

	const node = target.node;
	const rect = nodeRect(node);
	if (!rect) {
		throw new Error(
			`Target node "${node.id ?? "?"}" has no absolute geometry. Give it numeric x, y, width and height, or target a rect.`,
		);
	}
	return { kind: "static", anchor: target.anchor ?? "center", rects: [rect] };
}

function nodeRect(node: TargetNode): Rect | null {
	const x = num(node.x);
	const y = num(node.y);
	const width = num(node.width);
	const height = num(node.height);
	if (
		x === undefined ||
		y === undefined ||
		width === undefined ||
		height === undefined
	) {
		return null;
	}
	return { x, y, width, height };
}

function textRects(
	target: Extract<Target, { text: TargetNode }>,
	ctx: TargetContext,
): Rect[] {
	const node = target.text;
	const content =
		typeof node.text === "string"
			? node.text
			: typeof node.content === "string"
				? node.content
				: null;
	if (content === null)
		throw new Error("Text target node has no string content.");
	const x = num(node.x);
	const y = num(node.y);
	if (x === undefined || y === undefined) {
		throw new Error(
			`Text target "${node.id ?? "?"}" needs numeric x and y so its glyphs can be placed.`,
		);
	}
	if (!ctx.measure) throw new Error("Text targets need a measure function.");
	const fontFamily =
		(node.fontFamily as string | undefined) ?? ctx.textDefaults?.fontFamily;
	if (!fontFamily) throw new Error("Text target has no fontFamily.");
	const options: MeasureOptions = {
		...ctx.textDefaults,
		fontFamily,
		fontSize: num(node.fontSize) ?? ctx.textDefaults?.fontSize,
		fontWeight:
			(node.fontWeight as string | number | undefined) ??
			ctx.textDefaults?.fontWeight,
		letterSpacing: num(node.letterSpacing) ?? ctx.textDefaults?.letterSpacing,
		lineHeight: num(node.lineHeight) ?? ctx.textDefaults?.lineHeight,
		width: num(node.width),
		align: alignOf(node.align),
		direction: node.direction as MeasureOptions["direction"],
	};
	const range =
		target.range ??
		(target.match !== undefined
			? findRange(content, target.match, target.nth ?? 0)
			: [0, content.length]);
	if (!range) {
		throw new Error(
			`Text target: "${String(target.match)}" not found in "${content}".`,
		);
	}
	const metrics = ctx.measure(content, options);
	const rects = rangeRects(metrics, range[0], range[1], options);
	if (rects.length === 0)
		throw new Error("Text target range covers no glyphs.");
	return rects.map((r) => ({ ...r, x: r.x + x, y: r.y + y }));
}

/** Text node alignment (start / center / end, or left / right) as measure reads it. */
function alignOf(align: unknown): MeasureOptions["align"] {
	if (align === "center") return "center";
	if (align === "end" || align === "right") return "right";
	return "left";
}

/** The union rect of `rects`. */
export function boundsOf(rects: readonly Rect[]): Rect {
	if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	let x0 = Number.POSITIVE_INFINITY;
	let y0 = Number.POSITIVE_INFINITY;
	let x1 = Number.NEGATIVE_INFINITY;
	let y1 = Number.NEGATIVE_INFINITY;
	for (const r of rects) {
		x0 = Math.min(x0, r.x);
		y0 = Math.min(y0, r.y);
		x1 = Math.max(x1, r.x + r.width);
		y1 = Math.max(y1, r.y + r.height);
	}
	return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The point of `rect` named by `anchor`. `tip` on text = start of the first line, mid-height. */
export function anchorPoint(
	rect: Rect,
	anchor: Anchor = "center",
	isText = false,
): Vec2 {
	const { x, y, width: w, height: h } = rect;
	switch (anchor) {
		case "tip":
			return isText ? [x, y + h / 2] : [x + w / 2, y + h / 2];
		case "center":
			return [x + w / 2, y + h / 2];
		case "top":
			return [x + w / 2, y];
		case "bottom":
			return [x + w / 2, y + h];
		case "left":
			return [x, y + h / 2];
		case "right":
			return [x + w, y + h / 2];
		case "top-left":
			return [x, y];
		case "top-right":
			return [x + w, y];
		case "bottom-left":
			return [x, y + h];
		case "bottom-right":
			return [x + w, y + h];
	}
}

/** The point a resolved target names at `frame` (static targets ignore frame). */
export function targetPoint(
	resolved: ResolvedTarget,
	frame = 0,
	isText = false,
): Vec2 {
	if (resolved.kind === "dynamic")
		return anchorPoint(resolved.at(frame), resolved.anchor, isText);
	const first = resolved.rects[0] as Rect;
	return anchorPoint(
		resolved.anchor === "tip" ? first : boundsOf(resolved.rects),
		resolved.anchor,
		isText,
	);
}
