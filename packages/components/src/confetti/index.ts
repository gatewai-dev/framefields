/**
 * Confetti: celebration bursts of paper, ribbons and sparkles that arc up,
 * flutter down and, with a floor, settle. Simulated on the GPU (one particle
 * system per palette colour and origin), deterministic per seed; bursts can
 * come straight from another component's cues.
 *
 * Coordinates are the frame's: the root covers the video (default
 * 1920 × 1080 × theme scale, or the given width / height) from 0, 0.
 */
import type { LayoutNode } from "@framefields/compositions/program";
import { z } from "zod";
import { defineComponent } from "../core/contract.js";
import type { Animatable, ParticleOptions } from "../core/host.js";
import type { Vec2 } from "../core/path.js";
import { targetSchema } from "../core/schemas.js";
import { resolveTarget, targetPoint } from "../core/targets.js";

export interface ConfettiCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	bursts: ReadonlyArray<{ frame: number; origin: Vec2 }>;
}

export const confetti = /* @__PURE__ */ defineComponent({
	name: "Confetti",
	props: () => ({
		bursts: z
			.array(
				z
					.object({
						at: z.number().int().min(0),
						/** Where it bursts from: a point, rect, node or text. */
						origin: targetSchema(),
						/** Paper pieces in this burst. */
						count: z.number().int().positive().default(140),
						/** Launch direction, degrees (−90 = up). */
						direction: z.number().default(-90),
						/** Cone width, degrees. */
						spread: z.number().min(0).max(360).default(70),
						/** Launch strength multiplier. */
						power: z.number().positive().default(1),
					})
					.strict(),
			)
			.min(1),
		/** Paper colours. Default: the theme's accents. */
		palette: z.array(z.string()).min(1).optional(),
		/** px/s². */
		gravity: z.number().min(0).optional(),
		/** A floor that pieces land on: `true` for the frame's bottom, or a y. */
		floor: z.union([z.boolean(), z.number()]).default(false),
		/** Fine streamers among the paper. */
		ribbons: z.boolean().default(true),
		/** A flash of glints at each burst. */
		sparkles: z.boolean().default(true),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1920 * s;
		const H = ctx.requested.height ?? 1080 * s;
		const c = theme.color;
		const palette = props.palette ?? [
			c.accent,
			c.accent2,
			c.highlight,
			c.positive,
			c.negative,
		];
		const gravity = props.gravity ?? 1500 * s;
		const floor =
			props.floor === false
				? undefined
				: props.floor === true
					? H - 6 * s
					: props.floor;
		const lifetime: [number, number] =
			floor === undefined ? [2.6, 4] : [5, 6.5];

		// Bursts that share an origin share systems.
		const origins = new Map<
			string,
			{ point: Vec2; bursts: Array<(typeof props.bursts)[number]> }
		>();
		const cues: Array<{ frame: number; origin: Vec2 }> = [];
		for (const b of props.bursts) {
			const point = targetPoint(
				resolveTarget(b.origin, { measure: host.measure, fps }),
				b.at,
			);
			const key = `${point[0].toFixed(1)},${point[1].toFixed(1)},${b.direction},${b.spread},${b.power}`;
			const entry = origins.get(key) ?? { point, bursts: [] };
			entry.bursts.push(b);
			origins.set(key, entry);
			cues.push({ frame: b.at, origin: point });
		}

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		let n = 0;
		const system = (
			name: string,
			o: Omit<ParticleOptions, "x" | "y" | "width" | "height" | "id" | "seed">,
		) => {
			const node = host.particles({
				id: ctx.partId(name),
				x: 0,
				y: 0,
				width: W,
				height: H,
				seed: ctx.seed * 101 + n++,
				...o,
			});
			parts[name] = node;
			children.push(node);
		};

		[...origins.values()].forEach(({ point, bursts }, o) => {
			const first = bursts[0] as (typeof bursts)[number];
			const emitter = (share: number) => ({
				shape: "point" as const,
				x: point[0],
				y: point[1],
				rate: 0,
				bursts: bursts.map((b) => ({
					frame: b.at,
					count: Math.max(1, Math.round(b.count * share)),
				})),
			});
			const total = Math.max(...bursts.map((b) => b.count));
			const launch = {
				direction: first.direction,
				spread: first.spread,
				speed: [1100 * s * first.power, 2100 * s * first.power] as [
					number,
					number,
				],
				gravity,
				drag: 1.1,
				// Paper wanders as it falls: curl noise reads as flutter.
				noise: { strength: 260 * s, scale: 0.004 / s, speed: 1.4 },
				lifetime,
				...(floor !== undefined && { floor, bounce: 0.08 }),
			};
			palette.forEach((color, k) => {
				system(`paper-${o}-${k}`, {
					...launch,
					max: Math.ceil(total / palette.length) * bursts.length + 8,
					emitter: emitter(1 / palette.length),
					shape: "square",
					size: [13 * s, 11 * s],
					sizeJitter: 0.45,
					fade: [0.01, floor === undefined ? 0.25 : 0.12],
					color,
				});
			});
			if (props.ribbons)
				system(`ribbons-${o}`, {
					...launch,
					max: Math.ceil(total * 0.2) * bursts.length + 8,
					emitter: emitter(0.2),
					shape: "spark",
					stretch: 0.03,
					size: [5 * s, 4 * s],
					sizeJitter: 0.3,
					fade: [0.01, 0.3],
					color: palette.slice(0, 3),
				});
			if (props.sparkles)
				system(`sparkles-${o}`, {
					max: 80 * bursts.length,
					emitter: emitter(0.35),
					direction: first.direction,
					spread: Math.min(360, first.spread * 1.6),
					speed: [300 * s, 900 * s],
					gravity: gravity * 0.15,
					drag: 2.4,
					lifetime: [0.35, 0.8],
					shape: "soft",
					size: [14 * s, 0],
					sizeJitter: 0.5,
					fade: [0, 0.5],
					blend: "add",
					color: ["#ffffff", c.highlight],
				});
		});

		const last = Math.max(...props.bursts.map((b) => b.at));
		return {
			children,
			width: W,
			height: H,
			duration: last + Math.ceil(lifetime[1] * fps),
			origin: [0, 0],
			cues: { bursts: cues } as ConfettiCues,
			parts,
		};
	},
});
