/**
 * Yoga-backed layout pass for the v2 program document.
 *
 * `computeLayout(input)` is a PURE async function: structure + viewport
 * (+ measure) → per-node rects. No React, no GPU, no DOM, no clock.
 *
 * This replaces the hand-rolled flexbox engine with Facebook's Yoga layout
 * (WASM-backed, `yoga-layout@3.x`). Yoga is the same engine powering React
 * Native and Satori.
 *
 * Semantics (unchanged contract):
 *  - `flex`: children along `dir` (row/column) with gap/padding/justify
 *    (main) / align (cross) / wrap / grow / shrink.
 *  - `block`: vertical stack; container width defaults to "fill".
 *  - `box`: styled rectangle; with children behaves as a column stack
 *    (content over the fill), without children is a leaf.
 *  - `text` / `media`: leaves — intrinsics come from the injected measure.
 *  - `position: "absolute"`: out of flow, placed at the node's x/y relative
 *    to the parent's content origin.
 *  - SizeSpec: number px | "auto" (intrinsic) | "fit" (intrinsic) |
 *    "fill" (parent extent, split by `grow`).
 */

import type { Yoga, Node as YogaNode } from "yoga-layout/load";
export type { Yoga };

import { loadYoga } from "yoga-layout/load";
import type { LayoutNode, SizeSpec } from "../../program/schema.js";

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutResult {
	/** Final rect per node id (post-layout, pre-affine-transform). */
	rects: Record<string, Rect>;
	/** Resolved outer size per node id. */
	sizes: Record<string, { width: number; height: number }>;
}

/**
 * Intrinsic ("auto"/"fit") size for a leaf node. Return null when the node
 * has no measurable content. In the compositor this is backed by text
 * measurement / media metadata — the layout pass never measures itself.
 */
export type MeasureFn = (
	node: LayoutNode,
	constraintWidth?: number,
) => { width: number; height: number } | null;

export interface LayoutInput {
	/** Document roots — the only structural input. Size comes from `viewport`. */
	layout: LayoutNode[];
	viewport: { width: number; height: number };
	measure?: MeasureFn;
}

// ── Yoga singleton ────────────────────────────────────────────────────

let yogaInstance: Yoga | null = null;

/**
 * Ensure the Yoga WASM module is loaded. Safe to call multiple times —
 * subsequent calls return the cached instance immediately.
 */
export async function initLayout(): Promise<Yoga> {
	if (yogaInstance) return yogaInstance;
	yogaInstance = await loadYoga();
	return yogaInstance;
}

// ── Yoga enum helpers ─────────────────────────────────────────────────

function mapJustify(
	yoga: Yoga,
	value?: "start" | "center" | "end" | "space-between" | "space-around",
): number {
	switch (value) {
		case "center":
			return yoga.JUSTIFY_CENTER;
		case "end":
			return yoga.JUSTIFY_FLEX_END;
		case "space-between":
			return yoga.JUSTIFY_SPACE_BETWEEN;
		case "space-around":
			return yoga.JUSTIFY_SPACE_AROUND;
		default:
			return yoga.JUSTIFY_FLEX_START;
	}
}

function mapAlign(
	yoga: Yoga,
	value?: "start" | "center" | "end" | "stretch",
): number {
	switch (value) {
		case "center":
			return yoga.ALIGN_CENTER;
		case "end":
			return yoga.ALIGN_FLEX_END;
		case "stretch":
			return yoga.ALIGN_STRETCH;
		default:
			return yoga.ALIGN_FLEX_START;
	}
}

function mapAlignSelf(
	yoga: Yoga,
	value?:
		| "auto"
		| "start"
		| "center"
		| "end"
		| "stretch"
		| "baseline"
		| undefined,
): number {
	switch (value) {
		case "start":
			return yoga.ALIGN_FLEX_START;
		case "center":
			return yoga.ALIGN_CENTER;
		case "end":
			return yoga.ALIGN_FLEX_END;
		case "stretch":
			return yoga.ALIGN_STRETCH;
		case "baseline":
			return yoga.ALIGN_BASELINE;
		default:
			return yoga.ALIGN_AUTO;
	}
}

// ── Helpers ───────────────────────────────────────────────────────────

function toYogaValue(val: unknown): number | string | undefined {
	if (val === undefined || val === null) return undefined;
	if (typeof val === "number" || typeof val === "string") return val;
	if (typeof val === "object") {
		if (
			"unit" in (val as Record<string, unknown>) &&
			typeof (val as Record<string, unknown>).unit === "number"
		) {
			return val as unknown as number | string;
		}
		const num = Number(val);
		if (!Number.isNaN(num)) return num;
	}
	return undefined;
}

/** Container main dir; leaves return null. */
function dirOf(node: LayoutNode): "row" | "column" | null {
	switch (node.kind) {
		case "flex":
			return node.dir ?? "row";
		case "block":
			return "column";
		case "box":
			return node.children && node.children.length > 0 ? "column" : null;
		default:
			return null;
	}
}

/** Container default width spec (block fills like HTML). */
function defaultWidthSpec(node: LayoutNode): SizeSpec | undefined {
	if (node.kind === "block") return "fill";
	return undefined;
}

function containerStyle(node: LayoutNode): {
	gap: number;
	padding: number;
	justify: "start" | "center" | "end" | "space-between" | "space-around";
	align: "start" | "center" | "end" | "stretch";
	wrap: boolean;
} {
	let gap = 0;
	if (node.kind === "flex" || node.kind === "block") {
		const g = toYogaValue(node.gap);
		gap = typeof g === "number" ? g : 0;
	}

	let padding = 0;
	if (
		node.kind === "flex" ||
		node.kind === "block" ||
		node.kind === "box" ||
		node.kind === "text"
	) {
		const p = toYogaValue(node.padding);
		padding = typeof p === "number" ? p : 0;
	}

	let justify: "start" | "center" | "end" | "space-between" | "space-around" =
		"start";
	if (node.kind === "flex") {
		justify = node.justify ?? "start";
	}

	let align: "start" | "center" | "end" | "stretch" = "start";
	if (node.kind === "flex" || node.kind === "block") {
		align = node.align ?? "start";
	}

	let wrap = false;
	if (node.kind === "flex") {
		wrap = typeof node.wrap === "boolean" ? node.wrap : false;
	}

	return {
		gap,
		padding,
		justify,
		align,
		wrap,
	};
}

function isAbsolutePositioned(node: LayoutNode): boolean {
	return (
		node.position === "absolute" ||
		(node.position === undefined &&
			(node.x !== undefined || node.y !== undefined))
	);
}

/** Flow children (non-absolute). */
function flowChildren(node: LayoutNode): LayoutNode[] {
	if ("children" in node && node.children) {
		return node.children.filter(
			(c: LayoutNode) => !isAbsolutePositioned(c),
		) as LayoutNode[];
	}
	return [];
}

function absoluteChildren(node: LayoutNode): LayoutNode[] {
	if ("children" in node && node.children) {
		return node.children.filter((c: LayoutNode) =>
			isAbsolutePositioned(c),
		) as LayoutNode[];
	}
	return [];
}

// ── Build Yoga tree ───────────────────────────────────────────────────

interface NodeMapping {
	yogaNode: YogaNode;
	layoutNode: LayoutNode;
	children: NodeMapping[];
}

function buildYogaNode(
	yoga: Yoga,
	node: LayoutNode,
	parentExtent: { width?: number; height?: number } | undefined,
	measure: MeasureFn | undefined,
	parentDir: "row" | "column" | null,
): NodeMapping {
	const yn = yoga.Node.create();
	const dir = dirOf(node);
	const isContainer = dir !== null;
	const children: NodeMapping[] = [];

	// ── Position ──────────────────────────────────────────────────
	const isAbsolute = isAbsolutePositioned(node);

	if (isAbsolute) {
		yn.setPositionType(yoga.POSITION_TYPE_ABSOLUTE);
		const posX = toYogaValue(node.x);
		const posY = toYogaValue(node.y);
		if (posX !== undefined) yn.setPosition(yoga.EDGE_LEFT, posX);
		if (posY !== undefined) yn.setPosition(yoga.EDGE_TOP, posY);
	} else {
		yn.setPositionType(yoga.POSITION_TYPE_RELATIVE);
		// Do not set EDGE_LEFT/EDGE_TOP offsets on the Yoga node itself;
		// we will apply relative offsets manually after the layout pass.
	}

	// ── Flex child props ─────────────────────────────────────────
	const grow = toYogaValue(node.grow);
	if (grow !== undefined) {
		yn.setFlexGrow(typeof grow === "number" ? grow : parseFloat(grow));
	}
	const flexShrink = toYogaValue(node.flexShrink);
	if (flexShrink !== undefined) {
		yn.setFlexShrink(
			typeof flexShrink === "number" ? flexShrink : parseFloat(flexShrink),
		);
	} else {
		// Yoga defaults shrink to 0, but CSS defaults to 1 for flex children.
		// For flow children (parentDir !== null), default to 1 so items shrink to fit when container is constrained.
		yn.setFlexShrink(parentDir !== null ? 1 : 0);
	}
	if (node.flexBasis !== undefined) {
		yn.setFlexBasis(node.flexBasis);
	}
	if (node.alignSelf !== undefined) {
		yn.setAlignSelf(mapAlignSelf(yoga, node.alignSelf));
	}

	// ── Size ─────────────────────────────────────────────────────
	const wSpec = node.width ?? defaultWidthSpec(node);
	const hSpec = node.height;

	const isWidthMain = parentDir === "row";
	const isHeightMain = parentDir === "column";

	applySizeSpec(yn, "width", wSpec, parentExtent?.width, isWidthMain);
	applySizeSpec(yn, "height", hSpec, parentExtent?.height, isHeightMain);

	// ── Container layout ─────────────────────────────────────────
	if (isContainer) {
		const cs = containerStyle(node);

		yn.setFlexDirection(
			dir === "row" ? yoga.FLEX_DIRECTION_ROW : yoga.FLEX_DIRECTION_COLUMN,
		);
		yn.setJustifyContent(mapJustify(yoga, cs.justify));
		yn.setAlignItems(mapAlign(yoga, cs.align));
		yn.setFlexWrap(cs.wrap ? yoga.WRAP_WRAP : yoga.WRAP_NO_WRAP);

		if (cs.padding > 0) yn.setPadding(yoga.EDGE_ALL, cs.padding);
		if (cs.gap > 0) yn.setGap(yoga.GUTTER_ALL, cs.gap);

		// Build child Yoga nodes
		const flow = flowChildren(node);
		const abs = absoluteChildren(node);
		const allChildren = [...flow, ...abs];

		for (let i = 0; i < allChildren.length; i++) {
			const childMapping = buildYogaNode(
				yoga,
				allChildren[i],
				undefined,
				measure,
				isAbsolutePositioned(node) ? null : dir,
			);
			yn.insertChild(childMapping.yogaNode, i);
			children.push(childMapping);
		}
	} else if (
		node.kind === "text" ||
		(node.kind === "media" && (node as any).dataType === "Caption")
	) {
		// Leaf: text node uses dynamic setMeasureFunc for intrinsic sizing
		yn.setMeasureFunc((width, widthMode, height, heightMode) => {
			let constraintWidth: number | undefined;
			// 1 = Exactly, 2 = AtMost. We only wrap when width is constrained.
			if (widthMode === 1 || widthMode === 2) {
				constraintWidth = width;
			}
			const measured = measure?.(node, constraintWidth) ?? {
				width: 0,
				height: 0,
			};
			let resolvedWidth = measured.width;
			let resolvedHeight = measured.height;
			if (widthMode === 1) resolvedWidth = width;
			if (heightMode === 1) resolvedHeight = height;
			return { width: resolvedWidth, height: resolvedHeight };
		});
	} else {
		// Leaf: use measure function for intrinsic sizing (media, etc.)
		const measured = measure?.(node) ?? null;
		if (measured) {
			const hasRatio = node.aspectRatio !== undefined;
			const isCaption = (node as any).dataType === "Caption";
			const intrinsicRatio =
				measured.height > 0 ? measured.width / measured.height : 1;

			if (node.kind === "media" && !isCaption && !hasRatio) {
				yn.setAspectRatio(intrinsicRatio);
			}

			const isWAuto =
				wSpec === undefined || wSpec === "auto" || wSpec === "fit";
			const isHAuto =
				hSpec === undefined || hSpec === "auto" || hSpec === "fit";

			if (isWAuto && isHAuto) {
				// Both are auto: use dynamic measure function so Yoga can size media
				// proportionally to container constraints (cross-axis stretch, flex-shrink, max bounds)
				const ar =
					node.aspectRatio ??
					(node.kind === "media" ? intrinsicRatio : undefined) ??
					1;

				yn.setMeasureFunc((width, widthMode, height, heightMode) => {
					let resW = measured.width;
					let resH = measured.height;

					if (widthMode === 1 && heightMode === 1) {
						resW = width;
						resH = height;
					} else if (widthMode === 1) {
						resW = width;
						resH = ar > 0 ? Math.round(width / ar) : measured.height;
					} else if (heightMode === 1) {
						resH = height;
						resW = ar > 0 ? Math.round(height * ar) : measured.width;
					} else if (widthMode === 2 && heightMode === 2) {
						const scale = Math.min(
							1,
							width / measured.width,
							height / measured.height,
						);
						resW = Math.round(measured.width * scale);
						resH = Math.round(measured.height * scale);
					} else if (widthMode === 2) {
						if (measured.width > width) {
							resW = width;
							resH = ar > 0 ? Math.round(width / ar) : measured.height;
						}
					} else if (heightMode === 2) {
						if (measured.height > height) {
							resH = height;
							resW = ar > 0 ? Math.round(height * ar) : measured.width;
						}
					}

					return { width: resW, height: resH };
				});
			} else if (isWAuto) {
				// Width is auto, Height is fixed/fill: let Yoga resolve width via aspect ratio if available,
				// otherwise fallback to measured width.
				const ar =
					node.aspectRatio ??
					(node.kind === "media" ? intrinsicRatio : undefined);
				if (ar === undefined || ar <= 0) {
					yn.setWidth(measured.width);
				}
			} else if (isHAuto) {
				// Height is auto, Width is fixed/fill: let Yoga resolve height via aspect ratio if available,
				// otherwise fallback to measured height.
				const ar =
					node.aspectRatio ??
					(node.kind === "media" ? intrinsicRatio : undefined);
				if (ar === undefined || ar <= 0) {
					yn.setHeight(measured.height);
				}
			}
		}
	}

	return { yogaNode: yn, layoutNode: node, children };
}

function applySizeSpec(
	yn: YogaNode,
	dim: "width" | "height",
	spec: SizeSpec | undefined,
	parentExtent: number | undefined,
	isFlexChild: boolean,
): void {
	if (spec === undefined || spec === "auto" || spec === "fit") {
		// Yoga defaults to auto — leave undefined to trigger measure or
		// content-based sizing.
		return;
	}
	const resolvedSpec = toYogaValue(spec);
	if (typeof resolvedSpec === "number") {
		if (dim === "width") yn.setWidth(resolvedSpec);
		else yn.setHeight(resolvedSpec);
		return;
	}
	if (resolvedSpec === "fill") {
		// "fill" on a flex child along the main axis = flex-grow (take
		// leftover space), matching the old engine. On root or cross axis
		// it means "stretch to 100%".
		if (isFlexChild) {
			// Set flex-grow if not already explicitly set via the `grow` prop.
			// flexBasis=0 ensures the item starts from zero and grows into
			// the leftover, so two "fill" children split 50/50 by default.
			if (yn.getFlexGrow() === 0) {
				yn.setFlexGrow(1);
			}
			yn.setFlexBasis(0);
			return;
		}
		if (parentExtent !== undefined) {
			if (dim === "width") yn.setWidth(parentExtent);
			else yn.setHeight(parentExtent);
		} else {
			if (dim === "width") yn.setWidthPercent(100);
			else yn.setHeightPercent(100);
		}
	}
}

// ── Read results ──────────────────────────────────────────────────────

function readLayout(
	mapping: NodeMapping,
	parentX: number,
	parentY: number,
	rects: Record<string, Rect>,
	sizes: Record<string, { width: number; height: number }>,
): void {
	const layout = mapping.yogaNode.getComputedLayout();
	let x = parentX + layout.left;
	let y = parentY + layout.top;
	const width = layout.width;
	const height = layout.height;

	const node = mapping.layoutNode;
	if (!isAbsolutePositioned(node)) {
		x += Number(node.x ?? 0);
		y += Number(node.y ?? 0);
	}

	rects[mapping.layoutNode.id] = {
		x: Math.round(x * 1000) / 1000,
		y: Math.round(y * 1000) / 1000,
		width: Math.round(width * 1000) / 1000,
		height: Math.round(height * 1000) / 1000,
	};
	sizes[mapping.layoutNode.id] = {
		width: Math.round(width * 1000) / 1000,
		height: Math.round(height * 1000) / 1000,
	};

	for (const child of mapping.children) {
		readLayout(child, x, y, rects, sizes);
	}
}

function freeYogaTree(mapping: NodeMapping): void {
	for (const child of mapping.children) {
		freeYogaTree(child);
	}
	mapping.yogaNode.free();
}

// ── Public API ────────────────────────────────────────────────────────

/** Deterministic layout (synchronous): document + viewport (+ measure) → rects. */
export function computeLayoutSync(
	yoga: Yoga,
	input: LayoutInput,
): LayoutResult {
	const { layout, viewport, measure } = input;

	const rects: Record<string, Rect> = {};
	const sizesMap: Record<string, { width: number; height: number }> = {};

	for (const root of layout) {
		// Create a wrapper root node at the viewport dimensions so that
		// "fill" on root nodes resolves to the viewport size.
		const wrapperNode = yoga.Node.create();
		wrapperNode.setWidth(viewport.width);
		wrapperNode.setHeight(viewport.height);
		wrapperNode.setFlexDirection(yoga.FLEX_DIRECTION_COLUMN);

		const mapping = buildYogaNode(
			yoga,
			root,
			{ width: viewport.width, height: viewport.height },
			measure,
			null,
		);
		wrapperNode.insertChild(mapping.yogaNode, 0);

		wrapperNode.calculateLayout(viewport.width, viewport.height);

		const rootLayout = mapping.yogaNode.getComputedLayout();
		const isRootAbsolute =
			root.position === "absolute" ||
			(root.position === undefined &&
				(root.x !== undefined || root.y !== undefined));
		const rootX = isRootAbsolute ? rootLayout.left : Number(root.x ?? 0);
		const rootY = isRootAbsolute ? rootLayout.top : Number(root.y ?? 0);

		rects[root.id] = {
			x: Math.round(rootX * 1000) / 1000,
			y: Math.round(rootY * 1000) / 1000,
			width: Math.round(rootLayout.width * 1000) / 1000,
			height: Math.round(rootLayout.height * 1000) / 1000,
		};
		sizesMap[root.id] = {
			width: Math.round(rootLayout.width * 1000) / 1000,
			height: Math.round(rootLayout.height * 1000) / 1000,
		};

		for (const child of mapping.children) {
			readLayout(child, rootX, rootY, rects, sizesMap);
		}

		// Clean up Yoga nodes
		freeYogaTree(mapping);
		wrapperNode.free();
	}

	return { rects, sizes: sizesMap };
}

/** Deterministic layout: document + viewport (+ measure) → rects. */
export async function computeLayout(input: LayoutInput): Promise<LayoutResult> {
	const yoga = await initLayout();
	return computeLayoutSync(yoga, input);
}
