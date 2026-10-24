/**
 * Backdrop: the surface behind a scene. A drifting mesh gradient, a grid or
 * a dot field, with a vignette and film grain. Every motion is periodic in
 * `loop`, so frame f and frame f + loop are the same picture and the
 * backdrop can sit under any length of scene.
 *
 * Keys sit on each motion's extremes with `sine.inOut` (an exact cosine
 * between extremes), so a loop costs a few keys per axis.
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
import { defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";

export const BACKDROP_KINDS = ["mesh", "grid", "dots", "solid"] as const;
export type BackdropKind = (typeof BACKDROP_KINDS)[number];

export interface BackdropCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** The first frame of every loop. */
	loops: ReadonlyArray<{ frame: number }>;
}

/**
 * Keys per track, to bound program size on very long scenes (past it the
 * last loop holds). A layer carries at most two looping tracks, so it stays
 * under the `large_animation` lint threshold of 2000.
 */
const MAX_KEYS = 960;

export const backdrop = /* @__PURE__ */ defineComponent({
	name: "Backdrop",
	props: () => ({
		kind: z.enum(BACKDROP_KINDS).default("mesh"),
		/** Blob colours (mesh); the first is the grid / dot colour. */
		colors: z.array(z.string()).min(1).optional(),
		background: z.string().optional(),
		/** Frames of one loop. Default 10 seconds. */
		loop: z.number().int().min(2).optional(),
		/** Drift amplitude multiplier (the period stays `loop`). */
		speed: z.number().min(0).default(1),
		/** Grid cell / dot pitch. */
		cell: z.number().positive().optional(),
		intensity: z.number().min(0).max(2).default(1),
		/** A soft light drifting over the grid or dots. */
		glow: z.boolean().optional(),
		vignette: z.number().min(0).max(1).default(0.45),
		grain: z.union([z.number().min(0).max(1), z.literal(false)]).default(0.35),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1920 * s;
		const H = ctx.requested.height ?? 1080 * s;
		const c = theme.color;
		const loop = props.loop ?? fps * 10;
		const colors = props.colors ?? [c.accent, c.accent2, c.highlight];
		const cell = props.cell ?? 64 * s;
		// Motion is keyed for the window, or a minute, in whole loops.
		const span =
			Math.max(1, Math.ceil((ctx.requested.duration ?? fps * 60) / loop)) *
			loop;
		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		const add = (name: string, node: Animatable<LayoutNode>) => {
			parts[name] = node;
			children.push(node);
			return node;
		};

		add(
			"background",
			host.box({
				id: ctx.partId("background"),
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				background: props.background ?? c.bg,
			}),
		);

		if (props.kind === "mesh") {
			const count = Math.max(3, colors.length + 1);
			const r = ctx.rng("mesh");
			for (let i = 0; i < count; i++) {
				const size = Math.max(W, H) * (0.75 + r.next() * 0.35);
				const cx = W * (0.15 + 0.7 * ((i + r.next() * 0.6) / count));
				const cy = H * (0.25 + r.next() * 0.5);
				const ax = W * 0.16 * props.speed;
				const ay = H * 0.14 * props.speed;
				const color = colors[i % colors.length] as string;
				const blob = host.box({
					id: ctx.partId(`blob-${i}`),
					position: "absolute",
					x: 0,
					y: 0,
					width: size,
					height: size,
					background: `radial-gradient(closest-side, ${color} 0%, ${transparent(color)} 100%)`,
					opacity: Math.min(1, 0.6 * props.intensity),
				});
				// y on the blob, x on its carrier: one track each, each under the key limit.
				blob.animate(
					LayerAnimation.keys(
						"y",
						cosineKeys(
							cy - size / 2,
							ay,
							2,
							r.next() * Math.PI * 2,
							loop,
							span,
						),
					),
				);
				const carrier = host.box({
					id: ctx.partId(`blob-${i}-x`),
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					children: [blob],
				});
				carrier.animate(
					LayerAnimation.keys(
						"x",
						cosineKeys(
							cx - size / 2,
							ax * (r.next() < 0.5 ? -1 : 1),
							1,
							r.next() * Math.PI * 2,
							loop,
							span,
						),
					),
				);
				parts[`blob-${i}`] = blob;
				add(`blob-${i}-x`, carrier);
			}
		}

		if (props.kind === "grid" || props.kind === "dots") {
			const color = colors[0] as string;
			// Dots are bullet glyphs on a lattice: one text node draws hundreds
			// of them in a few milliseconds (a path of circles takes seconds).
			const dotSize = Math.max(6, cell * 0.3);
			const advance = host.measure("•", {
				fontFamily: theme.font.body,
				fontSize: dotSize,
			}).width;
			const dots = () => {
				const cols = Math.ceil(W / cell) + 3;
				const rows = Math.ceil(H / cell) + 3;
				return Array.from({ length: rows }, () => "•".repeat(cols)).join("\n");
			};
			const pattern = (name: string, opacity: number) => {
				const place = {
					id: ctx.partId(name),
					position: "absolute" as const,
					x: -cell,
					y: -cell,
					opacity: Math.min(1, opacity * props.intensity),
				};
				const node =
					props.kind === "grid"
						? host.shape("path", {
								...place,
								width: W + cell * 2,
								height: H + cell * 2,
								d: gridPath(W, H, cell),
								fillType: "none",
								strokeColor: color,
								strokeWidth: Math.max(1, s),
							})
						: host.text(dots(), {
								...place,
								fontFamily: theme.font.body,
								fontSize: dotSize,
								fill: color,
								letterSpacing: cell - advance,
								lineHeight: cell,
							});
				// One cell per loop, diagonally, snapping back on the loop frame.
				node.animate(
					LayerAnimation.create()
						.keys("x", slideKeys(-cell, cell, loop, span))
						.keys("y", slideKeys(-cell, cell, loop, span)),
				);
				return add(name, node);
			};
			pattern("pattern", props.kind === "grid" ? 0.1 : 0.16);
			if (props.glow ?? true) {
				// A brighter copy of the pattern, seen through a drifting light.
				const lit = pattern("pattern-lit", 0.5);
				const size = Math.max(W, H) * 0.7;
				const r = ctx.rng("glow");
				const lightKeys = {
					x: cosineKeys(
						W / 2 - size / 2,
						W * 0.3 * props.speed,
						1,
						r.next() * Math.PI * 2,
						loop,
						span,
					),
					y: cosineKeys(
						H / 2 - size / 2,
						H * 0.25 * props.speed,
						1,
						r.next() * Math.PI * 2,
						loop,
						span,
					),
				};
				const light = host.box({
					id: ctx.partId("glow-matte"),
					position: "absolute",
					x: lightKeys.x[0]?.[1] as number,
					y: lightKeys.y[0]?.[1] as number,
					width: size,
					height: size,
					background:
						"radial-gradient(closest-side, #fff 0%, rgba(255,255,255,0) 100%)",
				});
				light.animate(
					LayerAnimation.create().keys("x", lightKeys.x).keys("y", lightKeys.y),
				);
				host.matte(lit, light);
				parts["glow-matte"] = light;
				// A faint halo of the pattern colour where the light is.
				const halo = host.box({
					id: ctx.partId("glow"),
					position: "absolute",
					x: lightKeys.x[0]?.[1] as number,
					y: lightKeys.y[0]?.[1] as number,
					width: size,
					height: size,
					background: `radial-gradient(closest-side, ${color} 0%, ${transparent(color)} 100%)`,
					opacity: 0.18 * props.intensity,
				});
				halo.animate(
					LayerAnimation.create().keys("x", lightKeys.x).keys("y", lightKeys.y),
				);
				add("glow", halo);
			}
		}

		if (props.vignette > 0)
			add(
				"vignette",
				host.box({
					id: ctx.partId("vignette"),
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					background: `radial-gradient(rgba(0,0,0,0) 45%, rgba(0,0,0,${round(props.vignette)}) 100%)`,
				}),
			);

		// Grain is its own soft-light layer over everything else.
		if (props.grain !== false && props.grain > 0)
			add(
				"grain",
				host.grain({
					id: ctx.partId("grain"),
					x: 0,
					y: 0,
					width: W,
					height: H,
					strength: round(props.grain * 100),
				}),
			);
		const surface = host.box({
			id: ctx.partId("surface"),
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			overflow: "hidden",
			children,
		});
		parts.surface = surface;

		return {
			children: [surface],
			width: W,
			height: H,
			duration: null,
			origin: [0, 0],
			cues: {
				loops: Array.from({ length: span / loop }, (_, k) => ({
					frame: k * loop,
				})),
			} as BackdropCues,
			parts,
		};
	},
});

const round = (v: number) => Math.round(v * 1000) / 1000;

/** `#rrggbb` / `#rgb` at alpha 0 (same hue, so the fade has no dark fringe). */
function transparent(color: string): string {
	const hex = color.trim().replace(/^#/, "");
	const full =
		hex.length === 3
			? hex
					.split("")
					.map((h) => h + h)
					.join("")
			: hex.slice(0, 6);
	if (!/^[0-9a-f]{6}$/i.test(full)) return "rgba(0,0,0,0)";
	const n = Number.parseInt(full, 16);
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`;
}

/**
 * Keys for `centre + amplitude × cos(2π · cycles · f / loop + phase)` over
 * `span` frames (whole loops): the value at every loop start, and at each
 * extreme inside the loop. Between extremes `sine.inOut` is the cosine
 * exactly; the partial pieces at loop starts use `sine.out` / `sine.in`.
 * Every loop repeats the same keys, so the motion is exactly periodic.
 */
export function cosineKeys(
	centre: number,
	amplitude: number,
	cycles: number,
	phase: number,
	loop: number,
	span: number,
): KeyframeTuple[] {
	const at = (f: number) =>
		round(
			centre + amplitude * Math.cos((2 * Math.PI * cycles * f) / loop + phase),
		);
	if (amplitude === 0) return [[0, round(centre)]];
	// Extremes: 2π·cycles·f/loop + phase = nπ.
	const extremes: number[] = [];
	for (let n = -2; n <= cycles * 2 + 2; n++) {
		const f = Math.round(
			((n * Math.PI - phase) * loop) / (2 * Math.PI * cycles),
		);
		if (f > 0 && f < loop && !extremes.includes(f)) extremes.push(f);
	}
	extremes.sort((a, b) => a - b);
	const perLoop: KeyframeTuple[] = extremes.map((f, i) => [
		f,
		at(f),
		i === 0 ? "sine.out" : "sine.inOut",
	]);
	const loops = Math.max(
		1,
		Math.min(span / loop, Math.floor(MAX_KEYS / (perLoop.length + 1))),
	);
	const keys: KeyframeTuple[] = [];
	for (let k = 0; k < loops; k++) {
		keys.push(k === 0 ? [0, at(0)] : [k * loop, at(0), "sine.in"]);
		for (const [f, v, e] of perLoop)
			keys.push([k * loop + (f as number), v, e] as KeyframeTuple);
	}
	keys.push([loops * loop, at(0), "sine.in"]);
	return keys;
}

/** `from` → `from + by` linearly over each loop, snapping back on the loop frame. */
export function slideKeys(
	from: number,
	by: number,
	loop: number,
	span: number,
): KeyframeTuple[] {
	const loops = Math.max(1, Math.min(span / loop, Math.floor(MAX_KEYS / 2)));
	const keys: KeyframeTuple[] = [[0, from]];
	for (let k = 0; k < loops; k++) {
		keys.push([
			(k + 1) * loop - 1,
			round(from + (by * (loop - 1)) / loop),
			"linear",
		]);
		keys.push([(k + 1) * loop, from, "hold"]);
	}
	return keys;
}

function gridPath(W: number, H: number, cell: number): string {
	const w = W + cell * 2;
	const h = H + cell * 2;
	const parts: string[] = [];
	for (let x = 0; x <= w + 0.01; x += cell)
		parts.push(`M${round(x)} 0L${round(x)} ${round(h)}`);
	for (let y = 0; y <= h + 0.01; y += cell)
		parts.push(`M0 ${round(y)}L${round(w)} ${round(y)}`);
	return parts.join("");
}
