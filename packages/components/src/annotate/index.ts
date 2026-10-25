/**
 * Annotate: marks that draw on to point at something. Underline a phrase,
 * circle a number, strike a claim, box a region, draw an arrow; clean
 * geometry or hand-drawn, with a boil that keeps hand-drawn marks alive.
 *
 * Coordinates are the parent's: the root sits at 0, 0, so targets resolve
 * where they are drawn. Text targets give one mark per line.
 */
import {
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { defineComponent } from "../core/contract.js";
import {
	type ArrowCurve,
	arrowPaths,
	boilKeys,
	boxPath,
	ellipsePath,
	linePath,
	type Rect,
	squigglePath,
	wobblePoints,
} from "../core/draw.js";
import type { Animatable } from "../core/host.js";
import { toPathData, type Vec2 } from "../core/path.js";
import { targetSchema } from "../core/schemas.js";
import {
	anchorPoint,
	boundsOf,
	resolveTarget,
	type Target,
} from "../core/targets.js";
import { themeFrames } from "../core/theme.js";
import { scaleFrames } from "../core/timing.js";

export const MARKS = [
	"underline",
	"circle",
	"box",
	"highlight",
	"strike",
	"cross",
	"bracket",
	"arrow",
	"squiggle",
] as const;
export type Mark = (typeof MARKS)[number];

const TEXTURE = {
	/** Even, confident line. */
	ink: { width: 1, opacity: 1 },
	/** Broad felt tip. */
	marker: { width: 1.5, opacity: 0.94 },
	/** Thin and light. */
	pencil: { width: 0.55, opacity: 0.85 },
} as const;

export interface AnnotateCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** The mark is fully drawn. */
	drawn: ReadonlyArray<{ frame: number }>;
	/** The label starts to appear (empty without a label). */
	labelIn: ReadonlyArray<{ frame: number }>;
}

/** One stroke of a mark: its path for a boil variant, and a length for pacing. */
interface Stroke {
	path(variant: number): string;
	length: number;
	kind: "line" | "fill" | "head";
}

export const annotate = /* @__PURE__ */ defineComponent({
	name: "Annotate",
	props: () => ({
		/** What to mark. Rects (e.g. `TextReveal.rects("word")`) give one mark per rect for line marks. */
		target: z.union([
			z.array(
				z.object({
					x: z.number(),
					y: z.number(),
					width: z.number(),
					height: z.number(),
				}),
			),
			targetSchema(),
		]),
		mark: z.enum(MARKS).default("underline"),
		/** Where an arrow starts (it points at `target`). */
		from: targetSchema().optional(),
		curve: z.enum(["straight", "arc", "swoop"]).default("arc"),
		color: z.string().optional(),
		/** Stroke width before the texture's factor. Default the theme's bold stroke. */
		width: z.number().positive().optional(),
		/** `wobble` 0–1 (how loose the hand is); `boil`: frames between re-poses, 0 = still. */
		hand: z
			.union([
				z.literal(false),
				z
					.object({
						wobble: z.number().min(0).max(1).default(0.6),
						boil: z.number().int().min(0).default(4),
						seed: z.number().int().optional(),
					})
					.strict(),
			])
			.default({ wobble: 0.6, boil: 4 }),
		texture: z.enum(["ink", "marker", "pencil"]).default("marker"),
		/** Frames the mark takes to draw. Default the theme's base speed (× 1.5 for arrows). */
		drawDuration: z.number().int().positive().optional(),
		label: z
			.union([
				z.string(),
				z
					.object({
						text: z.string(),
						side: z
							.enum(["auto", "top", "bottom", "left", "right"])
							.default("auto"),
						font: z.string().optional(),
						size: z.number().positive().optional(),
					})
					.strict(),
			])
			.optional(),
		/** Space between the target and the mark. */
		padding: z.number().min(0).default(8),
	}),
	defaults: { enter: false, exit: false, hold: 45 },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const pad = props.padding * s;
		const hand = props.hand === false ? null : props.hand;
		const wobble = (hand?.wobble ?? 0) * 5 * s;
		const seed = hand?.seed ?? ctx.seed;
		const texture = TEXTURE[props.texture];
		const strokeW = (props.width ?? theme.stroke.bold * s) * texture.width;
		const color = props.color ?? theme.color.highlight;

		// ── Geometry ─────────────────────────────────────────────────────
		const resolve = (t: Target) => {
			const r = resolveTarget(t, { measure: host.measure, fps });
			if (r.kind !== "static")
				throw new Error(
					"Annotate: targets must be static (points, rects, nodes, text). Moving targets arrive with Callout.",
				);
			return r;
		};
		const isRects =
			Array.isArray(props.target) && typeof props.target[0] === "object";
		const resolved = isRects ? null : resolve(props.target as Target);
		const rects: Rect[] = isRects
			? (props.target as Rect[])
			: (resolved?.rects ?? []);
		if (rects.length === 0)
			throw new Error("Annotate: the target covers nothing.");
		const isText =
			isRects ||
			(typeof props.target === "object" &&
				props.target !== null &&
				"text" in (props.target as object));
		const b = boundsOf(rects);
		const hw = { wobble, seed };

		const strokes: Stroke[] = [];
		/** Points outside the target the strokes reach (an arrow's tail). */
		const reach: Vec2[] = [];
		const lineAt = (y: (r: Rect) => number, extend: number) =>
			rects.forEach((r) => {
				const from: Vec2 = [r.x - extend, y(r)];
				const to: Vec2 = [r.x + r.width + extend, y(r)];
				strokes.push({
					path: (v) => linePath(from, to, hw, v + strokes.length * 7),
					length: to[0] - from[0],
					kind: "line",
				});
			});
		// Text rects are a line tall: the baseline sits near 80 % of it.
		const under = (r: Rect) =>
			isText ? r.y + r.height * 0.84 + pad * 0.4 : r.y + r.height + pad;

		switch (props.mark) {
			case "underline":
				lineAt(under, pad * 0.25);
				break;
			case "strike":
				lineAt((r) => r.y + r.height * (isText ? 0.54 : 0.5), pad * 0.4);
				break;
			case "squiggle":
				rects.forEach((r, i) => {
					const from: Vec2 = [r.x, under(r)];
					const to: Vec2 = [r.x + r.width, under(r)];
					strokes.push({
						path: (v) =>
							squigglePath(
								from,
								to,
								{ ...hw, amplitude: 4 * s + strokeW * 0.4 },
								v + i * 7,
							),
						length: r.width * 1.3,
						kind: "line",
					});
				});
				break;
			case "highlight":
				rects.forEach((r, i) => {
					const y = r.y + r.height * (isText ? 0.56 : 0.5);
					const from: Vec2 = [r.x - pad * 0.4, y];
					const to: Vec2 = [r.x + r.width + pad * 0.4, y];
					strokes.push({
						path: (v) =>
							linePath(from, to, { ...hw, wobble: wobble * 0.5 }, v + i * 7),
						length: to[0] - from[0],
						kind: "fill",
					});
				});
				break;
			case "circle":
				strokes.push({
					path: (v) => ellipsePath(b, { ...hw, padding: pad * 1.5 }, v),
					length: Math.PI * (b.width + b.height + pad * 3),
					kind: "line",
				});
				break;
			case "box":
				strokes.push({
					path: (v) => boxPath(b, { ...hw, padding: pad }, v),
					length: 2 * (b.width + b.height + pad * 4),
					kind: "line",
				});
				break;
			case "cross": {
				const x0 = b.x - pad;
				const y0 = b.y - pad;
				const x1 = b.x + b.width + pad;
				const y1 = b.y + b.height + pad;
				const d = Math.hypot(x1 - x0, y1 - y0);
				strokes.push(
					{
						path: (v) => linePath([x0, y0], [x1, y1], hw, v),
						length: d,
						kind: "line",
					},
					{
						path: (v) => linePath([x1, y0], [x0, y1], hw, v + 11),
						length: d,
						kind: "line",
					},
				);
				break;
			}
			case "bracket": {
				const x = b.x - pad * 1.5;
				const lip = Math.min(18 * s, b.height * 0.2);
				const pts: Vec2[] = [
					[x + lip, b.y - pad * 0.5],
					[x, b.y - pad * 0.5],
					[x, b.y + b.height + pad * 0.5],
					[x + lip, b.y + b.height + pad * 0.5],
				];
				strokes.push({
					path: (v) => toPathData(wobblePoints(densify(pts, 6), hw, v)),
					length: b.height + lip * 2 + pad,
					kind: "line",
				});
				break;
			}
			case "arrow": {
				if (!props.from)
					throw new Error('Annotate: mark "arrow" needs `from`.');
				const start = resolve(props.from);
				const tail = anchorPoint(boundsOf(start.rects), start.anchor);
				const tip = edgeToward(b, tail, pad);
				reach.push(tail);
				const headSize =
					(14 * s + strokeW * 1.6) * (props.texture === "pencil" ? 0.8 : 1);
				const geometry = (v: number) =>
					arrowPaths(
						tail,
						tip,
						{ ...hw, curve: props.curve as ArrowCurve, headSize },
						v,
					);
				const length = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
				strokes.push(
					{ path: (v) => geometry(v).shaft, length, kind: "line" },
					{ path: (v) => geometry(v).head, length: headSize * 2, kind: "head" },
				);
				break;
			}
		}

		// ── Timing ───────────────────────────────────────────────────────
		const drawFrames =
			props.drawDuration ??
			Math.round(
				themeFrames(theme, "base", fps) * (props.mark === "arrow" ? 1.5 : 1.2),
			);
		const bodies = strokes.filter((st) => st.kind !== "head");
		const total = bodies.reduce((a, st) => a + Math.max(1, st.length), 0);
		let cursor = 0;
		const windows: Array<{ start: number; end: number }> = [];
		for (const st of strokes) {
			const prev = windows[windows.length - 1];
			if (st.kind === "head" && prev) {
				// The head flicks on as the shaft reaches 92 %.
				const start = Math.round(prev.start + (prev.end - prev.start) * 0.92);
				windows.push({ start, end: start + Math.max(3, scaleFrames(5, fps)) });
				continue;
			}
			const start = Math.round(cursor);
			cursor += (drawFrames * Math.max(1, st.length)) / total;
			windows.push({ start, end: Math.max(start + 2, Math.round(cursor)) });
		}
		const drawn = Math.max(...windows.map((w) => w.end));

		// ── Nodes ────────────────────────────────────────────────────────
		const lightBg = theme.mode === "light";
		// The shapes' box must hold every stroke, or the renderer clips it.
		const margin = pad * 4 + strokeW * 4;
		const extentX = Math.max(b.x + b.width, ...reach.map((p) => p[0])) + margin;
		const extentY =
			Math.max(b.y + b.height, ...reach.map((p) => p[1])) + margin;
		const boil =
			hand && hand.boil > 0 && wobble > 0 ? scaleFrames(hand.boil, fps) : 0;
		// Marks stay up: boil through the window, or a while past the hold.
		const boilEnd =
			(props as { duration?: number }).duration ??
			drawn + Math.max(ctx.hold, fps * 6);
		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		let maxX = extentX;
		let maxY = extentY;

		strokes.forEach((st, i) => {
			const w = windows[i] as { start: number; end: number };
			const fill = st.kind === "fill";
			const rect = rects[i] ?? b;
			const node = host.shape("path", {
				id: ctx.partId(st.kind === "head" ? "head" : `stroke-${i}`),
				position: "absolute",
				x: 0,
				y: 0,
				width: extentX,
				height: extentY,
				d: st.path(0),
				fillType: "none",
				strokeColor: color,
				strokeWidth: fill ? rect.height * (isText ? 0.62 : 1) : strokeW,
				strokeLineCap: fill ? "butt" : "round",
				strokeLineJoin: "round",
				trimEnd: 0,
				opacity: fill ? (lightBg ? 0.9 : 0.38) : texture.opacity,
				...(fill && lightBg && { blendMode: "multiply" }),
			});
			const anim = LayerAnimation.create().keys("trimEnd", [
				[w.start, 0],
				[w.end, 1, st.kind === "head" ? "power2.out" : "power2.inOut"],
			]);
			if (boil > 0)
				anim.keys(
					"d",
					boilKeys(st.path, { start: 0, end: boilEnd, every: boil }),
				);
			node.animate(anim);
			parts[st.kind === "head" ? "head" : `stroke-${i}`] = node;
			children.push(node);
		});

		// ── Label ────────────────────────────────────────────────────────
		let labelIn: number | null = null;
		if (props.label !== undefined) {
			const o =
				typeof props.label === "string"
					? { text: props.label, side: "auto" as const }
					: props.label;
			const font =
				("font" in o && o.font) || theme.font.hand || theme.font.body;
			const size = ("size" in o && o.size) || 34 * s;
			const m = host.measure(o.text, { fontFamily: font, fontSize: size });
			const gap = 10 * s + pad;
			let x: number;
			let y: number;
			if (props.mark === "arrow" && props.from) {
				const start = resolve(props.from);
				const tail = anchorPoint(boundsOf(start.rects), start.anchor);
				const tip = edgeToward(b, tail, pad);
				const len = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]) || 1;
				const dx = (tip[0] - tail[0]) / len;
				const dy = (tip[1] - tail[1]) / len;
				const reach =
					Math.abs(dx) * (m.width / 2) +
					Math.abs(dy) * (m.height / 2) +
					gap * 0.5;
				x = tail[0] - dx * reach - m.width / 2;
				y = tail[1] - dy * reach - m.height / 2;
			} else {
				const side =
					o.side === "auto"
						? b.y - gap - m.height >= 0
							? "top"
							: "bottom"
						: o.side;
				const top = props.mark === "circle" ? pad * 1.5 : pad;
				x =
					side === "left"
						? b.x - top - gap - m.width
						: side === "right"
							? b.x + b.width + top + gap
							: b.x + b.width - m.width;
				y =
					side === "top"
						? b.y - top - gap - m.height
						: side === "bottom"
							? b.y + b.height + top + gap
							: b.y + (b.height - m.height) / 2;
			}
			const label = host.text(o.text, {
				id: ctx.partId("label"),
				position: "absolute",
				x,
				y,
				fontFamily: font,
				fontSize: size,
				fill: props.mark === "highlight" ? theme.color.ink : color,
			});
			labelIn = Math.max(0, drawn - scaleFrames(4, fps));
			const intro = scaleFrames(10, fps);
			label.animate(
				LayerAnimation.create()
					.keys("opacity", [
						[labelIn, 0],
						[labelIn + intro, 1, "power2.out"],
					])
					.keys("y", [
						[labelIn, y + 8 * s],
						[labelIn + intro, y, theme.motion.ease.enter],
					]),
			);
			parts.label = label;
			children.push(label);
			maxX = Math.max(maxX, x + m.width + 8);
			maxY = Math.max(maxY, y + m.height + 8);
		}

		return {
			children,
			width: maxX,
			height: maxY,
			duration: Math.max(
				drawn,
				labelIn === null ? 0 : labelIn + scaleFrames(10, fps),
			),
			openEnded: true,
			origin: [0, 0],
			cues: {
				drawn: [{ frame: drawn }],
				labelIn: labelIn === null ? [] : [{ frame: labelIn }],
			} as AnnotateCues,
			parts,
		};
	},
});

/** Where a mark around `rect` (+ gap) meets the line toward `from`. */
function edgeToward(rect: Rect, from: Vec2, gap: number): Vec2 {
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	const dx = from[0] - cx;
	const dy = from[1] - cy;
	const hx = rect.width / 2 + gap;
	const hy = rect.height / 2 + gap;
	const t = Math.min(
		dx === 0 ? Number.POSITIVE_INFINITY : hx / Math.abs(dx),
		dy === 0 ? Number.POSITIVE_INFINITY : hy / Math.abs(dy),
	);
	return Number.isFinite(t) ? [cx + dx * t, cy + dy * t] : [cx, cy - hy];
}

/** Extra points along each segment, so a wobble bends lines instead of corners only. */
function densify(points: readonly Vec2[], per: number): Vec2[] {
	const out: Vec2[] = [];
	points.forEach((p, i) => {
		const next = points[i + 1];
		if (!next) {
			out.push(p);
			return;
		}
		for (let k = 0; k < per; k++) {
			const t = k / per;
			out.push([p[0] + (next[0] - p[0]) * t, p[1] + (next[1] - p[1]) * t]);
		}
	});
	return out;
}
