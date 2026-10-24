/**
 * The FocusZoom camera solver: which framing each frame wants (shots, or
 * clusters of pointer clicks), and how the camera moves between framings.
 *
 * Moves interpolate the view rectangle — all four edges on one eased curve —
 * between framings that are already clamped. That keeps every content point
 * moving one way on screen (no sideways wiggle while zooming), and a convex
 * blend of two in-bounds views never shows past the bounds, so nothing is
 * clamped mid-move. Smoothing pan and zoom separately and clamping the result
 * does neither.
 */
import type { Vec2 } from "framefields/components";

export interface CameraState {
	/** Content point at the centre of the view. */
	cx: number;
	cy: number;
	zoom: number;
}

export interface ShotWindow {
	start: number;
	end: number;
	center: Vec2 | ((frame: number) => Vec2);
	zoom: number;
	/** The move must have landed by this frame (e.g. the first click). */
	settleBy?: number;
}

export interface CameraInput {
	width: number;
	height: number;
	length: number;
	fps: number;
	shots: ShotWindow[];
	/** 0 = quick moves, 1 = slow, soft moves. */
	smoothing: number;
	clamp: boolean;
	/** The region the view must stay inside when zoomed (default: the whole view). */
	bounds?: { x: number; y: number; width: number; height: number };
}

export interface CameraPlan {
	states: CameraState[];
	/** Wrapper transform per frame (anchor at its top-left). */
	x: number[];
	y: number[];
	scale: number[];
	shots: Array<{
		frame: number;
		settled: number;
		end: number;
		zoom: number;
		center: Vec2;
	}>;
}

/** The visible content rectangle: left, top, right, bottom. */
interface View {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** Minimum-jerk ease: zero velocity and acceleration at both ends. */
const ease = (t: number) => {
	const s = Math.min(1, Math.max(0, t));
	return s * s * s * (10 - 15 * s + 6 * s * s);
};

export function solveCamera(input: CameraInput): CameraPlan {
	const { width: W, height: H, fps } = input;
	const smoothing = Math.min(1, Math.max(0, input.smoothing));

	const toView = (s: CameraState): View => {
		const hw = W / (2 * s.zoom);
		const hh = H / (2 * s.zoom);
		return { x0: s.cx - hw, y0: s.cy - hh, x1: s.cx + hw, y1: s.cy + hh };
	};
	const toState = (v: View): CameraState => ({
		cx: (v.x0 + v.x1) / 2,
		cy: (v.y0 + v.y1) / 2,
		zoom: W / (v.x1 - v.x0),
	});
	const lerpView = (a: View, b: View, t: number): View => ({
		x0: a.x0 + (b.x0 - a.x0) * t,
		y0: a.y0 + (b.y0 - a.y0) * t,
		x1: a.x1 + (b.x1 - a.x1) * t,
		y1: a.y1 + (b.y1 - a.y1) * t,
	});

	/** Clamp a framing (never a frame of motion): inside the view, then the bounds. */
	const clampState = (s: CameraState): CameraState => {
		if (!input.clamp) return s;
		const zoom = Math.max(1, s.zoom);
		const hw = W / (2 * zoom);
		const hh = H / (2 * zoom);
		const fit = (c: number, lo: number, hi: number, half: number) =>
			hi - lo >= 2 * half
				? Math.min(hi - half, Math.max(lo + half, c))
				: (lo + hi) / 2;
		let cx = fit(s.cx, 0, W, hw);
		let cy = fit(s.cy, 0, H, hh);
		const b = input.bounds;
		if (b && zoom > 1) {
			cx = fit(cx, b.x, b.x + b.width, hw);
			cy = fit(cy, b.y, b.y + b.height, hh);
			// Bounds never push the view past the content itself.
			cx = fit(cx, 0, W, hw);
			cy = fit(cy, 0, H, hh);
		}
		return { cx, cy, zoom };
	};

	const full: CameraState = { cx: W / 2, cy: H / 2, zoom: 1 };
	const shotAt = (frame: number): number => {
		let pick = -1;
		input.shots.forEach((s, i) => {
			if (frame >= s.start && frame < s.end) pick = i;
		});
		return pick;
	};
	const framing = (index: number, frame: number): CameraState => {
		const s = input.shots[index];
		if (!s) return full;
		const c = typeof s.center === "function" ? s.center(frame) : s.center;
		return clampState({ cx: c[0], cy: c[1], zoom: s.zoom });
	};

	// Move length: a base set by `smoothing`, longer for bigger zoom changes.
	const moveFrames = (from: View, to: View) => {
		const ratio = Math.abs(Math.log((to.x1 - to.x0) / (from.x1 - from.x0)));
		const base = 0.55 + 0.75 * smoothing;
		const seconds = base * (0.75 + 0.25 * Math.min(1, ratio / Math.LN2));
		return Math.max(2, Math.round(seconds * fps));
	};
	// Holding on a moving target: follow it softly (exponential, so it never
	// overshoots and never reverses).
	const follow = 1 - Math.exp(-(8 - 5 * smoothing) / fps);

	let current = toView(framing(shotAt(0), 0));
	let active = shotAt(0);
	let move: { from: View; start: number; frames: number } | null = null;
	const settledAt = new Map<number, number>();
	const states: CameraState[] = [];

	for (let f = 0; f < input.length; f++) {
		const index = shotAt(f);
		const target = toView(framing(index, f));
		if (index !== active) {
			const settleBy = input.shots[index]?.settleBy;
			const natural = moveFrames(current, target);
			const frames =
				settleBy === undefined
					? natural
					: Math.max(2, Math.min(natural, settleBy - f));
			move = { from: current, start: f, frames };
			active = index;
		}
		if (move) {
			const t = (f - move.start) / move.frames;
			current = lerpView(move.from, target, ease(t));
			if (t >= 1) {
				move = null;
				if (index >= 0 && !settledAt.has(index)) settledAt.set(index, f);
			}
		} else {
			current = lerpView(current, target, follow);
			if (index >= 0 && !settledAt.has(index)) settledAt.set(index, f);
		}
		states.push(toState(current));
	}

	const shots = input.shots.map((s, i) => {
		const c = typeof s.center === "function" ? s.center(s.start) : s.center;
		return {
			frame: s.start,
			settled: settledAt.get(i) ?? s.end,
			end: s.end,
			zoom: s.zoom,
			center: c,
		};
	});

	return {
		states,
		x: states.map((s) => W / 2 - s.zoom * s.cx),
		y: states.map((s) => H / 2 - s.zoom * s.cy),
		scale: states.map((s) => s.zoom),
		shots,
	};
}

export interface ClickEvent {
	frame: number;
	point: Vec2;
}

/**
 * Shots from pointer clicks: nearby clicks close in time share one push-in
 * that starts `lead` frames before the first and lets go `idle` frames after
 * the last, framed on the cluster. The camera doesn't chase the pointer: a
 * still frame reads calmer and keeps the click where the eye already is.
 */
export function shotsFromClicks(
	clicks: ClickEvent[],
	o: {
		width: number;
		height: number;
		lead: number;
		idle: number;
		zoom: number;
		maxZoom: number;
		padding: number;
	},
): ShotWindow[] {
	const sorted = [...clicks].sort((a, b) => a.frame - b.frame);
	const clusters: ClickEvent[][] = [];
	for (const c of sorted) {
		const current = clusters[clusters.length - 1];
		const last = current?.[current.length - 1];
		const near =
			last &&
			c.frame - last.frame <= o.idle + o.lead &&
			Math.abs(c.point[0] - last.point[0]) < (o.width / o.zoom) * 0.8 &&
			Math.abs(c.point[1] - last.point[1]) < (o.height / o.zoom) * 0.8;
		if (current && near) current.push(c);
		else clusters.push([c]);
	}
	return clusters.map((cluster) => {
		const xs = cluster.map((c) => c.point[0]);
		const ys = cluster.map((c) => c.point[1]);
		const x0 = Math.min(...xs) - o.padding;
		const x1 = Math.max(...xs) + o.padding;
		const y0 = Math.min(...ys) - o.padding;
		const y1 = Math.max(...ys) + o.padding;
		const fit = Math.min(
			o.width / Math.max(1, x1 - x0),
			o.height / Math.max(1, y1 - y0),
		);
		const first = cluster[0]?.frame ?? 0;
		const last = cluster[cluster.length - 1]?.frame ?? first;
		return {
			start: Math.max(0, first - o.lead),
			end: last + o.idle,
			settleBy: first - 2,
			zoom: Math.max(1, Math.min(o.zoom, o.maxZoom, fit)),
			center: [(x0 + x1) / 2, (y0 + y1) / 2] as Vec2,
		};
	});
}
