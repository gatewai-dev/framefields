/**
 * Toasts: notifications arriving in a corner stack. The newest sits at the
 * edge, older ones are pushed away and compress as the stack grows, and
 * each one slides out when it is dismissed while the rest close the gap.
 * The stack is solved offline and every move is a baked spring.
 *
 * Coordinates are the frame's: the root covers the video (default
 * 1920 × 1080 × theme scale, or the given width / height) from 0, 0.
 */
import {
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bakeSamples, springAt } from "../core/bake.js";
import { defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import { toPathData, type Vec2 } from "../core/path.js";
import type { Theme } from "../core/theme.js";

export const TOAST_CORNERS = [
	"top-right",
	"top-left",
	"bottom-right",
	"bottom-left",
	"top-center",
	"bottom-center",
] as const;
export type ToastCorner = (typeof TOAST_CORNERS)[number];
export const TOAST_KINDS = ["info", "success", "warning", "error"] as const;
export type ToastKind = (typeof TOAST_KINDS)[number];

export interface ToastsCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	arrivals: ReadonlyArray<{ frame: number; index: number }>;
	dismissals: ReadonlyArray<{ frame: number; index: number }>;
}

const SPRING = { stiffness: 230, damping: 24 };

/** Per-frame values that spring to each new target from wherever they are. */
export function springTrack(
	changes: ReadonlyArray<readonly [frame: number, target: number]>,
	initial: number,
	length: number,
	fps: number,
	options = SPRING,
): number[] {
	const sorted = [...changes].sort((a, b) => a[0] - b[0]);
	const out = new Array<number>(length + 1);
	let from = initial;
	let to = initial;
	let since = 0;
	let k = 0;
	for (let f = 0; f <= length; f++) {
		while (
			k < sorted.length &&
			(sorted[k] as readonly [number, number])[0] <= f
		) {
			// Restart from the current value toward the new target.
			from = from + (to - from) * springAt((f - since) / fps, options);
			to = (sorted[k] as readonly [number, number])[1];
			since = (sorted[k] as readonly [number, number])[0];
			k++;
		}
		out[f] = from + (to - from) * springAt((f - since) / fps, options);
	}
	return out;
}

/** A small icon per kind: a coloured disc with a drawn mark. */
function icon(
	kind: ToastKind,
	size: number,
	theme: Theme,
): { color: string; mark: string } {
	const p = (pts: Vec2[]) =>
		toPathData(pts.map(([x, y]) => [x * size, y * size] as Vec2));
	switch (kind) {
		case "success":
			return {
				color: theme.color.positive,
				mark: p([
					[0.28, 0.52],
					[0.44, 0.67],
					[0.73, 0.36],
				]),
			};
		case "error":
			return {
				color: theme.color.negative,
				mark: `${p([
					[0.33, 0.33],
					[0.67, 0.67],
				])} ${p([
					[0.67, 0.33],
					[0.33, 0.67],
				])}`,
			};
		case "warning":
			return {
				color: theme.color.highlight,
				mark: `${p([
					[0.5, 0.27],
					[0.5, 0.56],
				])} ${p([
					[0.5, 0.72],
					[0.5, 0.73],
				])}`,
			};
		case "info":
			return {
				color: theme.color.accent,
				mark: `${p([
					[0.5, 0.27],
					[0.5, 0.28],
				])} ${p([
					[0.5, 0.44],
					[0.5, 0.73],
				])}`,
			};
	}
}

export const toasts = /* @__PURE__ */ defineComponent({
	name: "Toasts",
	props: () => ({
		items: z
			.array(
				z
					.object({
						at: z.number().int().min(0),
						title: z.string(),
						body: z.string().optional(),
						kind: z.enum(TOAST_KINDS).default("info"),
						/** Frames on screen. Default 4 seconds. */
						duration: z.number().int().positive().optional(),
					})
					.strict(),
			)
			.min(1),
		corner: z.enum(TOAST_CORNERS).default("top-right"),
		/** Most toasts shown at once; older ones fade into the stack. */
		max: z.number().int().positive().default(3),
		toastWidth: z.number().positive().optional(),
		margin: z.number().min(0).optional(),
		fontFamily: z.string().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1920 * s;
		const H = ctx.requested.height ?? 1080 * s;
		const tw = props.toastWidth ?? 440 * s;
		const margin = props.margin ?? 36 * s;
		const fontFamily = props.fontFamily ?? theme.font.body;
		const titleFs = 22 * s;
		const bodyFs = 19 * s;
		const pad = 18 * s;
		const iconSize = 30 * s;
		const gap = 12 * s;
		const top = props.corner.startsWith("top");
		const side = props.corner.endsWith("right")
			? 1
			: props.corner.endsWith("left")
				? -1
				: 0;
		const x =
			side === 1 ? W - margin - tw : side === -1 ? margin : (W - tw) / 2;

		// ── Sizes ─────────────────────────────────────────────────────────
		const textX = pad + iconSize + pad * 0.8;
		const textW = tw - textX - pad;
		const items = props.items.map((item, index) => {
			const titleM = host.measure(item.title, {
				fontFamily,
				fontSize: titleFs,
				fontWeight: 600,
				width: textW,
			});
			const bodyM = item.body
				? host.measure(item.body, {
						fontFamily,
						fontSize: bodyFs,
						width: textW,
					})
				: null;
			const height =
				Math.max(iconSize, titleM.height + (bodyM ? bodyM.height + 4 * s : 0)) +
				pad * 2;
			return {
				...item,
				index,
				height,
				titleH: titleM.height,
				end: item.at + (item.duration ?? fps * 4),
			};
		});

		// ── The stack at every event ──────────────────────────────────────
		const events = [...new Set(items.flatMap((t) => [t.at, t.end]))].sort(
			(a, b) => a - b,
		);
		const exitFrames = Math.round(fps * 0.5);
		const length =
			Math.max(...items.map((t) => t.end)) + exitFrames + Math.round(fps * 0.4);
		const yChanges = new Map<number, Array<[number, number]>>();
		const scaleChanges = new Map<number, Array<[number, number]>>();
		const fadeChanges = new Map<number, Array<[number, number]>>();
		const push = (
			m: Map<number, Array<[number, number]>>,
			i: number,
			f: number,
			v: number,
		) => {
			const list = m.get(i) ?? [];
			list.push([f, v]);
			m.set(i, list);
		};
		for (const f of events) {
			const live = items
				.filter((t) => t.at <= f && f < t.end)
				.sort((a, b) => b.at - a.at || b.index - a.index);
			let offset = 0;
			live.forEach((t, k) => {
				// Older toasts tuck in: smaller, closer, and gone past `max`.
				const scale = 1 - Math.min(k, props.max) * 0.035;
				const y = top ? margin + offset : H - margin - offset - t.height;
				push(yChanges, t.index, f, y);
				push(scaleChanges, t.index, f, scale);
				push(fadeChanges, t.index, f, k < props.max ? 1 : 0);
				offset += t.height * scale + gap * scale;
			});
		}

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		for (const t of items) {
			const ys = yChanges.get(t.index) ?? [[t.at, margin]];
			const firstY = ys[0]?.[1] ?? margin;
			const yTrack = springTrack(ys, firstY, length, fps);
			const scaleTrack = springTrack(
				scaleChanges.get(t.index) ?? [],
				1,
				length,
				fps,
			);
			const fade = fadeChanges.get(t.index) ?? [];
			// Slide in from the edge; slide back out when dismissed.
			const away = side === 0 ? 0 : side * (tw + margin);
			const xTrack = springTrack(
				[
					[t.at, 0],
					[t.end, away],
				],
				away,
				length,
				fps,
				{ stiffness: 200, damping: 26 },
			);
			const opacity = springTrack(
				[[t.at, 1], ...fade.filter(([f]) => f > t.at), [t.end, 0]],
				0,
				length,
				fps,
				{ stiffness: 300, damping: 40 },
			).map((v) => Math.max(0, Math.min(1, v)));
			const glyph = icon(t.kind, iconSize, theme);
			const disc = host.box({
				id: ctx.partId(`toast-${t.index}-icon`),
				position: "absolute",
				x: pad,
				y: pad,
				width: iconSize,
				height: iconSize,
				background: glyph.color,
				borderRadius: iconSize / 2,
			});
			const mark = host.shape("path", {
				id: ctx.partId(`toast-${t.index}-mark`),
				position: "absolute",
				x: pad,
				y: pad,
				width: iconSize,
				height: iconSize,
				d: glyph.mark,
				fillType: "none",
				strokeColor: "#ffffff",
				strokeWidth: iconSize * 0.11,
				strokeLineCap: "round",
				strokeLineJoin: "round",
			});
			const kids: LayoutNode[] = [
				disc,
				mark,
				host.text(t.title, {
					id: ctx.partId(`toast-${t.index}-title`),
					position: "absolute",
					x: textX,
					y: pad,
					width: textW,
					fontFamily,
					fontSize: titleFs,
					fontWeight: 600,
					fill: theme.color.ink,
				}),
			];
			if (t.body)
				kids.push(
					host.text(t.body, {
						id: ctx.partId(`toast-${t.index}-body`),
						position: "absolute",
						x: textX,
						y: pad + t.titleH + 4 * s,
						width: textW,
						fontFamily,
						fontSize: bodyFs,
						fill: theme.color.muted,
					}),
				);
			const card = host.box({
				id: ctx.partId(`toast-${t.index}`),
				position: "absolute",
				x,
				y: firstY,
				width: tw,
				height: t.height,
				background: theme.color.raised,
				borderRadius: theme.radius.md,
				borderColor: theme.color.line,
				borderWidth: Math.max(1, s),
				anchorX: 0.5,
				anchorY: top ? 0 : 1,
				children: kids,
			});
			host.style(card, {
				dropShadow: {
					color: "#000000",
					opacity: 0.35,
					angle: 90,
					distance: 10 * s,
					size: 30 * s,
				},
			});
			const from = Math.max(0, t.at - 1);
			const slice = (v: number[]) => v.slice(from);
			card.animate(
				LayerAnimation.create()
					.keys("y", bakeSamples(slice(yTrack), from, { tolerance: 0.3 }))
					.keys(
						"x",
						bakeSamples(
							slice(xTrack).map((d) => x + d),
							from,
							{ tolerance: 0.3 },
						),
					)
					.keys(
						"scale",
						bakeSamples(slice(scaleTrack), from, { tolerance: 0.001 }),
					)
					.keys("opacity", [
						...(from > 0 ? [[0, 0] as [number, number]] : []),
						...bakeSamples(slice(opacity), from, { tolerance: 0.01 }),
					]),
			);
			parts[`toast-${t.index}`] = card;
			children.push(card);
		}

		return {
			children,
			width: W,
			height: H,
			duration: length,
			origin: [0, 0],
			cues: {
				arrivals: items.map((t) => ({ frame: t.at, index: t.index })),
				dismissals: items.map((t) => ({ frame: t.end, index: t.index })),
			} as ToastsCues,
			parts,
		};
	},
});
