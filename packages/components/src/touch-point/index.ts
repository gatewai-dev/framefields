/**
 * TouchPoint: fingers on glass, drawn the way screen recordings show
 * touches: a soft disc that lands, presses and lifts, with a ripple. Taps,
 * double taps, long presses and swipes. Between touches the finger is
 * lifted, so nothing travels: each touch is its own disc.
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
import { dist, type Vec2 } from "../core/path.js";
import { targetSchema } from "../core/schemas.js";
import { resolveTarget, type Target, targetPoint } from "../core/targets.js";
import { scaleFrames } from "../core/timing.js";

export interface TouchPointCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Each tap's touch-down. */
	taps: ReadonlyArray<{ frame: number; point: Vec2 }>;
	/** Long presses, down to lift. */
	presses: ReadonlyArray<{ frame: number; end: number; point: Vec2 }>;
	/** Swipes, from the start of the move to its end. */
	swipes: ReadonlyArray<{ frame: number; end: number; from: Vec2; to: Vec2 }>;
	/** Every touch-down. */
	touches: ReadonlyArray<{ frame: number; point: Vec2 }>;
}

/** One planned touch, in local frames. */
export interface PlannedTouch {
	point: Vec2;
	/** Disc starts landing. */
	lead: number;
	/** Taps: down frames; presses and swipes: one. */
	downs: number[];
	/** Swipe: move window and destination. */
	swipe?: { start: number; end: number; to: Vec2 };
	/** Finger leaves the glass. */
	lift: number;
	kind: "tap" | "press" | "swipe";
	pressEnd?: number;
}

export const touchPoint = /* @__PURE__ */ defineComponent({
	name: "TouchPoint",
	props: () => ({
		touches: z
			.array(
				z
					.object({
						to: targetSchema(),
						/** Touch-down frame. Default: after the previous touch. */
						at: z.number().int().min(0).optional(),
						/** Tap count. */
						tap: z.number().int().positive().optional(),
						/** Long press: frames held. */
						press: z.number().int().positive().optional(),
						/** Drag to here and lift. */
						swipe: targetSchema().optional(),
						/** Frames to wait after this touch. */
						dwell: z.number().int().min(0).optional(),
					})
					.strict(),
			)
			.min(1),
		size: z.number().positive().optional(),
		color: z.string().default("#ffffff"),
		opacity: z.number().min(0).max(1).default(0.55),
		ripple: z.boolean().default(true),
		trail: z.boolean().default(true),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1920 * s;
		const H = ctx.requested.height ?? 1080 * s;
		const size = props.size ?? 64 * s;
		const f = (n: number) => scaleFrames(n, fps);
		const pointOf = (t: Target, at: number) =>
			targetPoint(resolveTarget(t, { measure: host.measure, fps }), at);

		const plan = planTouches(
			props.touches.map((t) => ({
				at: t.at,
				tap: t.tap,
				press: t.press,
				dwell: t.dwell,
				point: (frame: number) => pointOf(t.to, frame),
				swipe: t.swipe
					? (frame: number) => pointOf(t.swipe as Target, frame)
					: undefined,
			})),
			fps,
		);

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		const ringFrames = f(16);
		const lead = f(4);
		plan.forEach((touch, i) => {
			const press: KeyframeTuple[] = [
				[touch.lead, 1.25],
				[touch.lead + lead, 1, "power2.out"],
			];
			for (const d of touch.downs.slice(1)) {
				// Between taps the finger lifts a little and comes back down.
				press.push([d - f(3), 1.1, "power2.out"], [d, 1, "power2.in"]);
			}
			if (touch.kind === "press" && touch.pressEnd !== undefined)
				press.push([touch.pressEnd, 0.88, "sine.inOut"]);
			press.push(
				[touch.lift, touch.kind === "press" ? 0.88 : 1],
				[touch.lift + f(6), 1.2, "power2.out"],
			);
			const anim = LayerAnimation.create()
				.keys("opacity", [
					[touch.lead, 0],
					[touch.lead + lead, props.opacity, "power2.out"],
					[touch.lift, props.opacity],
					[touch.lift + f(6), 0, "power2.in"],
				])
				.keys("scale", ascending(press));
			if (touch.swipe) {
				const { start, end, to } = touch.swipe;
				anim
					.keys("x", [
						[start, touch.point[0] - size / 2],
						[end, to[0] - size / 2, "power2.inOut"],
					])
					.keys("y", [
						[start, touch.point[1] - size / 2],
						[end, to[1] - size / 2, "power2.inOut"],
					]);
			}
			const disc = host.box({
				id: ctx.partId(`touch-${i}`),
				position: "absolute",
				x: touch.point[0] - size / 2,
				y: touch.point[1] - size / 2,
				width: size,
				height: size,
				background: `radial-gradient(closest-side, ${props.color} 0%, ${props.color} 72%, rgba(255,255,255,0) 100%)`,
				borderRadius: size / 2,
				borderColor: props.color,
				borderWidth: Math.max(1, 1.5 * s),
				opacity: 0,
			});
			disc.animate(anim);
			host.style(disc, {
				dropShadow: {
					color: "#000000",
					opacity: 0.25,
					angle: 90,
					distance: 2 * s,
					size: 10 * s,
				},
			});

			// Ghosts that lag behind a swipe: a short fading streak.
			if (touch.swipe && props.trail) {
				const { start, end, to } = touch.swipe;
				[2, 4, 6].forEach((lag, g) => {
					const ghost = host.box({
						id: ctx.partId(`touch-${i}-trail-${g}`),
						position: "absolute",
						x: touch.point[0] - size / 2,
						y: touch.point[1] - size / 2,
						width: size,
						height: size,
						background: props.color,
						borderRadius: size / 2,
						opacity: 0,
						scale: 0.85 - g * 0.15,
					});
					const o = props.opacity * (0.35 - g * 0.1);
					ghost.animate(
						LayerAnimation.create()
							.keys("x", [
								[start + f(lag), touch.point[0] - size / 2],
								[end + f(lag), to[0] - size / 2, "power2.inOut"],
							])
							.keys("y", [
								[start + f(lag), touch.point[1] - size / 2],
								[end + f(lag), to[1] - size / 2, "power2.inOut"],
							])
							.keys("opacity", [
								[start, 0],
								[start + f(lag), o],
								[end + f(lag), 0, "power2.in"],
							]),
					);
					parts[`touch-${i}-trail-${g}`] = ghost;
					children.push(ghost);
				});
			}

			if (props.ripple && touch.kind !== "swipe") {
				const rings =
					touch.kind === "press" ? [touch.downs[0] as number] : touch.downs;
				rings.forEach((d, r) => {
					const ring = host.box({
						id: ctx.partId(`touch-${i}-ripple-${r}`),
						position: "absolute",
						x: touch.point[0] - size / 2,
						y: touch.point[1] - size / 2,
						width: size,
						height: size,
						borderRadius: size / 2,
						borderColor: props.color,
						borderWidth: Math.max(1.5, 2.5 * s),
						opacity: 0,
					});
					const span =
						touch.kind === "press"
							? Math.max(ringFrames, (touch.pressEnd ?? d) - d)
							: ringFrames;
					ring.animate(
						LayerAnimation.create()
							.keys("scale", [
								[d, 0.6],
								[d + span, 2.2, "power2.out"],
							])
							.keys("opacity", [
								[0, 0],
								[d, 0.7, "hold"],
								[d + span, 0, "power1.out"],
							]),
					);
					parts[`touch-${i}-ripple-${r}`] = ring;
					children.push(ring);
				});
			}
			parts[`touch-${i}`] = disc;
			children.push(disc);
		});

		const last = Math.max(
			...plan.map((t) => t.lift + f(6)),
			...plan.map((t) => (t.downs.at(-1) ?? 0) + ringFrames),
		);
		return {
			children,
			width: W,
			height: H,
			duration: last,
			origin: [0, 0],
			cues: {
				taps: plan.flatMap((t) =>
					t.kind === "tap"
						? t.downs.map((frame) => ({ frame, point: t.point }))
						: [],
				),
				presses: plan
					.filter((t) => t.kind === "press")
					.map((t) => ({
						frame: t.downs[0] as number,
						end: t.lift,
						point: t.point,
					})),
				swipes: plan.flatMap((t) =>
					t.swipe
						? [
								{
									frame: t.swipe.start,
									end: t.swipe.end,
									from: t.point,
									to: t.swipe.to,
								},
							]
						: [],
				),
				touches: plan.flatMap((t) =>
					t.downs.map((frame) => ({ frame, point: t.point })),
				),
			} as TouchPointCues,
			parts,
		};
	},
});

interface TouchInput {
	at?: number;
	tap?: number;
	press?: number;
	dwell?: number;
	point: (frame: number) => Vec2;
	swipe?: (frame: number) => Vec2;
}

/** Touch timing: lead-in, downs, presses, swipe moves and lifts. Pure. */
export function planTouches(
	touches: readonly TouchInput[],
	fps: number,
): PlannedTouch[] {
	const f = (n: number) => scaleFrames(n, fps);
	const lead = f(4);
	let free = lead;
	return touches.map((t) => {
		const down = t.at ?? free;
		const point = t.point(down);
		let lift: number;
		let out: PlannedTouch;
		if (t.swipe) {
			const start = down + f(3);
			const to0 = t.swipe(start);
			const d = dist(point, to0);
			const move = Math.max(
				f(6),
				Math.round((0.16 + 0.1 * Math.log2(1 + d / 40)) * fps),
			);
			const end = start + move;
			lift = end + f(2);
			out = {
				point,
				lead: Math.max(0, down - lead),
				downs: [down],
				swipe: { start, end, to: t.swipe(end) },
				lift,
				kind: "swipe",
			};
		} else if (t.press) {
			lift = down + t.press;
			out = {
				point,
				lead: Math.max(0, down - lead),
				downs: [down],
				lift,
				kind: "press",
				pressEnd: down + Math.min(t.press, f(8)),
			};
		} else {
			const n = t.tap ?? 1;
			const downs = Array.from({ length: n }, (_, k) => down + k * f(9));
			lift = (downs.at(-1) as number) + f(4);
			out = { point, lead: Math.max(0, down - lead), downs, lift, kind: "tap" };
		}
		free = lift + f(6) + (t.dwell ?? f(14)) + lead;
		return out;
	});
}

/** Later keys on a shared frame win; frames ascend. */
function ascending(keys: KeyframeTuple[]): KeyframeTuple[] {
	const byFrame = new Map<number, KeyframeTuple>();
	for (const k of keys) byFrame.set(k[0] as number, k);
	return [...byFrame.values()].sort(
		(a, b) => (a[0] as number) - (b[0] as number),
	);
}
