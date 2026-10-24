/**
 * MousePointer: an animated pointer that travels between targets, clicks,
 * drags and changes shape, with exact cues for everything it does.
 *
 * Coordinates are the parent's: the pointer's root covers `area` from 0, 0,
 * so targets resolve where they are drawn.
 */
import {
	type AnimatableProp,
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bakeSamples } from "../core/bake.js";
import { defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import { transformPathData, type Vec2 } from "../core/path.js";
import { targetSchema } from "../core/schemas.js";
import { resolveTarget, type Target, targetPoint } from "../core/targets.js";
import { contrastRatio } from "../core/theme.js";
import {
	CURSOR_STYLES,
	type CursorStyle,
	type Glyph,
	glyphFor,
} from "./glyphs.js";
import {
	type PlannedWaypoint,
	type PointAt,
	type PointerPlan,
	planPointer,
} from "./plan.js";

export { CURSOR_STYLES, type CursorStyle } from "./glyphs.js";

const EDGES = ["left", "right", "top", "bottom"] as const;
type Edge = (typeof EDGES)[number];

/** A waypoint's schema (built on first use). */
function waypointSchema() {
	const frames = z.number().int().min(0);
	return z
		.object({
			/** Where to go. */
			to: targetSchema(),
			/** Arrival frame (component-local). Default: from distance and `speed`. */
			at: frames.optional(),
			/** Frames to rest after arriving (and clicking). */
			dwell: frames.optional(),
			/** Click on arrival: `true`, a count (2 = double click), or details. */
			click: z
				.union([
					z.boolean(),
					z.number().int().min(1).max(3),
					z.object({
						count: z.number().int().min(1).max(3).default(1),
						hold: frames.optional(),
					}),
				])
				.optional(),
			/** Press here and drag to this target. */
			drag: targetSchema().optional(),
			/** Switch cursor style on arrival, for good. */
			cursor: z.enum(CURSOR_STYLES).optional(),
		})
		.strict();
}

export type Waypoint = z.input<ReturnType<typeof waypointSchema>>;

export interface MousePointerCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	arrivals: ReadonlyArray<{ frame: number; point: Vec2; index: number }>;
	presses: ReadonlyArray<{ frame: number; point: Vec2 }>;
	releases: ReadonlyArray<{ frame: number; point: Vec2 }>;
	clicks: ReadonlyArray<{
		frame: number;
		point: Vec2;
		index: number;
		target?: string;
	}>;
	drags: ReadonlyArray<{ frame: number; end: number; from: Vec2; to: Vec2 }>;
}

export interface MousePointerApi {
	/** Pointer hotspot in the parent's coordinates at a parent-timeline frame. */
	positionAt(frame: number): Vec2;
	/** Cursor style showing at a parent-timeline frame. */
	styleAt(frame: number): CursorStyle;
}

export const mousePointer = /* @__PURE__ */ defineComponent({
	name: "MousePointer",
	props: () => ({
		/** The performance: where to go, and what to do there. */
		path: z.array(waypointSchema()).min(1),
		style: z.enum(CURSOR_STYLES).default("arrow"),
		/** Glyph size in px (the 24-unit design grid). Default 44 × theme.scale. */
		size: z.number().positive().optional(),
		/** Glyph fill. Default near-black, outlined in white: reads on anything. */
		color: z.string().default("#101114"),
		/** Secondary color (target dots, sparkles, ripples). Default theme accent. */
		accent: z.string().optional(),
		outline: z.union([z.string(), z.literal(false)]).default("#ffffff"),
		/** Outline width in px. Default size / 16. */
		outlineWidth: z.number().min(0).optional(),
		/** `union` outlines the whole silhouette (no seams between parts); `each` outlines parts separately. */
		outlineMode: z.enum(["union", "each"]).default("union"),
		motion: z.enum(["natural", "swift", "lazy", "linear"]).default("natural"),
		/** Travel-time multiplier: 2 = twice as fast. */
		speed: z.number().positive().default(1),
		/** Idle drift in px while resting (0 = perfectly still). */
		drift: z.number().min(0).default(1.5),
		/** Rotate directional glyphs (triangle, chevron) along travel. */
		autoOrient: z.boolean().default(false),
		/** Fading dots behind the pointer while it moves. */
		trail: z
			.union([
				z.literal(false),
				z.object({
					length: z.number().int().min(1).max(16).default(6),
					spacing: z.number().int().min(1).default(1),
					color: z.string().optional(),
				}),
			])
			.default(false),
		/** How the glyph reacts to a press. */
		feedback: z
			.enum(["press", "bounce", "pulse"])
			.or(z.literal(false))
			.default("press"),
		/** The mark a click leaves where it lands. */
		ripple: z
			.enum(["ring", "fill", "pulse"])
			.or(z.literal(false))
			.default("ring"),
		/** Style swaps while the hotspot is inside a region. */
		hoverRegions: z
			.array(
				z
					.object({ target: targetSchema(), style: z.enum(CURSOR_STYLES) })
					.strict(),
			)
			.default([]),
		/** A name tag that rides beside the pointer (agents, collaborators). */
		label: z
			.union([
				z.string(),
				z.object({ text: z.string(), color: z.string().optional() }).strict(),
			])
			.optional(),
		/** Velocity motion blur on travel. `true` = a 45° shutter (a hint of blur that keeps the glyph crisp), or an angle. */
		motionBlur: z
			.union([z.boolean(), z.number().min(0).max(360)])
			.default(true),
		/** Soft drop shadow under the glyph. */
		shadow: z.boolean().default(true),
		/** Enter from off-frame on this edge (or from a point) instead of appearing in place. */
		from: z.union([z.enum(EDGES), targetSchema()]).optional(),
		/** Leave to off-frame on this edge (or to a point) instead of fading away. */
		to: z.union([z.enum(EDGES), targetSchema()]).optional(),
		/** The frame the pointer lives in (for edges). Default 1920 × 1080. */
		area: z
			.object({ width: z.number().positive(), height: z.number().positive() })
			.default({ width: 1920, height: 1080 }),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const size = props.size ?? 44 * theme.scale;
		const k = size / 24;
		const accent = props.accent ?? theme.color.accent;
		const outlineWidth = props.outlineWidth ?? size / 16;
		const { width: W, height: H } = props.area;

		const resolvePoint = (target: Target): { point: PointAt; id?: string } => {
			const resolved = resolveTarget(target, { measure: host.measure, fps });
			const isText =
				typeof target === "object" &&
				!Array.isArray(target) &&
				"text" in target;
			const node =
				typeof target === "object" && !Array.isArray(target) && "node" in target
					? target.node
					: undefined;
			const id = typeof node?.id === "string" ? node.id : undefined;
			if (resolved.kind === "static") {
				const p = targetPoint(resolved, 0, isText);
				return { point: () => p, id };
			}
			return { point: (frame) => targetPoint(resolved, frame, isText), id };
		};
		const edgePoint = (edge: Edge, near: Vec2): Vec2 => {
			const off = size * 1.5;
			if (edge === "left") return [-off, near[1]];
			if (edge === "right") return [W + off, near[1]];
			if (edge === "top") return [near[0], -off];
			return [near[0], H + off];
		};

		const waypoints: PlannedWaypoint[] = props.path.map((wp) => {
			const { point, id } = resolvePoint(wp.to);
			const click =
				wp.click === undefined || wp.click === false
					? undefined
					: wp.click === true
						? { count: 1 }
						: typeof wp.click === "number"
							? { count: wp.click }
							: wp.click;
			return {
				point,
				at: wp.at,
				dwell: wp.dwell,
				clicks: click?.count,
				hold: click && "hold" in click ? click.hold : undefined,
				drag: wp.drag ? resolvePoint(wp.drag).point : undefined,
				cursor: wp.cursor,
				targetId: id,
			};
		});
		const firstPoint = waypoints[0]?.point(0) ?? [0, 0];
		const lastPoint = waypoints[waypoints.length - 1]?.point(0) ?? firstPoint;
		const fromPoint =
			props.from === undefined
				? undefined
				: typeof props.from === "string"
					? edgePoint(props.from, firstPoint)
					: resolvePoint(props.from).point(0);
		const toPoint =
			props.to === undefined
				? undefined
				: typeof props.to === "string"
					? edgePoint(props.to, lastPoint)
					: resolvePoint(props.to).point(0);

		const fade = Math.max(1, Math.round((7 * fps) / 30));
		const plan = planPointer({
			waypoints,
			fps,
			style: props.style,
			motion: props.motion,
			speed: props.speed,
			drift: props.drift,
			seed: ctx.seed,
			from: fromPoint,
			to: toPoint,
			hoverRegions: props.hoverRegions.map((r) => {
				const resolved = resolveTarget(r.target, {
					measure: host.measure,
					fps,
				});
				if (resolved.kind !== "static")
					throw new Error(
						"MousePointer: hover regions must be static targets.",
					);
				const rects = resolved.rects;
				const x0 = Math.min(...rects.map((q) => q.x));
				const y0 = Math.min(...rects.map((q) => q.y));
				const x1 = Math.max(...rects.map((q) => q.x + q.width));
				const y1 = Math.max(...rects.map((q) => q.y + q.height));
				return {
					rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
					style: r.style,
				};
			}),
			appear: fromPoint ? 0 : fade,
			vanish: toPoint ? 0 : fade,
		});

		// Visibility: pop in at the start, fade out at the end (unless it
		// travels on or off frame, which needs no fade).
		const visibility = (f: number): number => {
			const inAt = fromPoint ? 1 : smooth(f / fade);
			const outAt = toPoint ? 1 : 1 - smooth((f - plan.vanishAt) / fade);
			return Math.max(0, Math.min(inAt, outAt));
		};
		const appearScale = (f: number): number => {
			if (fromPoint) return 1;
			const t = f / fade;
			return t >= 1 ? 1 : 0.6 + 0.4 * backOut(Math.max(0, t));
		};
		const pressScale = pressProfile(plan, props.feedback);

		// ── Glyph boxes, one per style used ──────────────────────────────
		const used = [
			...new Set([props.style, ...plan.styles.map((w) => w.style)]),
		];
		const margin = Math.ceil(size * 0.4);
		const box = size + margin * 2;

		// Label geometry first: it sizes the moving box.
		const labelText =
			props.label === undefined
				? undefined
				: typeof props.label === "string"
					? props.label
					: props.label.text;
		const labelFont = Math.round(size * 0.4);
		const labelMetrics =
			labelText === undefined
				? undefined
				: host.measure(labelText, {
						fontFamily: theme.font.body,
						fontSize: labelFont,
						fontWeight: 600,
					});
		const labelPadX = Math.round(labelFont * 0.62);
		const labelH = Math.round(labelFont * 1.8);
		const labelW = labelMetrics
			? Math.ceil(labelMetrics.width + labelPadX * 2)
			: 0;
		const labelX = Math.round(size * 0.46);
		const labelY = Math.round(size * 0.6);

		// The moving part is a real box centred on the hotspot (very small
		// boxes are culled), big enough for the glyph, its shadow and label.
		const half = Math.ceil(
			Math.max(
				box,
				labelMetrics ? Math.max(labelX + labelW, labelY + labelH) + 24 : 0,
			),
		);
		const extent = half * 2;
		const swap = Math.max(1, Math.round((2 * fps) / 30));
		const glyphBoxes: Array<Animatable<LayoutNode>> = [];
		const parts: Record<string, Animatable<LayoutNode>> = {};

		for (const style of used) {
			const glyph = glyphFor(style);
			const [hx, hy] = glyph.hotspot;
			const weight = (f: number) => styleWeight(plan, style, f, swap);
			const opacity = samples(plan.length, (f) => visibility(f) * weight(f));
			const scale = samples(
				plan.length,
				(f) => appearScale(f) * pressScale(f) * (0.9 + 0.1 * weight(f)),
			);
			const shapes = glyphShapes(ctx, glyph, style, {
				k,
				margin,
				color: props.color,
				accent,
				outline: props.outline === false ? null : props.outline,
				outlineWidth,
				mode: props.outlineMode,
			});
			const g = host.box({
				id: ctx.partId(`glyph-${style}`),
				position: "absolute",
				x: half - hx * k - margin,
				y: half - hy * k - margin,
				width: box,
				height: box,
				anchorX: (hx * k + margin) / box,
				anchorY: (hy * k + margin) / box,
				children: shapes,
			});
			g.animate(
				track("opacity", bakeSamples(opacity, 0, { tolerance: 0.004 })),
			);
			g.animate(track("scale", bakeSamples(scale, 0, { tolerance: 0.002 })));
			if (props.autoOrient && glyph.directional) {
				const angles = unwrap(
					plan.angles.map((a) => (a * 180) / Math.PI + 135),
				);
				g.animate(
					track("rotation", bakeSamples(angles, 0, { tolerance: 0.3 })),
				);
			}
			if (props.shadow) {
				host.style(g, {
					dropShadow: {
						color: "#000000",
						opacity: 0.34,
						angle: 90,
						distance: Math.max(1, k * 1.2),
						size: k * 4,
						spread: 0,
					},
				});
			}
			glyphBoxes.push(g);
			parts[`glyph-${style}`] = g;
		}
		const cursor = host.box({
			id: ctx.partId("cursor"),
			position: "absolute",
			x: 0,
			y: 0,
			width: extent,
			height: extent,
			children: glyphBoxes,
		});

		// ── Label ────────────────────────────────────────────────────────
		const motionChildren: LayoutNode[] = [cursor];
		if (labelText !== undefined && labelMetrics) {
			const bg =
				(typeof props.label === "object" && props.label.color) || accent;
			// White on a saturated tag reads as a name tag; fall back to dark
			// ink only when white would be illegible.
			const ink =
				(contrastRatio("#ffffff", bg) ?? 0) >= 2.6 ? "#ffffff" : "#0b0c0e";
			const label = host.box({
				id: ctx.partId("label"),
				position: "absolute",
				x: half + labelX,
				y: half + labelY,
				width: labelW,
				height: labelH,
				background: bg,
				borderRadius: labelH / 2,
				children: [
					host.text(labelText, {
						id: ctx.partId("label-text"),
						position: "absolute",
						x: labelPadX,
						y: Math.round((labelH - labelMetrics.lineHeight) / 2),
						fontFamily: theme.font.body,
						fontSize: labelFont,
						fontWeight: 600,
						fill: ink,
					}),
				],
			});
			label.animate(
				track(
					"opacity",
					bakeSamples(samples(plan.length, visibility), 0, {
						tolerance: 0.004,
					}),
				),
			);
			if (props.shadow) {
				host.style(label, {
					dropShadow: {
						color: "#000000",
						opacity: 0.28,
						angle: 90,
						distance: 2,
						size: 8,
					},
				});
			}
			motionChildren.push(label);
			parts.label = label;
		}

		const motion = host.box({
			id: ctx.partId("motion"),
			position: "absolute",
			x: (plan.positions[0]?.[0] ?? 0) - half,
			y: (plan.positions[0]?.[1] ?? 0) - half,
			width: extent,
			height: extent,
			...(props.motionBlur !== false && {
				motionBlurShutter: props.motionBlur === true ? 45 : props.motionBlur,
			}),
			children: motionChildren,
		});
		motion.animate(
			track(
				"x",
				bakeSamples(
					plan.positions.map((p) => p[0] - half),
					0,
					{ tolerance: 0.2 },
				),
			),
			track(
				"y",
				bakeSamples(
					plan.positions.map((p) => p[1] - half),
					0,
					{ tolerance: 0.2 },
				),
			),
		);

		// ── Ripples and trail (they stay where they are drawn) ───────────
		const below: LayoutNode[] = [];
		if (props.ripple !== false) {
			plan.cues.clicks.forEach((click, i) => {
				below.push(
					...ripple(
						ctx,
						props.ripple as RippleKind,
						click.point,
						size,
						accent,
						click.frame,
						i,
					),
				);
			});
		}
		if (props.trail !== false) {
			const { length, spacing } = props.trail;
			const color = props.trail.color ?? accent;
			const dot = Math.max(3, size * 0.22);
			for (let g = 1; g <= length; g++) {
				const lag = g * spacing;
				const at = (f: number): Vec2 =>
					plan.positions[Math.max(0, f - lag)] ?? [0, 0];
				const moving = (f: number) => {
					const a = at(f);
					const b = at(f - 1);
					return Math.min(1, Math.hypot(a[0] - b[0], a[1] - b[1]) / 6);
				};
				const ghost = host.shape("circle", {
					id: ctx.partId(`trail-${g}`),
					position: "absolute",
					x: (plan.positions[0]?.[0] ?? 0) - dot / 2,
					y: (plan.positions[0]?.[1] ?? 0) - dot / 2,
					width: dot,
					height: dot,
					fillColor: color,
				});
				ghost.animate(
					track(
						"x",
						bakeSamples(
							samples(plan.length, (f) => at(f)[0] - dot / 2),
							0,
							{ tolerance: 0.3 },
						),
					),
					track(
						"y",
						bakeSamples(
							samples(plan.length, (f) => at(f)[1] - dot / 2),
							0,
							{ tolerance: 0.3 },
						),
					),
					track(
						"opacity",
						bakeSamples(
							samples(
								plan.length,
								(f) => 0.5 * (1 - g / (length + 1)) * moving(f) * visibility(f),
							),
							0,
							{ tolerance: 0.01 },
						),
					),
					track("scale", [[0, 1 - (0.5 * g) / (length + 1)]]),
				);
				below.push(ghost);
			}
		}

		Object.assign(parts, { motion, cursor });

		return {
			children: [...below, motion],
			width: W,
			height: H,
			duration: plan.length,
			origin: [0, 0],
			cues: plan.cues as MousePointerCues,
			parts,
			api: (placement): MousePointerApi => ({
				positionAt(frame) {
					const local = Math.max(
						0,
						Math.min(plan.length - 1, Math.round(frame - placement.start)),
					);
					const p = plan.positions[local] ?? [0, 0];
					return [p[0] + placement.x, p[1] + placement.y];
				},
				styleAt(frame) {
					const local = Math.round(frame - placement.start);
					return (
						plan.styles.find((w) => local >= w.start && local <= w.end)
							?.style ?? props.style
					);
				},
			}),
		};
	},
});

// ── Helpers ──────────────────────────────────────────────────────────

type RippleKind = "ring" | "fill" | "pulse";

const smooth = (t: number) => {
	const x = Math.max(0, Math.min(1, t));
	return x * x * (3 - 2 * x);
};
const backOut = (t: number, s = 1.7) =>
	1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

function samples(length: number, fn: (frame: number) => number): number[] {
	return Array.from({ length }, (_, f) => fn(f));
}

function track(prop: AnimatableProp, keys: ReadonlyArray<KeyframeTuple>) {
	return LayerAnimation.keys(prop, keys);
}

/** Make angle samples continuous so rotation never spins the long way round. */
function unwrap(degrees: number[]): number[] {
	const out: number[] = [];
	for (const d of degrees) {
		const prev = out[out.length - 1];
		if (prev === undefined) {
			out.push(d);
			continue;
		}
		let x = d;
		while (x - prev > 180) x -= 360;
		while (x - prev < -180) x += 360;
		out.push(x);
	}
	return out;
}

/** 1 while `style` shows, easing across `swap` frames at each change. */
function styleWeight(
	plan: PointerPlan,
	style: CursorStyle,
	frame: number,
	swap: number,
): number {
	const win = plan.styles.find((w) => frame >= w.start && frame <= w.end);
	if (!win) return 0;
	if (win.style === style) {
		const sinceStart = win.start === 0 ? swap : frame - win.start;
		return smooth(Math.min(1, (sinceStart + 1) / (swap + 1)));
	}
	// The previous window's style lingers for `swap` frames.
	const idx = plan.styles.indexOf(win);
	const prev = plan.styles[idx - 1];
	if (prev?.style === style && frame - win.start < swap) {
		return 1 - smooth((frame - win.start + 1) / (swap + 1));
	}
	return 0;
}

/** Glyph scale over time from the press windows. */
function pressProfile(
	plan: PointerPlan,
	feedback: "press" | "bounce" | "pulse" | false,
): (f: number) => number {
	if (feedback === false) return () => 1;
	const low = feedback === "bounce" ? 0.76 : feedback === "pulse" ? 1.16 : 0.84;
	return (f) => {
		for (const w of plan.presses) {
			if (f < w.down || f > w.released + 30) continue;
			if (f <= w.pressed)
				return (
					1 + (low - 1) * smooth((f - w.down) / Math.max(1, w.pressed - w.down))
				);
			if (f <= w.up) return low;
			const t = (f - w.up) / Math.max(1, w.released - w.up);
			if (feedback === "bounce") return 1 + (low - 1) * elasticDecay(t);
			if (t >= 1) return 1;
			return low + (1 - low) * backOut(t, 2.2);
		}
		return 1;
	};
}

const elasticDecay = (t: number) =>
	t >= 3 ? 0 : Math.exp(-3.2 * t) * Math.cos(t * Math.PI * 2.4);

interface GlyphPaint {
	k: number;
	margin: number;
	color: string;
	accent: string;
	outline: string | null;
	outlineWidth: number;
	mode: "union" | "each";
}

/** Outline layers (all first, so overlaps merge) then fills. */
function glyphShapes(
	ctx: Parameters<typeof mousePointer.build>[0],
	glyph: Glyph,
	style: string,
	paint: GlyphPaint,
): LayoutNode[] {
	const { k, margin } = paint;
	const geometry = {
		position: "absolute" as const,
		x: 0,
		y: 0,
		width: 24 * k + margin * 2,
		height: 24 * k + margin * 2,
	};
	const outlines: LayoutNode[] = [];
	const fills: LayoutNode[] = [];
	glyph.parts.forEach((part, i) => {
		const d = transformPathData(part.d, k, margin, margin);
		const stroke = part.paint === "stroke" || part.paint === "accent-stroke";
		const colorOf =
			part.paint === "accent" || part.paint === "accent-stroke"
				? paint.accent
				: paint.color;
		const lineWidth = (part.width ?? 0) * k;
		if (paint.outline) {
			const o = ctx.host.shape("path", {
				id: ctx.partId(`glyph-${style}-outline-${i}`),
				...geometry,
				d,
				fillType: stroke ? "none" : "solid",
				fillColor: paint.outline,
				strokeColor: paint.outline,
				strokeWidth: lineWidth + paint.outlineWidth * 2,
				strokeLineJoin: "round",
				strokeLineCap: "round",
				strokeAlign: "center",
			});
			(paint.mode === "union" ? outlines : fills).push(o);
		}
		fills.push(
			ctx.host.shape("path", {
				id: ctx.partId(`glyph-${style}-${i}`),
				...geometry,
				d,
				...(stroke
					? {
							fillType: "none" as const,
							fillColor: colorOf,
							strokeColor: colorOf,
							strokeWidth: lineWidth,
							strokeLineCap: "round" as const,
						}
					: { fillColor: colorOf }),
			}),
		);
	});
	return [...outlines, ...fills];
}

function ripple(
	ctx: Parameters<typeof mousePointer.build>[0],
	kind: RippleKind,
	at: Vec2,
	size: number,
	accent: string,
	frame: number,
	index: number,
): LayoutNode[] {
	const radius = size * 0.95;
	const life = Math.round((18 * ctx.fps) / 30);
	const make = (delay: number, n: number) => {
		const ring = ctx.host.shape("circle", {
			id: ctx.partId(`ripple-${index}-${n}`),
			position: "absolute",
			x: at[0] - radius,
			y: at[1] - radius,
			width: radius * 2,
			height: radius * 2,
			startFrame: frame + delay,
			durationFrames: life,
			...(kind === "fill"
				? { fillColor: accent }
				: {
						fillType: "none" as const,
						fillColor: accent,
						strokeColor: accent,
						strokeWidth: Math.max(1.5, size / 16),
					}),
		});
		ring.animate(
			track("scale", [
				[0, 0.2],
				[life - 2, 1, "expo.out"],
			]),
			track("opacity", [
				[0, kind === "fill" ? 0.35 : 0.9],
				[life - 1, 0, "sine.in"],
			]),
		);
		return ring;
	};
	return kind === "pulse"
		? [make(0, 0), make(Math.round((5 * ctx.fps) / 30), 1)]
		: [make(0, 0)];
}
