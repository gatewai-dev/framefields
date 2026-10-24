/**
 * Callout: a label with a leader line pinned to a point, a node, text, or a
 * moving tracked object. It picks the open side, keeps the label inside the
 * frame, and follows moving targets smoothly (decisions are eased, never
 * snapped).
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
import { evaluateEase } from "../core/ease.js";
import type { Animatable } from "../core/host.js";
import type { Vec2 } from "../core/path.js";
import { targetSchema } from "../core/schemas.js";
import { resolveTarget, targetPoint } from "../core/targets.js";
import { themeFrames } from "../core/theme.js";

export const CALLOUT_SIDES = [
	"auto",
	"top",
	"bottom",
	"left",
	"right",
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
] as const;
export type CalloutSide = (typeof CALLOUT_SIDES)[number];

export interface CalloutCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Fully drawn. */
	in: ReadonlyArray<{ frame: number }>;
}

const DIRECTION: Record<Exclude<CalloutSide, "auto">, Vec2> = {
	top: [0, -1],
	bottom: [0, 1],
	left: [-1, 0],
	right: [1, 0],
	"top-left": [-1, -1],
	"top-right": [1, -1],
	"bottom-left": [-1, 1],
	"bottom-right": [1, 1],
};

export const callout = /* @__PURE__ */ defineComponent({
	name: "Callout",
	props: () => ({
		target: targetSchema(),
		text: z.string().min(1),
		/** A bolder first line above `text`. */
		title: z.string().optional(),
		side: z.enum(CALLOUT_SIDES).default("auto"),
		/** Leader length (px). */
		distance: z.number().positive().optional(),
		/** A bend: out on the diagonal, then level into the label. */
		elbow: z.boolean().default(true),
		dot: z.boolean().default(true),
		color: z.string().optional(),
		/** Frames to follow a moving target. Default 6 seconds. */
		length: z.number().int().positive().optional(),
		fontFamily: z.string().optional(),
		fontSize: z.number().positive().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1920 * s;
		const H = ctx.requested.height ?? 1080 * s;
		const fs = props.fontSize ?? 26 * s;
		const fontFamily = props.fontFamily ?? theme.font.body;
		const color = props.color ?? theme.color.accent;
		const reach = props.distance ?? 120 * s;
		const margin = 24 * s;
		const thick = Math.max(2, 2.5 * s);
		const dotR = 7 * s;

		const resolved = resolveTarget(props.target, {
			measure: host.measure,
			fps,
		});
		const moving = resolved.kind === "dynamic";
		const base = themeFrames(theme, "base", fps);
		const intro = Math.round(base * 1.8);
		const length = moving ? (props.length ?? fps * 6) : intro + 1;

		// ── Label size ────────────────────────────────────────────────────
		const padX = fs * 0.6;
		const padY = fs * 0.42;
		const titleM = props.title
			? host.measure(props.title, { fontFamily, fontSize: fs, fontWeight: 700 })
			: null;
		const textM = host.measure(props.text, {
			fontFamily,
			fontSize: fs * (props.title ? 0.85 : 1),
		});
		const lw = Math.max(titleM?.width ?? 0, textM.width) + padX * 2;
		const lh = (titleM?.height ?? 0) + textM.height + padY * 2;

		// ── Geometry per frame ────────────────────────────────────────────
		const sideAt = (p: Vec2): Vec2 =>
			props.side === "auto"
				? [p[0] < W / 2 ? 1 : -1, p[1] < H * 0.4 ? 1 : -1]
				: DIRECTION[props.side];
		// Side decisions ease over a few frames, so a target crossing the
		// middle swings its label across instead of snapping.
		let dir: Vec2 | null = null;
		const follow = 1 - Math.exp(-6 / fps);
		const frames = Array.from({ length: length + 1 }, (_, f) => {
			const anchor = targetPoint(resolved, f);
			const want = sideAt(anchor);
			dir = dir
				? [
						dir[0] + (want[0] - dir[0]) * follow,
						dir[1] + (want[1] - dir[1]) * follow,
					]
				: want;
			const [dx, dy] = dir;
			const diagonal = props.elbow && Math.abs(dx) > 0.01;
			const bend: Vec2 = diagonal
				? [anchor[0] + dx * reach * 0.55, anchor[1] + dy * reach * 0.55]
				: [anchor[0] + dx * reach, anchor[1] + dy * reach];
			const end: Vec2 = diagonal
				? [bend[0] + Math.sign(dx) * reach * 0.45 * Math.abs(dx), bend[1]]
				: bend;
			// The label hangs off the leader's end, on its side.
			let lx =
				Math.abs(dx) < 0.5 ? end[0] - lw / 2 : dx > 0 ? end[0] : end[0] - lw;
			let ly =
				Math.abs(dx) < 0.5 ? (dy > 0 ? end[1] : end[1] - lh) : end[1] - lh / 2;
			// Stay inside the frame.
			lx = Math.min(W - margin - lw, Math.max(margin, lx));
			ly = Math.min(H - margin - lh, Math.max(margin, ly));
			const join: Vec2 =
				Math.abs(dx) < 0.5
					? [lx + lw / 2, dy > 0 ? ly : ly + lh]
					: [dx > 0 ? lx : lx + lw, ly + lh / 2];
			return {
				anchor,
				bend: diagonal ? bend : join,
				end: join,
				label: [lx, ly] as Vec2,
			};
		});

		// ── Intro: dot pops, leader draws, label arrives ──────────────────
		const draw = (f: number, from: number, to: number) =>
			evaluateEase(
				theme.motion.ease.move,
				Math.min(1, Math.max(0, (f - from) / Math.max(1, to - from))),
			);
		const seg1 = [Math.round(base * 0.3), Math.round(base * 1.0)] as const;
		const seg2 = [seg1[1], Math.round(base * 1.4)] as const;
		const labelAt = Math.round(base * 1.1);

		const segment = (
			id: string,
			pick: (k: (typeof frames)[number]) => [Vec2, Vec2],
			window: readonly [number, number],
		) => {
			const xs: number[] = [];
			const ys: number[] = [];
			const ws: number[] = [];
			const rs: number[] = [];
			frames.forEach((k, f) => {
				const [a, b] = pick(k);
				const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
				xs.push(a[0]);
				ys.push(a[1] - thick / 2);
				ws.push(len * draw(f, window[0], window[1]));
				rs.push((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);
			});
			const node = host.box({
				id: ctx.partId(id),
				position: "absolute",
				x: xs[0] ?? 0,
				y: ys[0] ?? 0,
				width: 0,
				height: thick,
				background: color,
				borderRadius: thick / 2,
				anchorX: 0,
				anchorY: 0.5,
			});
			node.animate(
				LayerAnimation.create()
					.keys("x", bakeSamples(xs, 0, { tolerance: 0.2 }))
					.keys("y", bakeSamples(ys, 0, { tolerance: 0.2 }))
					.keys("width", bakeSamples(ws, 0, { tolerance: 0.2 }))
					.keys("rotation", bakeSamples(rs, 0, { tolerance: 0.05 })),
			);
			return node;
		};

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		const leader1 = segment("leader", (k) => [k.anchor, k.bend], seg1);
		children.push(leader1);
		parts.leader = leader1;
		if (props.elbow) {
			const leader2 = segment("leader-2", (k) => [k.bend, k.end], seg2);
			children.push(leader2);
			parts["leader-2"] = leader2;
		}
		if (props.dot) {
			const dot = host.box({
				id: ctx.partId("dot"),
				position: "absolute",
				x: (frames[0]?.anchor[0] ?? 0) - dotR,
				y: (frames[0]?.anchor[1] ?? 0) - dotR,
				width: dotR * 2,
				height: dotR * 2,
				background: color,
				borderRadius: dotR,
				borderColor: theme.color.bg,
				borderWidth: Math.max(2, 2 * s),
			});
			const pop = Array.from({ length: Math.min(length, intro) + 1 }, (_, f) =>
				springAt(f / fps, { stiffness: 320, damping: 16 }),
			);
			dot.animate(
				LayerAnimation.create()
					.keys(
						"x",
						bakeSamples(
							frames.map((k) => k.anchor[0] - dotR),
							0,
							{ tolerance: 0.2 },
						),
					)
					.keys(
						"y",
						bakeSamples(
							frames.map((k) => k.anchor[1] - dotR),
							0,
							{ tolerance: 0.2 },
						),
					)
					.keys("scale", bakeSamples(pop, 0, { tolerance: 0.005 })),
			);
			children.push(dot);
			parts.dot = dot;
		}
		const labelKids: LayoutNode[] = [];
		if (props.title && titleM)
			labelKids.push(
				host.text(props.title, {
					id: ctx.partId("title"),
					position: "absolute",
					x: padX,
					y: padY,
					fontFamily,
					fontSize: fs,
					fontWeight: 700,
					fill: theme.color.ink,
				}),
			);
		labelKids.push(
			host.text(props.text, {
				id: ctx.partId("text"),
				position: "absolute",
				x: padX,
				y: padY + (titleM?.height ?? 0),
				fontFamily,
				fontSize: fs * (props.title ? 0.85 : 1),
				fill: props.title ? theme.color.muted : theme.color.ink,
			}),
		);
		const label = host.box({
			id: ctx.partId("label"),
			position: "absolute",
			x: frames[0]?.label[0] ?? 0,
			y: frames[0]?.label[1] ?? 0,
			width: lw,
			height: lh,
			background: theme.color.raised,
			borderRadius: theme.radius.md,
			borderColor: color,
			borderWidth: Math.max(1.5, 1.5 * s),
			children: labelKids,
		});
		const rise = 10 * s;
		label.animate(
			LayerAnimation.create()
				.keys(
					"x",
					bakeSamples(
						frames.map((k) => k.label[0]),
						0,
						{ tolerance: 0.2 },
					),
				)
				.keys(
					"y",
					bakeSamples(
						frames.map(
							(k, f) =>
								k.label[1] + rise * (1 - draw(f, labelAt, labelAt + base)),
						),
						0,
						{ tolerance: 0.2 },
					),
				)
				.keys("opacity", [
					[0, 0],
					[labelAt, 0],
					[labelAt + Math.round(base * 0.7), 1, "power2.out"],
				]),
		);
		children.push(label);
		parts.label = label;

		return {
			children,
			width: W,
			height: H,
			duration: moving ? length : intro,
			openEnded: !moving,
			origin: [0, 0],
			cues: { in: [{ frame: labelAt + base }] } as CalloutCues,
			parts,
		};
	},
});
