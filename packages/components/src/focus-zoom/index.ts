/**
 * FocusZoom: a camera over 2D content that pushes in on what matters and
 * eases back out — the auto-zoom of polished product demos. Give it shots,
 * or let it follow a MousePointer and frame each burst of clicks.
 */
import {
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bakeSamples } from "../core/bake.js";
import { defineComponent } from "../core/contract.js";
import type { Vec2 } from "../core/path.js";
import { targetSchema } from "../core/schemas.js";
import { boundsOf, resolveTarget, targetPoint } from "../core/targets.js";
import {
	type ClickEvent,
	type ShotWindow,
	shotsFromClicks,
	solveCamera,
} from "./plan.js";

/** What `follow` needs from a pointer (a MousePointer node has it). */
export interface Followable {
	positionAt(frame: number): Vec2;
	cues: { clicks: ReadonlyArray<{ frame: number; point: Vec2 }> };
}

/** A target, or "full" for the whole view. */
function shotTargetSchema() {
	return z.union([z.literal("full"), targetSchema()]);
}

export interface FocusZoomCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** One per shot: push starts (`frame`), lands (`settled`), lets go (`end`). */
	shots: ReadonlyArray<{
		frame: number;
		settled: number;
		end: number;
		zoom: number;
		center: Vec2;
	}>;
}

export interface FocusZoomApi {
	/** A content point → where it shows on screen (parent coordinates) at a parent frame. */
	toScreen(point: Vec2, frame: number): Vec2;
	/** Camera at a parent frame: the content point at the centre, and the zoom. */
	cameraAt(frame: number): { center: Vec2; zoom: number };
}

// Shutter angles. Camera moves scale everything at once, so even a little
// blur reads strongly: keep the default restrained.
const SMEAR = { subtle: 24, standard: 60, heavy: 140 } as const;

export const focusZoom = /* @__PURE__ */ defineComponent({
	name: "FocusZoom",
	props: () => ({
		/** What the camera films, laid out at full size in the view's coordinates. */
		content: z.custom<LayoutNode | LayoutNode[]>(
			(v) => typeof v === "object" && v !== null,
		),
		/** Manual shots: from `at` until the next shot (or `hold` frames). */
		shots: z
			.array(
				z
					.object({
						at: z.number().int().min(0),
						target: shotTargetSchema(),
						zoom: z.number().min(1).optional(),
						hold: z.number().int().positive().optional(),
					})
					.strict(),
			)
			.optional(),
		/** Follow a pointer: push in around each burst of clicks. */
		follow: z
			.custom<Followable>(
				(v) =>
					typeof v === "object" &&
					v !== null &&
					typeof (v as Followable).positionAt === "function",
				{
					message:
						"Expected a MousePointer (anything with positionAt and cues.clicks)",
				},
			)
			.optional(),
		/** Zoom for a shot without its own. */
		zoom: z.number().min(1).default(1.8),
		maxZoom: z.number().min(1).default(2.5),
		/** Frames the push starts before a click (it always lands before the click). Default: about a second. */
		lead: z.number().int().min(0).optional(),
		/** Frames without a click before easing back out. */
		idle: z.number().int().min(0).default(40),
		/** 0 = quick camera moves, 1 = slow, soft ones. */
		smoothing: z.number().min(0).max(1).default(0.5),
		/** Space kept around click points / targets. */
		padding: z.number().min(0).default(160),
		/** Never show past the content's edges. */
		clamp: z.boolean().default(true),
		/** When zoomed, keep the view inside this region (e.g. the app window). */
		bounds: shotTargetSchema().optional(),
		/** Motion blur while the camera moves. */
		smear: z
			.union([z.literal(false), z.enum(["subtle", "standard", "heavy"])])
			.default("subtle"),
		/** Frames to solve. Default: through the last shot plus its return. */
		length: z.number().int().positive().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, fps } = ctx;
		const W = ctx.requested.width ?? ctx.canvas.width;
		const H = ctx.requested.height ?? ctx.canvas.height;
		// By default the push starts early enough to run at its natural pace.
		const lead =
			props.lead ?? Math.round((0.55 + 0.75 * props.smoothing) * fps) + 2;

		const shots: ShotWindow[] = [];
		if (props.follow) {
			const pointer = props.follow;
			// Click frames are in the pointer's parent timeline — the content —
			// which starts with this component.
			const clicks: ClickEvent[] = pointer.cues.clicks.map((c) => ({
				frame: c.frame,
				point: c.point,
			}));
			shots.push(
				...shotsFromClicks(clicks, {
					width: W,
					height: H,
					lead,
					idle: props.idle,
					zoom: props.zoom,
					maxZoom: props.maxZoom,
					padding: props.padding,
				}),
			);
		}
		const manual = [...(props.shots ?? [])].sort((a, b) => a.at - b.at);
		manual.forEach((shot, i) => {
			const next = manual[i + 1];
			const end =
				shot.hold !== undefined
					? shot.at + shot.hold
					: (next?.at ?? shot.at + Math.round(fps * 3));
			if (shot.target === "full") {
				shots.push({ start: shot.at, end, zoom: 1, center: [W / 2, H / 2] });
				return;
			}
			const resolved = resolveTarget(shot.target, {
				measure: host.measure,
				fps,
			});
			if (resolved.kind === "dynamic") {
				shots.push({
					start: shot.at,
					end,
					zoom: shot.zoom ?? props.zoom,
					center: (f) => targetPoint(resolved, f),
				});
				return;
			}
			const r = boundsOf(resolved.rects);
			const fit = Math.min(
				W / (r.width + props.padding * 2),
				H / (r.height + props.padding * 2),
			);
			const zoom = Math.min(
				props.maxZoom,
				shot.zoom ?? Math.max(1, Math.min(props.zoom, fit)),
			);
			shots.push({
				start: shot.at,
				end,
				zoom,
				center: [r.x + r.width / 2, r.y + r.height / 2],
			});
		});
		shots.sort((a, b) => a.start - b.start);

		const lastEnd = Math.max(0, ...shots.map((s) => s.end));
		const length = props.length ?? lastEnd + Math.round(fps * 1.5) + 1;
		let bounds:
			| { x: number; y: number; width: number; height: number }
			| undefined;
		if (props.bounds !== undefined && props.bounds !== "full") {
			const resolved = resolveTarget(props.bounds, {
				measure: host.measure,
				fps,
			});
			if (resolved.kind !== "static")
				throw new Error("FocusZoom: `bounds` must be a static target.");
			bounds = boundsOf(resolved.rects);
		}
		const plan = solveCamera({
			width: W,
			height: H,
			length,
			fps,
			shots,
			smoothing: props.smoothing,
			clamp: props.clamp,
			bounds,
		});

		const camera = host.box({
			id: ctx.partId("camera"),
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			anchorX: 0,
			anchorY: 0,
			...(props.smear !== false && { motionBlurShutter: SMEAR[props.smear] }),
			children: Array.isArray(props.content) ? props.content : [props.content],
		});
		camera.animate(
			LayerAnimation.keys("x", bakeSamples(plan.x, 0, { tolerance: 0.15 })),
			LayerAnimation.keys("y", bakeSamples(plan.y, 0, { tolerance: 0.15 })),
			LayerAnimation.keys(
				"scale",
				bakeSamples(plan.scale, 0, { tolerance: 0.0004 }),
			),
		);
		const clip = host.box({
			id: ctx.partId("clip"),
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			overflow: "hidden",
			children: [camera],
		});

		const stateAt = (local: number) =>
			plan.states[
				Math.max(0, Math.min(plan.states.length - 1, Math.round(local)))
			] ?? { cx: W / 2, cy: H / 2, zoom: 1 };
		return {
			children: [clip],
			width: W,
			height: H,
			duration: null,
			origin: [0, 0],
			cues: { shots: plan.shots } as FocusZoomCues,
			parts: { camera, clip },
			api: (placement): FocusZoomApi => ({
				toScreen(point, frame) {
					const s = stateAt(frame - placement.start);
					return [
						placement.x + W / 2 + (point[0] - s.cx) * s.zoom,
						placement.y + H / 2 + (point[1] - s.cy) * s.zoom,
					];
				},
				cameraAt(frame) {
					const s = stateAt(frame - placement.start);
					return { center: [s.cx, s.cy], zoom: s.zoom };
				},
			}),
		};
	},
});
