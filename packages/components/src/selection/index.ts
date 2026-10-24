/**
 * Selection: a text selection or a marquee, the way an editor draws them,
 * driven by a `MousePointer` drag. Text selections follow the pointer glyph
 * by glyph; a marquee follows it corner by corner and lights up the items it
 * covers.
 *
 * Coordinates are the frame's: the root covers the video (default
 * 1920 × 1080 × theme scale, or the given width / height) from 0, 0.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bakeSamples } from "../core/bake.js";
import { defineComponent } from "../core/contract.js";
import type { Rect } from "../core/draw.js";
import { evaluateEase } from "../core/ease.js";
import type { Animatable } from "../core/host.js";
import type { Vec2 } from "../core/path.js";
import { targetSchema } from "../core/schemas.js";
import {
	boundsOf,
	resolveTarget,
	type Target,
	type TargetNode,
	textLayout,
} from "../core/targets.js";
import { lineShift, rangeRects } from "../core/text.js";
import { scaleFrames } from "../core/timing.js";

export interface SelectionCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** The selection is complete (the drag ends). */
	selected: ReadonlyArray<{ frame: number }>;
	/** Marquee items, as each is first covered. */
	items: ReadonlyArray<{ frame: number; index: number }>;
}

/** What Selection reads from a pointer: `MousePointer` satisfies it. */
export interface SelectionPointer {
	positionAt(frame: number): Vec2;
	cues?: { drags?: ReadonlyArray<{ frame: number; end: number }> };
}

export const selection = /* @__PURE__ */ defineComponent({
	name: "Selection",
	props: () => ({
		kind: z.enum(["text", "marquee"]).default("text"),
		/** Text to select: `{ text, match? | range? }`. */
		target: z
			.custom<{
				text: object;
				match?: string | RegExp;
				range?: [number, number];
				nth?: number;
			}>((v) => typeof v === "object" && v !== null && "text" in v, {
				message: "Expected a text target `{ text, match? | range? }`",
			})
			.optional(),
		/** A MousePointer to follow during the drag. */
		pointer: z
			.custom<SelectionPointer>(
				(v) =>
					typeof v === "object" &&
					v !== null &&
					typeof (v as SelectionPointer).positionAt === "function",
				{ message: "Expected a MousePointer (anything with positionAt)" },
			)
			.optional(),
		/** Drag frames (parent timeline). Default: the pointer's first drag. */
		drag: z
			.object({ frame: z.number().int().min(0), end: z.number().int().min(0) })
			.passthrough()
			.optional(),
		/** Marquee corners (parent coordinates). Default: the pointer's. */
		from: z.tuple([z.number(), z.number()]).optional(),
		to: z.tuple([z.number(), z.number()]).optional(),
		/** Marquee: these light up once covered. */
		items: z.array(targetSchema()).default([]),
		/** Frame (parent timeline) the selection disappears. */
		clear: z.number().int().min(0).optional(),
		color: z.string().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1920 * s;
		const H = ctx.requested.height ?? 1080 * s;
		const color = props.color ?? theme.color.accent;
		const at0 = ctx.requested.at;
		const drag = props.drag ?? props.pointer?.cues?.drags?.[0];
		if (!drag)
			throw new Error(
				"Selection: give `drag: { frame, end }`, or a `pointer` that drags.",
			);
		// Local frames: the component's own timeline.
		const start = drag.frame - at0;
		const end = Math.max(start + 1, drag.end - at0);
		const progress = (f: number) =>
			evaluateEase(
				"power2.inOut",
				Math.max(0, Math.min(1, (f - start) / (end - start))),
			);
		const pointerAt = (f: number) => props.pointer?.positionAt(f + at0);
		const fade = scaleFrames(8, fps);
		const clear = props.clear !== undefined ? props.clear - at0 : undefined;

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		const cues: SelectionCues = {
			selected: [{ frame: end }],
			items: [] as Array<{ frame: number; index: number }>,
		};
		if (props.kind === "text") {
			if (!props.target)
				throw new Error("Selection: a text selection needs a `target`.");
			const t = textLayout(
				props.target as Extract<Target, { text: TargetNode }>,
				{ measure: host.measure, fps },
			);
			const [r0, r1] = t.range;
			const glyphs = t.metrics.glyphs.filter(
				(g) => g.index >= r0 && g.index < r1,
			);
			// The selection's end (a string index) on frame f.
			const endIndex = (f: number): number => {
				if (f <= start) return r0;
				const p = pointerAt(Math.min(f, end));
				if (!p) return r0 + Math.round(progress(f) * (r1 - r0));
				// The line under the pointer, then the glyph boundary nearest it.
				const lh = t.metrics.lineHeight;
				const lines = [...new Set(glyphs.map((g) => g.line))];
				const want = Math.floor((p[1] - t.y) / lh);
				const line = Math.max(
					lines[0] as number,
					Math.min(lines[lines.length - 1] as number, want),
				);
				const shift = lineShift(t.metrics, line, t.options);
				let best = r0;
				let bestD = Number.POSITIVE_INFINITY;
				for (const g of glyphs) {
					if (g.line !== line) continue;
					for (const [edge, idx] of [
						[g.x, g.index],
						[g.x + g.width, g.index + 1],
					] as const) {
						const d = Math.abs(t.x + shift + edge - p[0]);
						if (d < bestD) {
							bestD = d;
							best = idx;
						}
					}
				}
				// Below the range's lines selects to the end; above, to the start.
				if (want > (lines[lines.length - 1] as number)) return r1;
				if (want < (lines[0] as number)) return r0;
				return Math.max(r0, Math.min(r1, best));
			};
			const full = rangeRects(t.metrics, r0, r1, t.options);
			const lineOf = (rect: Rect) => Math.round(rect.y / t.metrics.lineHeight);
			full.forEach((rect, i) => {
				const line = lineOf(rect);
				const widthAt = (f: number) => {
					const part = rangeRects(t.metrics, r0, endIndex(f), t.options).find(
						(r) => lineOf(r) === line,
					);
					return part ? round(part.x + part.width - rect.x) : 0;
				};
				const keys: KeyframeTuple[] = [[0, 0]];
				let last = 0;
				for (let f = start; f <= end; f++) {
					const w = widthAt(f);
					if (w !== last) {
						keys.push([f, w, "hold"]);
						last = w;
					}
				}
				const pad = Math.max(1, 2 * s);
				const box = host.box({
					id: ctx.partId(`line-${i}`),
					position: "absolute",
					x: t.x + rect.x,
					y: t.y + rect.y + pad,
					width: 0,
					height: rect.height - pad * 2,
					background: withAlpha(color, 0.32),
					borderRadius: Math.max(1, 3 * s),
				});
				const anim = LayerAnimation.create().keys("width", keys);
				if (clear !== undefined)
					anim.keys("opacity", [
						[clear, 1],
						[clear + fade, 0, "power2.out"],
					]);
				box.animate(anim);
				parts[`line-${i}`] = box;
				children.push(box);
			});
		} else {
			const from: Vec2 = props.from ?? pointerAt(start) ?? [W * 0.3, H * 0.3];
			const to: Vec2 = props.to ?? pointerAt(end) ?? [W * 0.7, H * 0.7];
			const corner = (f: number): Vec2 => {
				const p = props.to ? undefined : pointerAt(Math.min(f, end));
				if (p) return p;
				const k = progress(f);
				return [
					from[0] + (to[0] - from[0]) * k,
					from[1] + (to[1] - from[1]) * k,
				];
			};
			const rectAt = (f: number): Rect => {
				const c = corner(f);
				return {
					x: Math.min(from[0], c[0]),
					y: Math.min(from[1], c[1]),
					width: Math.abs(c[0] - from[0]),
					height: Math.abs(c[1] - from[1]),
				};
			};
			const frames = Array.from({ length: end - start + 1 }, (_, k) =>
				rectAt(start + k),
			);
			const track = (k: keyof Rect) =>
				bakeSamples(
					frames.map((r) => r[k]),
					start,
					{ tolerance: 0.3 },
				);
			const box = host.box({
				id: ctx.partId("marquee"),
				position: "absolute",
				x: from[0],
				y: from[1],
				width: 0,
				height: 0,
				background: withAlpha(color, 0.16),
				borderColor: color,
				borderWidth: Math.max(1, 1.5 * s),
				opacity: 0,
			});
			box.animate(
				LayerAnimation.create()
					.keys("x", track("x"))
					.keys("y", track("y"))
					.keys("width", track("width"))
					.keys("height", track("height"))
					// The marquee goes on release; what it selected stays.
					.keys("opacity", [
						[start, 1, "hold"],
						[end, 1],
						[end + fade, 0, "power2.out"],
					]),
			);
			parts.marquee = box;

			props.items.forEach((item, index) => {
				const r = boundsOf(
					(() => {
						const res = resolveTarget(item, { measure: host.measure, fps });
						return res.kind === "static" ? res.rects : [res.at(end)];
					})(),
				);
				const hits = (m: Rect) =>
					m.x < r.x + r.width &&
					m.x + m.width > r.x &&
					m.y < r.y + r.height &&
					m.y + m.height > r.y;
				const keys: KeyframeTuple[] = [[0, 0]];
				let on = false;
				frames.forEach((m, k) => {
					const now = m.width > 0 && m.height > 0 && hits(m);
					if (now !== on) {
						keys.push([start + k, now ? 1 : 0, "hold"]);
						if (now && !cues.items.some((c) => c.index === index))
							(cues.items as Array<{ frame: number; index: number }>).push({
								frame: start + k,
								index,
							});
						on = now;
					}
				});
				if (on && clear !== undefined)
					keys.push([clear, 1], [clear + fade, 0, "power2.out"]);
				const pad = 4 * s;
				const glow = host.box({
					id: ctx.partId(`item-${index}`),
					position: "absolute",
					x: r.x - pad,
					y: r.y - pad,
					width: r.width + pad * 2,
					height: r.height + pad * 2,
					background: withAlpha(color, 0.18),
					borderColor: color,
					borderWidth: Math.max(1.5, 2 * s),
					borderRadius: theme.radius.sm + pad,
					opacity: 0,
				});
				glow.animate(LayerAnimation.keys("opacity", keys));
				parts[`item-${index}`] = glow;
				children.push(glow);
			});
			children.push(box);
		}

		const settle = props.kind === "marquee" ? end + fade : end;
		return {
			children,
			width: W,
			height: H,
			duration: clear !== undefined ? clear + fade : settle,
			openEnded: clear === undefined,
			origin: [0, 0],
			cues,
			parts,
		};
	},
});

const round = (v: number) => Math.round(v * 100) / 100;

/** `#rrggbb` / `#rgb` at alpha `a`; other colours pass through. */
function withAlpha(color: string, a: number): string {
	const hex = color.trim().replace(/^#/, "");
	const full =
		hex.length === 3 ? hex.replace(/./g, (x) => x + x) : hex.slice(0, 6);
	if (!/^[0-9a-f]{6}$/i.test(full)) return color;
	const n = Number.parseInt(full, 16);
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
