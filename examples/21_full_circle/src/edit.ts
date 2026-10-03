/**
 * The edit, written in bars of the measured score. Each cut is a shot, a slice
 * of the timeline and a trim into the clip; the planner below works out where
 * the ring sits at every cut so consecutive circles match.
 *
 *   bars 0–5    eclipse → iris → porthole, one per phrase, porthole closes into the ring
 *   bar  5–5¾   the score's hush: black, the ring alone, "Everything that turns"
 *   bars 5¾–9   crema opens out of the ring, record
 *   bars 9–11   the build: every circle flickers through the ring as a window
 *   bars 11–13  the drop: the window bursts open on the dancer
 *   bars 13–15  one circle per beat, all locked to one ring
 *   bars 15–end tunnel ("comes back around"), the moon, the title
 */
import type { Circle } from "./circles.js";
import { bar, DROP, DURATION } from "./grid.js";
import {
	blend,
	clipSec,
	easeInCubic,
	easeInOutExpo,
	easeOutCubic,
	GATHER,
	lockTo,
	matchCircle,
	natural,
	type Pose,
	RELEASE,
	shown,
	sourceCircle,
} from "./plates.js";
import { FPS, H, W } from "./theme.js";

export type Treatment = "duotone";
export type RingMode = "carry" | "on";

export interface Cut {
	id: string;
	/** Shot id, or null for a black frame that only shows the ring. */
	shot: string | null;
	from: number;
	to: number;
	/** Seconds into the clip at `from`. */
	trim: number;
	/** Pin the circle to this ring for the whole cut (montages, the hush). */
	hold?: Circle;
	/** Show only the inside of the ring. */
	window?: boolean;
	/** For held cuts: the shot's circle is drawn at this fraction of the ring, so its surroundings show too. */
	inset?: number;
	/** Frames the window takes to open from the ring to full frame. */
	open?: number;
	/** Frames the frame takes to close down to the ring before the cut. */
	close?: number;
	treat?: Treatment;
	ring?: RingMode;
	/** Name the circle under the frame (off where the orbiting title is the type). */
	label?: boolean;
}

const CENTER = { cx: W / 2, cy: H / 2 };
export const HUSH_RING: Circle = { ...CENTER, r: 250 };
export const WINDOW_RING: Circle = { ...CENTER, r: 250 };
export const BEAT_RING: Circle = { ...CENTER, r: 300 };

/** Bar where the score falls silent before the second build. */
export const HUSH = 5;

/** Beat-length cuts locked to one ring, in order. */
function montage(
	prefix: string,
	from: number,
	step: number,
	shots: [string, number][],
	ring: Circle,
	extra: Partial<Cut> = {},
): Cut[] {
	return shots.map(([shot, trim], i) => ({
		id: `${prefix}-${i}`,
		shot,
		from: bar(from + i * step),
		to: bar(from + (i + 1) * step),
		trim,
		hold: ring,
		ring: "on",
		...extra,
		treat: extra.treat && i % 2 === 1 ? extra.treat : undefined,
	}));
}

/** Through the window the circles sit a little inside the ring: the corona, the iris, the vinyl show. */
const BUILD: Partial<Cut> = { window: true, inset: 0.6 };

const BEAT_MONTAGE = DROP + 2;
/** The montage's last beat is the tunnel; the tunnel cut continues that same take. */
const TUNNEL_BEAT = 0.6;
const TUNNEL_IN =
	TUNNEL_BEAT + (bar(BEAT_MONTAGE + 2) - bar(BEAT_MONTAGE + 1.75)) / FPS;

export const CUTS: Cut[] = [
	{ id: "eclipse", shot: "eclipse", from: 0, to: bar(2), trim: 0 },
	{ id: "iris", shot: "iris", from: bar(2), to: bar(4), trim: 1.2 },
	{
		id: "porthole",
		shot: "porthole",
		from: bar(4),
		to: bar(HUSH),
		trim: 1.5,
		close: bar(HUSH) - bar(HUSH - 0.25),
	},
	// The score re-enters a beat ahead of the bar: the crema opens on it.
	{
		id: "hush",
		shot: null,
		from: bar(HUSH),
		to: bar(HUSH + 0.75),
		trim: 0,
		hold: HUSH_RING,
		ring: "on",
	},
	{
		id: "crema",
		shot: "crema",
		from: bar(HUSH + 0.75),
		to: bar(7.5),
		trim: 0.8,
		open: 14,
	},
	{ id: "record", shot: "record", from: bar(7.5), to: bar(9), trim: 0.3 },
	...montage(
		"build-a",
		9,
		0.5,
		[
			["eclipse", 3.2],
			["iris", 4.2],
		],
		WINDOW_RING,
		BUILD,
	),
	...montage(
		"build-b",
		10,
		0.25,
		[
			["porthole", 3.4],
			["moon", 2.0],
			["crema", 3.6],
			["tunnel", 3.0],
		],
		WINDOW_RING,
		BUILD,
	),
	{
		id: "drop",
		shot: "spotlight",
		from: bar(DROP),
		to: bar(BEAT_MONTAGE),
		trim: 2.3,
		open: 10,
		ring: "on",
		label: false,
	},
	...montage(
		"beat",
		BEAT_MONTAGE,
		0.25,
		[
			["eclipse", 5.0],
			["iris", 5.0],
			["porthole", 4.4],
			["crema", 4.8],
			["record", 5.2],
			["moon", 5.0],
			["spotlight", 5.5],
			["tunnel", TUNNEL_BEAT],
		],
		BEAT_RING,
		{ treat: "duotone", label: false },
	),
	{
		id: "tunnel",
		shot: "tunnel",
		from: bar(BEAT_MONTAGE + 2),
		to: bar(BEAT_MONTAGE + 4),
		trim: TUNNEL_IN,
	},
	{
		id: "moon",
		shot: "moon",
		from: bar(BEAT_MONTAGE + 4),
		to: DURATION,
		trim: 0.8,
		label: false,
	},
];

export interface PlannedCut extends Cut {
	/** Ring the cut enters on (matched to the previous cut). */
	kIn?: Circle;
	/** Ring the cut leaves on (matched to the next cut). */
	kOut?: Circle;
}

/** Where a held cut puts its shot's circle. */
const holdTarget = (hold: Circle, inset = 1): Circle => ({
	...hold,
	r: hold.r * inset,
});

/** Where a cut's circle (or its window's edge) sits on its first or last frame, before any matching. */
function edgeCircle(cut: Cut, at: "in" | "out"): Circle | null {
	if (!cut.shot || cut.window) return cut.hold ?? null;
	const local = at === "in" ? 0 : cut.to - cut.from;
	const c = sourceCircle(cut.shot, clipSec(cut.trim, local));
	return cut.hold
		? shown(c, lockTo(c, holdTarget(cut.hold, cut.inset), true))
		: c;
}

export function plan(cuts: Cut[]): PlannedCut[] {
	const out: PlannedCut[] = cuts.map((c) => ({ ...c }));
	for (let i = 0; i + 1 < out.length; i++) {
		const a = out[i];
		const b = out[i + 1];
		if (a.to !== b.from) continue;
		const ca = edgeCircle(a, "out");
		const cb = edgeCircle(b, "in");
		if (!ca || !cb) continue;
		const k = b.hold ? b.hold : a.hold ? ca : matchCircle(ca, cb);
		if (!a.hold) a.kOut = k;
		if (!b.hold) b.kIn = k;
	}
	return out;
}

export const EDIT = plan(CUTS);

/** The plate's pose on a cut-local frame. */
export function poseAt(
	cut: PlannedCut,
	local: number,
): { c: Circle; pose: Pose } {
	if (!cut.shot) throw new Error(`cut ${cut.id} has no plate`);
	const c = sourceCircle(cut.shot, clipSec(cut.trim, local));
	const cover = !cut.window;
	if (cut.hold)
		return { c, pose: lockTo(c, holdTarget(cut.hold, cut.inset), cover) };
	const len = cut.to - cut.from;
	let pose = natural(c);
	if (cut.kIn) {
		const w = 1 - easeOutCubic(local / Math.min(RELEASE, len / 2));
		pose = blend(pose, lockTo(c, cut.kIn, cover), w);
	}
	if (cut.kOut) {
		// Fully gathered on the last frame shown, so the cut lands exactly on the match.
		const span = Math.min(GATHER, len / 2);
		pose = blend(
			pose,
			lockTo(c, cut.kOut, cover),
			easeInCubic((local - (len - 1 - span)) / span),
		);
	}
	return { c, pose };
}

/** Radius at which a circle centred on `k` covers the frame: its farthest corner. */
const fullRadius = (k: Circle) =>
	Math.hypot(Math.max(k.cx, W - k.cx), Math.max(k.cy, H - k.cy));

/** Visible window radius on a cut-local frame, or null when the whole frame shows. */
export function windowAt(cut: PlannedCut, local: number): Circle | null {
	const len = cut.to - cut.from;
	if (cut.window && cut.hold) return cut.hold;
	if (cut.open && cut.kIn && local < cut.open) {
		const t = easeInOutExpo(local / cut.open);
		return { ...cut.kIn, r: cut.kIn.r + (fullRadius(cut.kIn) - cut.kIn.r) * t };
	}
	if (cut.close && cut.kOut && local >= len - 1 - cut.close) {
		const t = easeInOutExpo((local - (len - 1 - cut.close)) / cut.close);
		const full = fullRadius(cut.kOut);
		return { ...cut.kOut, r: full + (cut.kOut.r - full) * t };
	}
	return null;
}

/** The ring on a cut-local frame: the window's edge while one is animating, otherwise the plate's circle. */
export function ringAt(cut: PlannedCut, local: number): Circle {
	const win = windowAt(cut, local);
	if (win) return win;
	if (!cut.shot) return cut.hold as Circle;
	const { c, pose } = poseAt(cut, local);
	return shown(c, pose);
}

/** Cuts that show the plate through a circular window at some point. */
export function needsMask(cut: Cut): boolean {
	return Boolean(cut.window || cut.open || cut.close);
}
