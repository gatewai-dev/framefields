/**
 * The pointer planner: waypoints in, a frame-by-frame performance out
 * (position, press state, cursor style, cues). Pure and deterministic; the
 * component turns the result into keyframes.
 *
 * Timing per waypoint: travel → arrive → (settle, press, release)×clicks or
 * a press-drag-release → dwell → leave for the next one.
 */
import { evaluateEase } from "../core/ease.js";
import { dist, type Vec2 } from "../core/path.js";
import { hashRng } from "../core/rng.js";
import type { CursorStyle } from "./glyphs.js";

export type MotionFeel = "natural" | "swift" | "lazy" | "linear";

/** A point that may move (tracked targets) — sampled per frame. */
export type PointAt = (frame: number) => Vec2;

export interface PlannedWaypoint {
	point: PointAt;
	/** Arrival frame; derived from distance when omitted. */
	at?: number;
	/** Frames to rest after the action. */
	dwell?: number;
	/** Clicks on arrival. */
	clicks?: number;
	/** Frames the button stays down per click. */
	hold?: number;
	/** Press here and drag to this point. */
	drag?: PointAt;
	/** Cursor style from this waypoint on. */
	cursor?: CursorStyle;
	/** Id of the target, reported on click cues. */
	targetId?: string;
}

export interface HoverRegion {
	rect: { x: number; y: number; width: number; height: number };
	style: CursorStyle;
}

export interface PlanInput {
	waypoints: PlannedWaypoint[];
	fps: number;
	style: CursorStyle;
	motion: MotionFeel;
	/** Travel-time multiplier: 2 = twice as fast. */
	speed: number;
	/** Idle drift amplitude in px (0 = still). */
	drift: number;
	seed: number;
	/** Start off-frame here and travel to the first waypoint. */
	from?: Vec2;
	/** End by travelling here (off-frame) after the last waypoint. */
	to?: Vec2;
	hoverRegions: HoverRegion[];
	/** Frames the pointer takes to appear / vanish (0 = instant). */
	appear: number;
	vanish: number;
}

export interface PressWindow {
	/** Button starts going down. */
	down: number;
	/** Fully pressed: the click lands. */
	pressed: number;
	/** Button starts coming up. */
	up: number;
	/** Fully released. */
	released: number;
}

export interface StyleWindow {
	style: CursorStyle;
	start: number;
	end: number;
}

export interface PointerPlan {
	/** Frames planned: positions has one entry per frame in [0, length). */
	length: number;
	positions: Vec2[];
	/** Travel direction per frame (radians), held while still. */
	angles: number[];
	presses: PressWindow[];
	styles: StyleWindow[];
	/** When the pointer is fully visible, and when it starts vanishing. */
	shown: number;
	vanishAt: number;
	cues: {
		arrivals: Array<{ frame: number; point: Vec2; index: number }>;
		presses: Array<{ frame: number; point: Vec2 }>;
		releases: Array<{ frame: number; point: Vec2 }>;
		clicks: Array<{
			frame: number;
			point: Vec2;
			index: number;
			target?: string;
		}>;
		drags: Array<{ frame: number; end: number; from: Vec2; to: Vec2 }>;
	};
}

// Press timing (frames at 30 fps; scaled by fps).
const SETTLE = 4;
const PRESS = 3;
const HOLD = 2;
const RELEASE = 5;
const CLICK_GAP = 3;
const DWELL = 14;

/** Travel time for a distance, from Fitts' law: quick hops, long sweeps that still feel human. */
export function travelFrames(
	distance: number,
	fps: number,
	feel: MotionFeel,
	speed: number,
): number {
	const seconds = 0.2 + 0.13 * Math.log2(1 + distance / 24);
	const scale = feel === "lazy" ? 1.4 : feel === "swift" ? 0.8 : 1;
	return Math.max(
		4,
		Math.round((seconds * scale * fps) / Math.max(0.05, speed)),
	);
}

/** Progress along the curve for t ∈ [0, 1]: quick start, long soft landing. */
function progress(feel: MotionFeel, t: number): number {
	switch (feel) {
		case "linear":
			return t;
		case "lazy":
			return evaluateEase("sine.inOut", t);
		case "swift":
			return minimumJerk(t);
		case "natural":
			// Skewed minimum-jerk: peak speed early, like a real hand.
			return minimumJerk(t ** 0.78);
	}
}

const minimumJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);

/** Quadratic Bézier point. */
function quad(a: Vec2, c: Vec2, b: Vec2, u: number): Vec2 {
	const v = 1 - u;
	return [
		v * v * a[0] + 2 * v * u * c[0] + u * u * b[0],
		v * v * a[1] + 2 * v * u * c[1] + u * u * b[1],
	];
}

export function planPointer(input: PlanInput): PointerPlan {
	const { fps, seed } = input;
	const f = (framesAt30: number) =>
		Math.max(1, Math.round((framesAt30 * fps) / 30));
	if (input.waypoints.length === 0)
		throw new Error("MousePointer: `path` needs at least one waypoint.");

	type Segment =
		| {
				kind: "travel";
				start: number;
				end: number;
				from: PointAt;
				to: PointAt;
				index: number;
				pressed: boolean;
		  }
		| {
				kind: "rest";
				start: number;
				end: number;
				at: PointAt;
				pressed: boolean;
		  };
	const segments: Segment[] = [];
	const presses: PressWindow[] = [];
	const cues: PointerPlan["cues"] = {
		arrivals: [],
		presses: [],
		releases: [],
		clicks: [],
		drags: [],
	};
	const styleChanges: Array<{ frame: number; style: CursorStyle }> = [
		{ frame: 0, style: input.style },
	];

	let cursor = 0; // the next free frame
	let here: PointAt = input.from
		? constant(input.from)
		: (input.waypoints[0]?.point ?? constant([0, 0]));
	const appear = Math.max(0, input.appear);

	input.waypoints.forEach((wp, index) => {
		const isFirst = index === 0;
		const needsTravel = !(isFirst && !input.from);
		let arrival: number;
		if (needsTravel) {
			const from = here;
			const startFrame = cursor;
			const d = dist(from(startFrame), wp.point(startFrame));
			const natural =
				startFrame + travelFrames(d, fps, input.motion, input.speed);
			arrival = wp.at ?? natural;
			if (arrival < startFrame + 2) {
				throw new Error(
					`MousePointer: waypoint ${index} arrives at frame ${arrival}, but the pointer is busy until ${startFrame}. Leave at least 2 frames to travel.`,
				);
			}
			segments.push({
				kind: "travel",
				start: startFrame,
				end: arrival,
				from,
				to: wp.point,
				index,
				pressed: false,
			});
		} else {
			arrival = wp.at ?? 0;
			if (arrival > 0)
				segments.push({
					kind: "rest",
					start: 0,
					end: arrival,
					at: wp.point,
					pressed: false,
				});
		}
		here = wp.point;
		cues.arrivals.push({ frame: arrival, point: wp.point(arrival), index });
		if (wp.cursor) styleChanges.push({ frame: arrival, style: wp.cursor });

		let t = Math.max(arrival, isFirst ? appear : arrival);
		if (t > arrival)
			segments.push({
				kind: "rest",
				start: arrival,
				end: t,
				at: wp.point,
				pressed: false,
			});

		const press = (at: number, hold: number, click: boolean): PressWindow => {
			const w = {
				down: at,
				pressed: at + f(PRESS),
				up: at + f(PRESS) + hold,
				released: at + f(PRESS) + hold + f(RELEASE),
			};
			presses.push(w);
			cues.presses.push({ frame: w.down, point: here(w.down) });
			cues.releases.push({ frame: w.up, point: here(w.up) });
			if (click)
				cues.clicks.push({
					frame: w.pressed,
					point: here(w.pressed),
					index,
					target: wp.targetId,
				});
			return w;
		};

		if (wp.drag) {
			const settle = t + f(SETTLE);
			segments.push({
				kind: "rest",
				start: t,
				end: settle,
				at: wp.point,
				pressed: false,
			});
			const down = settle;
			const pressedAt = down + f(PRESS);
			segments.push({
				kind: "rest",
				start: down,
				end: pressedAt,
				at: wp.point,
				pressed: true,
			});
			const from = wp.point;
			const to = wp.drag;
			const d = dist(from(pressedAt), to(pressedAt));
			const dragEnd =
				pressedAt +
				Math.round(travelFrames(d, fps, input.motion, input.speed) * 1.25);
			segments.push({
				kind: "travel",
				start: pressedAt,
				end: dragEnd,
				from,
				to,
				index,
				pressed: true,
			});
			here = to;
			const up = dragEnd + f(SETTLE);
			segments.push({
				kind: "rest",
				start: dragEnd,
				end: up,
				at: to,
				pressed: true,
			});
			presses.push({ down, pressed: pressedAt, up, released: up + f(RELEASE) });
			cues.presses.push({ frame: down, point: from(down) });
			cues.drags.push({
				frame: pressedAt,
				end: dragEnd,
				from: from(pressedAt),
				to: to(dragEnd),
			});
			cues.releases.push({ frame: up, point: to(up) });
			t = up + f(RELEASE);
			segments.push({
				kind: "rest",
				start: up,
				end: t,
				at: to,
				pressed: false,
			});
		} else if (wp.clicks && wp.clicks > 0) {
			t += f(SETTLE);
			for (let c = 0; c < wp.clicks; c++) {
				const w = press(t, wp.hold ?? f(HOLD), true);
				t = w.released + (c < wp.clicks - 1 ? f(CLICK_GAP) : 0);
			}
			// Pressed: no idle drift may nudge the pointer mid-click.
			segments.push({
				kind: "rest",
				start: arrival,
				end: t,
				at: wp.point,
				pressed: true,
			});
		}

		const dwellEnd = t + (wp.dwell ?? f(DWELL));
		segments.push({
			kind: "rest",
			start: t,
			end: dwellEnd,
			at: here,
			pressed: false,
		});
		cursor = dwellEnd;
	});

	if (input.to) {
		const from = here;
		const exitPoint = constant(input.to);
		const d = dist(from(cursor), input.to);
		const end = cursor + travelFrames(d, fps, input.motion, input.speed);
		segments.push({
			kind: "travel",
			start: cursor,
			end,
			from,
			to: exitPoint,
			index: input.waypoints.length,
			pressed: false,
		});
		cursor = end;
	}
	const vanishAt = cursor;
	const length = cursor + (input.to ? 0 : Math.max(0, input.vanish)) + 1;

	// Curve shape per travel segment: a seeded sideways bend, the way a hand
	// arcs instead of drawing rulers.
	const bendOf = (index: number) => {
		if (input.motion === "linear") return 0;
		const r = hashRng(seed, `bend:${index}`);
		const amount =
			input.motion === "lazy"
				? r.range(0.1, 0.18)
				: input.motion === "swift"
					? r.range(0.03, 0.07)
					: r.range(0.05, 0.11);
		return r.next() < 0.5 ? -amount : amount;
	};

	const positions: Vec2[] = [];
	const angles: number[] = [];
	const driftRng = hashRng(seed, "drift");
	const [ph0, ph1, ph2, ph3] = [0, 1, 2, 3].map(() =>
		driftRng.range(0, Math.PI * 2),
	) as [number, number, number, number];
	let lastAngle = -Math.PI / 4;

	for (let frame = 0; frame < length; frame++) {
		const seg = findSegment(segments, frame);
		let p: Vec2;
		let moving = false;
		if (!seg) {
			p = here(frame);
		} else if (seg.kind === "travel") {
			const t =
				seg.end > seg.start ? (frame - seg.start) / (seg.end - seg.start) : 1;
			const a = seg.from(seg.start);
			const b = seg.to(frame);
			const len = dist(a, b);
			const bend = bendOf(seg.index) * len;
			const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
			const nx = len > 0 ? -(b[1] - a[1]) / len : 0;
			const ny = len > 0 ? (b[0] - a[0]) / len : 0;
			const control: Vec2 = [mid[0] + nx * bend, mid[1] + ny * bend];
			const u = progress(input.motion, Math.min(1, Math.max(0, t)));
			p = quad(a, control, b, u);
			// A natural landing overshoots a hair past the target and settles.
			if (input.motion === "natural" && len > 60) {
				const over = Math.min(6, len * 0.012);
				const k = Math.max(0, (t - 0.62) / 0.38);
				const bump = Math.sin(Math.PI * Math.min(1, k));
				p = [
					p[0] + ((b[0] - a[0]) / len) * over * bump,
					p[1] + ((b[1] - a[1]) / len) * over * bump,
				];
			}
			moving = t > 0 && t < 1;
		} else {
			p = seg.at(frame);
			// Idle drift while resting, never while the button is down.
			if (!seg.pressed && input.drift > 0) {
				const ramp = Math.min(
					1,
					(frame - seg.start) / 8,
					(seg.end - frame) / 8,
				);
				if (ramp > 0) {
					const s = frame / fps;
					const dx =
						Math.sin(s * 1.7 + ph0) * 0.6 + Math.sin(s * 0.9 + ph1) * 0.4;
					const dy =
						Math.sin(s * 1.3 + ph2) * 0.6 + Math.sin(s * 0.7 + ph3) * 0.4;
					p = [p[0] + dx * input.drift * ramp, p[1] + dy * input.drift * ramp];
				}
			}
		}
		const prev = positions[frame - 1];
		if (moving && prev && dist(prev, p) > 0.5)
			lastAngle = Math.atan2(p[1] - prev[1], p[0] - prev[0]);
		positions.push(p);
		angles.push(lastAngle);
	}

	return {
		length,
		positions,
		angles,
		presses,
		styles: styleWindows(positions, styleChanges, input.hoverRegions),
		shown: appear,
		vanishAt,
		cues,
	};
}

function constant(p: Vec2): PointAt {
	return () => p;
}

function findSegment<T extends { start: number; end: number }>(
	segments: T[],
	frame: number,
): T | undefined {
	// Later segments win on shared frames (a rest that starts where travel ends).
	let found: T | undefined;
	for (const s of segments) if (frame >= s.start && frame <= s.end) found = s;
	return found;
}

/** Style per frame (base style changes + hover regions), as windows. */
function styleWindows(
	positions: Vec2[],
	changes: Array<{ frame: number; style: CursorStyle }>,
	regions: HoverRegion[],
): StyleWindow[] {
	const sorted = [...changes].sort((a, b) => a.frame - b.frame);
	const windows: StyleWindow[] = [];
	let base = sorted[0]?.style ?? "arrow";
	let next = 1;
	for (let frame = 0; frame < positions.length; frame++) {
		while (next < sorted.length && (sorted[next]?.frame ?? Infinity) <= frame) {
			base = sorted[next]?.style ?? base;
			next++;
		}
		const p = positions[frame] as Vec2;
		const region = regions.find(
			(r) =>
				p[0] >= r.rect.x &&
				p[0] <= r.rect.x + r.rect.width &&
				p[1] >= r.rect.y &&
				p[1] <= r.rect.y + r.rect.height,
		);
		const style = region?.style ?? base;
		const last = windows[windows.length - 1];
		if (last && last.style === style) last.end = frame;
		else windows.push({ style, start: frame, end: frame });
	}
	return windows;
}
