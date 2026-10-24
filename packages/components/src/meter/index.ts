/**
 * Meter: progress and scores as a ring, an arc gauge, a bar, lit segments or
 * a star rating, filling on the same value timeline as its `Counter`.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bakeSamples } from "../core/bake.js";
import { bind, defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import { toPathData, type Vec2 } from "../core/path.js";
import { themeFrames } from "../core/theme.js";
import { counter } from "../counter/index.js";
import { type ValueKey, valueAt } from "../counter/plan.js";

export const METER_KINDS = ["ring", "arc", "bar", "segments", "stars"] as const;
export type MeterKind = (typeof METER_KINDS)[number];

export interface MeterCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** The fill (and counter) is at rest. */
	settled: ReadonlyArray<{ frame: number }>;
	/** Each segment or star completing (fills only; empties are not cued). */
	crossings: ReadonlyArray<{ frame: number; segment: number }>;
}

/** Points along a circular arc, angles in degrees (0 = right, clockwise). */
function arcPoints(c: Vec2, r: number, from: number, to: number): Vec2[] {
	const steps = Math.max(8, Math.ceil(Math.abs(to - from) / 6));
	return Array.from({ length: steps + 1 }, (_, k) => {
		const a = ((from + ((to - from) * k) / steps) * Math.PI) / 180;
		return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as Vec2;
	});
}

/** A five-point star inside a `size` box. */
function starPath(size: number): string {
	const c = size / 2;
	const pts: Vec2[] = Array.from({ length: 10 }, (_, k) => {
		const r = k % 2 === 0 ? size * 0.5 : size * 0.21;
		const a = -Math.PI / 2 + (k * Math.PI) / 5;
		return [c + Math.cos(a) * r, c + Math.sin(a) * r * 1.02 + size * 0.03];
	});
	return toPathData(pts, true);
}

export const meter = /* @__PURE__ */ defineComponent({
	name: "Meter",
	props: () => ({
		value: z.number().optional(),
		/** Multi-step values: `[frame, value, ease?]`, frames ascending. */
		values: z
			.array(
				z.union([
					z.tuple([z.number().int().min(0), z.number()]),
					z.tuple([z.number().int().min(0), z.number(), z.string()]),
				]),
			)
			.min(1)
			.optional(),
		from: z.number().default(0),
		/** Default 100 (5 for stars). */
		max: z.number().optional(),
		kind: z.enum(METER_KINDS).default("ring"),
		/** Cells for `segments` (default 10), stars for `stars` (default `max`). */
		segments: z.number().int().positive().optional(),
		/** Width (bar, segments, stars) or diameter (ring, arc). */
		size: z.number().positive().optional(),
		thickness: z.number().positive().optional(),
		counter: z.boolean().optional(),
		format: z.string().default(",d"),
		suffix: z.string().optional(),
		label: z.string().optional(),
		color: z.string().optional(),
		track: z.string().optional(),
		countDuration: z.number().int().positive().optional(),
		ease: z.string().optional(),
		fontFamily: z.string().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const kind = props.kind;
		const max = props.max ?? (kind === "stars" ? 5 : 100);
		const from = props.from;
		const ease = props.ease ?? theme.motion.ease.move;
		const color = props.color ?? theme.color.accent;
		const trackColor = props.track ?? theme.color.line;
		const fontFamily = props.fontFamily ?? theme.font.display;
		if (props.value === undefined && !props.values)
			throw new Error("Meter: give `value` (or `values`).");
		const keys: ValueKey[] = props.values
			? props.values.map((v) => [...v] as unknown as ValueKey)
			: [
					[0, from],
					[
						props.countDuration ?? themeFrames(theme, "slow", fps) * 2,
						props.value as number,
						ease,
					],
				];
		const last = (keys[keys.length - 1] as ValueKey)[0];
		const fraction = (v: number) =>
			Math.max(0, Math.min(1, (v - from) / (max - from || 1)));
		/** Keys of `f(fraction)`, on exactly the value's keyframes and eases. */
		const fillKeys = (f: (x: number) => number): KeyframeTuple[] =>
			keys.map((k, i) =>
				i === 0
					? [k[0], f(fraction(k[1]))]
					: [k[0], f(fraction(k[1])), k[2] ?? ease],
			);
		const perFrame = Array.from({ length: last + 1 }, (_, t) =>
			valueAt(keys, t, ease),
		);

		const showCounter = props.counter ?? kind !== "stars";
		const suffix = props.suffix ?? (max === 100 ? "%" : "");
		const makeCounter = bind(host, counter);
		const number = (size: number, align: "start" | "center" | "end") =>
			makeCounter({
				id: ctx.partId("counter"),
				values: keys.map((k) => [...k]) as never,
				format: props.format,
				suffix,
				affixScale: 0.6,
				digitStagger: 0,
				ease,
				fontFamily,
				fontSize: size,
				fontWeight: 700,
				align,
				x: 0,
				y: 0,
				theme,
				fps,
			});
		const label = (text: string, size: number) =>
			host.text(text, {
				id: ctx.partId("label"),
				position: "absolute",
				fontFamily,
				fontSize: size,
				fill: theme.color.muted,
			});

		const children: LayoutNode[] = [];
		const parts: Record<string, Animatable<LayoutNode>> = {};
		const crossings: Array<{ frame: number; segment: number }> = [];
		let W = 0;
		let H = 0;

		const stroke = (
			id: string,
			d: string,
			w: number,
			h: number,
			paint: string,
			thickness: number,
		) =>
			host.shape("path", {
				id: ctx.partId(id),
				position: "absolute",
				x: 0,
				y: 0,
				width: w,
				height: h,
				d,
				fillType: "none",
				strokeColor: paint,
				strokeWidth: thickness,
				strokeLineCap: "round",
			});

		switch (kind) {
			case "ring":
			case "arc": {
				const D = props.size ?? 260 * s;
				const T = props.thickness ?? D * (kind === "ring" ? 0.085 : 0.1);
				const r = (D - T) / 2;
				const c: Vec2 = [D / 2, D / 2];
				// Ring: a full turn from the top. Arc: 240° from lower left, over the top.
				const [a0, a1] = kind === "ring" ? [-90, 269.9] : [150, 390];
				const path = toPathData(arcPoints(c, r, a0, a1));
				W = D;
				H = kind === "ring" ? D : D * 0.86;
				const track = stroke("track", path, W, H, trackColor, T);
				const fill = stroke("fill", path, W, H, color, T);
				fill.animate(
					LayerAnimation.keys(
						"trimEnd",
						fillKeys((x) => x),
					),
				);
				children.push(track, fill);
				parts.track = track;
				parts.fill = fill;
				if (showCounter) {
					const n = number(D * (kind === "ring" ? 0.24 : 0.22), "center");
					const nn = n as unknown as {
						x: number;
						y: number;
						width: number;
						height: number;
					};
					nn.x = (W - nn.width) / 2;
					nn.y =
						(kind === "ring" ? D / 2 : D * 0.48) -
						nn.height / 2 -
						(props.label ? D * 0.04 : 0);
					children.push(n);
					parts.counter = n;
					if (props.label) {
						const size = D * 0.075;
						const m = host.measure(props.label, { fontFamily, fontSize: size });
						const l = label(props.label, size);
						Object.assign(l, { x: (W - m.width) / 2, y: nn.y + nn.height });
						children.push(l);
						parts.label = l;
					}
				}
				break;
			}
			case "bar": {
				const w = props.size ?? 640 * s;
				const T = props.thickness ?? 16 * s;
				const top = props.label ? 34 * s : 0;
				const track = host.box({
					id: ctx.partId("track"),
					position: "absolute",
					x: 0,
					y: top,
					width: w,
					height: T,
					background: trackColor,
					borderRadius: T / 2,
				});
				const fill = host.box({
					id: ctx.partId("fill"),
					position: "absolute",
					x: 0,
					y: top,
					width: 0,
					height: T,
					background: color,
					borderRadius: T / 2,
				});
				fill.animate(
					LayerAnimation.keys(
						"width",
						fillKeys((x) => x * w),
					),
				);
				children.push(track, fill);
				parts.track = track;
				parts.fill = fill;
				W = w;
				H = top + T;
				if (props.label) {
					const l = label(props.label, 24 * s);
					Object.assign(l, { x: 0, y: 0 });
					children.push(l);
					parts.label = l;
				}
				if (showCounter) {
					const n = number(Math.max(T * 2.2, 30 * s), "end");
					const nn = n as unknown as {
						x: number;
						y: number;
						width: number;
						height: number;
					};
					nn.x = w + 18 * s;
					nn.y = top + T / 2 - nn.height / 2;
					W = nn.x + nn.width;
					H = Math.max(H, nn.y + nn.height);
					children.push(n);
					parts.counter = n;
				}
				break;
			}
			case "segments":
			case "stars": {
				const n = props.segments ?? (kind === "stars" ? Math.round(max) : 10);
				const w = props.size ?? (kind === "stars" ? 300 : 640) * s;
				const gap = kind === "stars" ? w * 0.03 : w * 0.012;
				const cell = (w - gap * (n - 1)) / n;
				const h = kind === "stars" ? cell : (props.thickness ?? 22 * s);
				// How full each cell is, per frame.
				const fill = (k: number) =>
					perFrame.map((v) => Math.max(0, Math.min(1, fraction(v) * n - k)));
				for (let k = 0; k < n; k++) {
					const x = k * (cell + gap);
					const amount = fill(k);
					const full = amount.findIndex((a) => a >= 1);
					if (full >= 0) crossings.push({ frame: full, segment: k });
					if (kind === "segments") {
						const base = host.box({
							id: ctx.partId(`cell-${k}`),
							position: "absolute",
							x,
							y: 0,
							width: cell,
							height: h,
							background: trackColor,
							borderRadius: Math.min(h, cell) * 0.25,
						});
						const lit = host.box({
							id: ctx.partId(`lit-${k}`),
							position: "absolute",
							x,
							y: 0,
							width: cell,
							height: h,
							background: color,
							borderRadius: Math.min(h, cell) * 0.25,
							opacity: 0,
						});
						// Lights on the frame the value reaches the cell, with a small pop.
						const on = amount.map((a) => (a >= 1 ? 1 : 0));
						const opacity: KeyframeTuple[] = [[0, on[0] ?? 0]];
						const scale: KeyframeTuple[] = [[0, 1]];
						on.forEach((v, t) => {
							if (t > 0 && v !== on[t - 1]) {
								opacity.push([t, v, "hold"]);
								if (v === 1) scale.push([t, 1.18], [t + 6, 1, "power2.out"]);
							}
						});
						lit.animate(
							LayerAnimation.create()
								.keys("opacity", opacity)
								.keys("scale", ascending(scale)),
						);
						children.push(base, lit);
					} else {
						const d = starPath(cell);
						const base = host.shape("path", {
							id: ctx.partId(`star-${k}`),
							position: "absolute",
							x,
							y: 0,
							width: cell,
							height: cell,
							d,
							fillType: "solid",
							fillColor: trackColor,
						});
						const star = host.shape("path", {
							id: ctx.partId(`star-${k}-fill`),
							position: "absolute",
							x: 0,
							y: 0,
							width: cell,
							height: cell,
							d,
							fillType: "solid",
							fillColor: color,
						});
						// Fractional ratings fill a star partway: a clip that widens.
						const clip = host.box({
							id: ctx.partId(`star-${k}-clip`),
							position: "absolute",
							x,
							y: 0,
							width: 0,
							height: cell,
							overflow: "hidden",
							children: [star],
						});
						clip.animate(
							LayerAnimation.keys(
								"width",
								bakeSamples(
									amount.map((a) => a * cell),
									0,
									{ tolerance: 0.2 },
								),
							),
						);
						children.push(base, clip);
					}
				}
				W = w;
				H = h;
				if (showCounter) {
					const c = number(Math.max(h * 1.4, 30 * s), "end");
					const cc = c as unknown as {
						x: number;
						y: number;
						width: number;
						height: number;
					};
					cc.x = w + 18 * s;
					cc.y = h / 2 - cc.height / 2;
					W = cc.x + cc.width;
					H = Math.max(H, cc.y + cc.height);
					children.push(c);
					parts.counter = c;
				}
				break;
			}
		}

		// Centring the counter on a shorter row can put it above the top; the
		// root box clips what's outside it, so move everything down instead.
		const top = Math.min(
			0,
			...children.map((n) => (n as unknown as { y?: number }).y ?? 0),
		);
		if (top < 0) {
			for (const n of children) {
				const node = n as unknown as { y?: number };
				node.y = (node.y ?? 0) - top;
			}
			H -= top;
		}

		const settled = Math.max(
			last,
			(
				parts.counter as unknown as {
					cues?: { settled: Array<{ frame: number }> };
				}
			)?.cues?.settled[0]?.frame ?? 0,
		);
		return {
			children,
			width: W,
			height: H,
			duration: settled + 1,
			openEnded: true,
			cues: { settled: [{ frame: settled }], crossings } as MeterCues,
			parts,
		};
	},
});

function ascending(keys: KeyframeTuple[]): KeyframeTuple[] {
	const out: KeyframeTuple[] = [];
	for (const k of [...keys].sort((a, b) => a[0] - b[0])) {
		while (out.length > 0 && (out[out.length - 1] as KeyframeTuple)[0] >= k[0])
			out.pop();
		out.push(k);
	}
	return out;
}
