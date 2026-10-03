/**
 * Plate placement: where each shot sits on screen so its circle lands on the
 * ring. A plate is described per frame by a pose, the scale it is drawn at
 * and where its circle's centre ends up. Natural framing is scale 1 with the
 * circle wherever the camera put it; a locked pose maps the circle onto a
 * target. Free cuts blend from locked to natural after a cut ("release") and
 * back to locked before the next one ("gather"), so every cut is a match cut.
 */
import fs from "node:fs";
import { type Circle, type CircleTrack, circleAt } from "./circles.js";
import { asset } from "./paths.js";
import { FPS, H, W } from "./theme.js";

const TRACKS: Record<string, CircleTrack> = JSON.parse(
	fs.readFileSync(asset("circles.json"), "utf8"),
);

/** Frames a plate takes to settle from the match into its own framing, and to gather back. */
export const RELEASE = 26;
export const GATHER = 12;

export interface Pose {
	scale: number;
	cx: number;
	cy: number;
}

/** The shot's own circle at a clip time, in natural (cover-fit) framing. */
export function sourceCircle(shot: string, sec: number): Circle {
	const track = TRACKS[shot];
	if (!track)
		throw new Error(`no circle track for "${shot}" — run pnpm assets circles`);
	return circleAt(track, sec);
}

/**
 * Smallest scale (≥ 1) at which moving the circle's centre from `c` to `k`
 * still covers the whole frame — scaling about the centre keeps every edge
 * outside the frame only if each edge's distance grows enough.
 */
export function coverScale(c: Circle, k: { cx: number; cy: number }): number {
	return Math.max(
		1,
		k.cx / c.cx,
		(W - k.cx) / (W - c.cx),
		k.cy / c.cy,
		(H - k.cy) / (H - c.cy),
	);
}

export const natural = (c: Circle): Pose => ({ scale: 1, cx: c.cx, cy: c.cy });

/** Pose that puts circle `c` on `k`; `cover` keeps the frame filled (the circle may end up larger than `k`). */
export function lockTo(c: Circle, k: Circle, cover: boolean): Pose {
	const fit = k.r / c.r;
	return {
		scale: cover ? Math.max(fit, coverScale(c, k)) : fit,
		cx: k.cx,
		cy: k.cy,
	};
}

/**
 * Lerping scale and circle centre (not layer x/y) keeps the in-between poses
 * covering the frame whenever both ends do: the layer offset is linear in the
 * blend weight and so is the slack the scale buys.
 */
export const blend = (a: Pose, b: Pose, w: number): Pose => ({
	scale: a.scale + (b.scale - a.scale) * w,
	cx: a.cx + (b.cx - a.cx) * w,
	cy: a.cy + (b.cy - a.cy) * w,
});

/** Layer x/y for a full-frame plate (anchor at its centre) drawn at `pose`. */
export function layerOffset(c: Circle, pose: Pose): { x: number; y: number } {
	return {
		x: pose.cx - W / 2 - pose.scale * (c.cx - W / 2),
		y: pose.cy - H / 2 - pose.scale * (c.cy - H / 2),
	};
}

export const shown = (c: Circle, pose: Pose): Circle => ({
	cx: pose.cx,
	cy: pose.cy,
	r: c.r * pose.scale,
});

/** The circle a match cut lands on: A's circle where it is, as large as B needs to cover the frame. */
export function matchCircle(outgoing: Circle, incoming: Circle): Circle {
	return {
		cx: outgoing.cx,
		cy: outgoing.cy,
		r: Math.max(outgoing.r, incoming.r * coverScale(incoming, outgoing)),
	};
}

/** Clip time (seconds) of a cut-local frame. */
export const clipSec = (trim: number, local: number) => trim + local / FPS;

export const easeOutCubic = (t: number) =>
	1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
export const easeInCubic = (t: number) => Math.min(1, Math.max(0, t)) ** 3;
export const easeInOutExpo = (t: number) => {
	const x = Math.min(1, Math.max(0, t));
	if (x === 0 || x === 1) return x;
	return x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2;
};
