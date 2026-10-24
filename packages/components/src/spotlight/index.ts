/**
 * Spotlight: dims the frame except a region that glides between targets.
 * The dim layer is masked by an inverted matte (the hole), keyed between
 * target rects; a `"full"` step lifts the dim.
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
import type { Animatable } from "../core/host.js";
import { targetSchema } from "../core/schemas.js";
import { boundsOf, resolveTarget } from "../core/targets.js";
import { themeFrames } from "../core/theme.js";

export interface SpotlightCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Each move of the light, start to settle. */
	moves: ReadonlyArray<{ frame: number; end: number }>;
}

export const spotlight = /* @__PURE__ */ defineComponent({
	name: "Spotlight",
	props: () => ({
		/** Where the light goes and when; `"full"` lifts the dim. */
		targets: z
			.array(
				z
					.object({
						at: z.number().int().min(0),
						target: z.union([z.literal("full"), targetSchema()]),
						padding: z.number().min(0).optional(),
					})
					.strict(),
			)
			.min(1),
		/** How dark the rest gets, 0–1. */
		dim: z.number().min(0).max(1).default(0.68),
		color: z.string().default("#000000"),
		/** `rect`: rounded, crisp. `ellipse`: soft-edged pool of light. */
		shape: z.enum(["rect", "ellipse"]).default("rect"),
		radius: z.number().min(0).optional(),
		/** Soft edge of the ellipse, px. */
		feather: z.number().min(0).optional(),
		/** Frames each move takes. */
		glide: z.number().int().positive().optional(),
		/** Frames to follow a moving target before the next step. Default 6 seconds. */
		follow: z.number().int().positive().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1920 * s;
		const H = ctx.requested.height ?? 1080 * s;
		const glide =
			props.glide ?? Math.round(themeFrames(theme, "base", fps) * 1.6);
		const ease = theme.motion.ease.move;
		const feather = props.feather ?? 60 * s;
		const ellipse = props.shape === "ellipse";
		const steps = [...props.targets].sort((a, b) => a.at - b.at);

		// The hole's rect at each step (moving targets: one per frame until the next step).
		const keys = {
			x: [] as KeyframeTuple[],
			y: [] as KeyframeTuple[],
			width: [] as KeyframeTuple[],
			height: [] as KeyframeTuple[],
		};
		const dimKeys: KeyframeTuple[] = [[0, 0]];
		const moves: Array<{ frame: number; end: number }> = [];
		let lit = false;
		let current: Rect | null = null;
		const grow = (r: Rect, pad: number): Rect => {
			// An ellipse needs room around the rect to contain it, plus its soft edge.
			const k = ellipse ? Math.SQRT2 : 1;
			const w = r.width * k + pad * 2 + (ellipse ? feather * 2 : 0);
			const h = r.height * k + pad * 2 + (ellipse ? feather * 2 : 0);
			return {
				x: r.x + r.width / 2 - w / 2,
				y: r.y + r.height / 2 - h / 2,
				width: w,
				height: h,
			};
		};
		const put = (f: number, r: Rect, ease_?: string) => {
			for (const k of ["x", "y", "width", "height"] as const)
				keys[k].push(ease_ ? [f, r[k], ease_] : [f, r[k]]);
		};

		steps.forEach((step, i) => {
			const next = steps[i + 1]?.at ?? step.at + (props.follow ?? fps * 6);
			if (step.target === "full") {
				if (lit)
					dimKeys.push(
						[step.at, props.dim],
						[step.at + glide, 0, "power2.inOut"],
					);
				lit = false;
				return;
			}
			const pad = step.padding ?? 16 * s;
			const resolved = resolveTarget(step.target, {
				measure: host.measure,
				fps,
			});
			const rectAt = (f: number) =>
				grow(
					resolved.kind === "static"
						? boundsOf(resolved.rects)
						: resolved.at(f),
					pad,
				);
			const first = rectAt(step.at + glide);
			if (!current) {
				// The first light appears where it lands, as the dim comes up.
				put(step.at, first);
			} else {
				put(step.at, current);
				put(step.at + glide, first, ease);
			}
			if (!lit)
				dimKeys.push(
					[step.at, 0],
					[step.at + glide, props.dim, "power2.inOut"],
				);
			lit = true;
			moves.push({ frame: step.at, end: step.at + glide });
			current = first;
			if (resolved.kind === "dynamic") {
				// Ride the moving target until the next step.
				const from = step.at + glide;
				const samples = Array.from(
					{ length: Math.max(1, next - from) },
					(_, k) => rectAt(from + k),
				);
				for (const k of ["x", "y", "width", "height"] as const)
					for (const [f, v] of bakeSamples(
						samples.map((r) => r[k]),
						from,
						{ tolerance: 0.4 },
					).slice(1))
						keys[k].push([f, v]);
				current = samples[samples.length - 1] ?? first;
			}
		});

		const start = current ?? { x: W / 2, y: H / 2, width: 0, height: 0 };
		const firstKey = (k: "x" | "y" | "width" | "height") =>
			(keys[k][0]?.[1] as number | undefined) ?? start[k];
		const radius = props.radius ?? 18 * s;
		const hole = host.box({
			id: ctx.partId("hole"),
			position: "absolute",
			x: firstKey("x"),
			y: firstKey("y"),
			width: firstKey("width"),
			height: firstKey("height"),
			background: ellipse
				? `radial-gradient(closest-side, #ffffff ${Math.max(0, 100 - (feather / Math.max(1, Math.min(firstKey("width"), firstKey("height")) / 2)) * 100).toFixed(1)}%, rgba(255,255,255,0) 100%)`
				: "#ffffff",
			...(!ellipse && { borderRadius: radius }),
		});
		hole.animate(
			LayerAnimation.create()
				.keys("x", ascending(keys.x))
				.keys("y", ascending(keys.y))
				.keys("width", ascending(keys.width))
				.keys("height", ascending(keys.height)),
		);
		const shade = host.box({
			id: ctx.partId("dim"),
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			background: props.color,
			opacity: 0,
		});
		shade.animate(LayerAnimation.keys("opacity", ascending(dimKeys)));
		host.matte(shade, hole, "alpha-inverted");
		const parts: Record<string, Animatable<LayoutNode>> = { dim: shade, hole };

		const lastStep = steps[steps.length - 1] as (typeof steps)[number];
		return {
			children: [shade],
			width: W,
			height: H,
			duration: lastStep.at + glide,
			openEnded: true,
			origin: [0, 0],
			cues: { moves } as SpotlightCues,
			parts,
		};
	},
});

function ascending(keys: KeyframeTuple[]): KeyframeTuple[] {
	const out: KeyframeTuple[] = [];
	for (const k of keys) {
		while (out.length > 0 && (out[out.length - 1] as KeyframeTuple)[0] >= k[0])
			out.pop();
		out.push(k);
	}
	return out.length > 0 ? out : [[0, 0]];
}
