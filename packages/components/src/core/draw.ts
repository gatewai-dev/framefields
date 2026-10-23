/**
 * Strokes that draw on, and the hand-drawn look: seeded wobble plus "boil"
 * (re-posing the stroke every few frames, like drawn animation).
 */
import type { KeyframeTuple } from "@framefields/compositions/program";
import { catmullRom, toPathData, type Vec2 } from "./path.js";
import { hashRng } from "./rng.js";

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface HandOptions {
	/** Wobble amount in px at theme scale 1. 0 = clean geometry. */
	wobble?: number;
	seed?: number;
}

/** Keys for `trimEnd` 0 → 1 between `start` and `start + duration`. */
export function drawOnKeys(
	start: number,
	duration: number,
	ease = "power2.inOut",
): KeyframeTuple[] {
	return [
		[start, 0],
		[start + Math.max(1, duration), 1, ease],
	];
}

/**
 * Perturb points with seeded, low-frequency noise: neighbouring points move
 * together, so lines bend instead of jittering.
 */
export function wobblePoints(
	points: readonly Vec2[],
	{ wobble = 0, seed = 1 }: HandOptions = {},
	variant = 0,
): Vec2[] {
	if (wobble <= 0 || points.length === 0)
		return points.map((p) => [p[0], p[1]]);
	const r = hashRng(seed, `wobble:${variant}`);
	// A few control offsets, interpolated across the stroke.
	const controls = Math.max(2, Math.min(8, Math.ceil(points.length / 6)));
	const ox = Array.from({ length: controls }, () => r.spread(wobble));
	const oy = Array.from({ length: controls }, () => r.spread(wobble));
	const sample = (arr: number[], t: number) => {
		const f = t * (arr.length - 1);
		const i = Math.min(arr.length - 2, Math.floor(f));
		const k = f - i;
		const s = k * k * (3 - 2 * k);
		return arr[i]! * (1 - s) + arr[i + 1]! * s;
	};
	return points.map((p, i) => {
		const t = points.length === 1 ? 0 : i / (points.length - 1);
		return [p[0] + sample(ox, t), p[1] + sample(oy, t)];
	});
}

/** An ellipse around `rect` (+ padding); hand-drawn ellipses overshoot their start. */
export function ellipsePath(
	rect: Rect,
	{
		padding = 0,
		wobble = 0,
		seed = 1,
	}: HandOptions & { padding?: number } = {},
	variant = 0,
): string {
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	const rx = rect.width / 2 + padding;
	const ry = rect.height / 2 + padding;
	const r = hashRng(seed, `ellipse:${variant}`);
	const start = wobble > 0 ? -Math.PI * 0.6 + r.spread(0.3) : 0;
	const sweep = wobble > 0 ? Math.PI * 2 * 1.08 : Math.PI * 2;
	const steps = 64;
	const points: Vec2[] = [];
	for (let i = 0; i <= steps; i++) {
		const a = start + (sweep * i) / steps;
		// Hand-drawn loops spiral slightly so the overshoot doesn't retrace.
		const grow = wobble > 0 ? 1 + (i / steps - 0.5) * 0.06 : 1;
		points.push([cx + Math.cos(a) * rx * grow, cy + Math.sin(a) * ry * grow]);
	}
	return toPathData(
		wobblePoints(points, { wobble, seed }, variant),
		wobble <= 0,
	);
}

/** A rectangle around `rect` (+ padding). */
export function boxPath(
	rect: Rect,
	{
		padding = 0,
		wobble = 0,
		seed = 1,
	}: HandOptions & { padding?: number } = {},
	variant = 0,
): string {
	const x0 = rect.x - padding;
	const y0 = rect.y - padding;
	const x1 = rect.x + rect.width + padding;
	const y1 = rect.y + rect.height + padding;
	const corners: Vec2[] = [
		[x0, y0],
		[x1, y0],
		[x1, y1],
		[x0, y1],
		[x0, y0],
	];
	if (wobble <= 0) return toPathData(corners.slice(0, 4), true);
	// A pen starts a little along the top edge, goes round, and closes past
	// where it started.
	const w = x1 - x0;
	const points: Vec2[] = [[x0 + w * 0.06, y0]];
	for (let i = 0; i < 4; i++) {
		const a = corners[i]!;
		const b = corners[i + 1]!;
		for (let s = 1; s <= 8; s++) {
			const t = s / 8;
			if (i === 0 && a[0] + (b[0] - a[0]) * t < x0 + w * 0.06) continue;
			points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
		}
	}
	points.push([x0 + w * 0.14, y0 + (y1 - y0) * 0.01]);
	return toPathData(wobblePoints(points, { wobble, seed }, variant));
}

/** A horizontal stroke from `from` to `to`. */
export function linePath(
	from: Vec2,
	to: Vec2,
	{ wobble = 0, seed = 1 }: HandOptions = {},
	variant = 0,
): string {
	const steps = wobble > 0 ? 16 : 1;
	const points: Vec2[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		points.push([
			from[0] + (to[0] - from[0]) * t,
			from[1] + (to[1] - from[1]) * t,
		]);
	}
	return toPathData(wobblePoints(points, { wobble, seed }, variant));
}

/** A wavy line from `from` to `to`, `waves` crests of `amplitude` px. */
export function squigglePath(
	from: Vec2,
	to: Vec2,
	{
		amplitude = 6,
		waves,
		wobble = 0,
		seed = 1,
	}: HandOptions & { amplitude?: number; waves?: number } = {},
	variant = 0,
): string {
	const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
	const n = waves ?? Math.max(2, Math.round(length / 28));
	const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
	const nx = -Math.sin(angle);
	const ny = Math.cos(angle);
	const steps = n * 8;
	const points: Vec2[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const off = Math.sin(t * n * Math.PI * 2) * amplitude;
		points.push([
			from[0] + (to[0] - from[0]) * t + nx * off,
			from[1] + (to[1] - from[1]) * t + ny * off,
		]);
	}
	return toPathData(wobblePoints(points, { wobble, seed }, variant));
}

export type ArrowCurve = "straight" | "arc" | "swoop";

export interface ArrowGeometry {
	/** The shaft, drawn from `from` to just before `to`. */
	shaft: string;
	/** The head, two strokes meeting at `to`. */
	head: string;
}

/** An arrow from `from` to `to` with a separate head path. */
export function arrowPaths(
	from: Vec2,
	to: Vec2,
	{
		curve = "arc",
		headSize = 18,
		wobble = 0,
		seed = 1,
	}: HandOptions & { curve?: ArrowCurve; headSize?: number } = {},
	variant = 0,
): ArrowGeometry {
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const length = Math.hypot(dx, dy) || 1;
	const nx = -dy / length;
	const ny = dx / length;
	const bend = curve === "straight" ? 0 : curve === "arc" ? 0.18 : 0.35;
	const controls: Vec2[] =
		curve === "swoop"
			? [
					from,
					[
						from[0] + dx * 0.3 + nx * length * bend,
						from[1] + dy * 0.3 + ny * length * bend,
					],
					[
						from[0] + dx * 0.75 - nx * length * bend * 0.4,
						from[1] + dy * 0.75 - ny * length * bend * 0.4,
					],
					to,
				]
			: [
					from,
					[
						from[0] + dx * 0.5 + nx * length * bend,
						from[1] + dy * 0.5 + ny * length * bend,
					],
					to,
				];
	const points = bend === 0 ? [from, to] : catmullRom(controls, 12);
	const wobbled = wobblePoints(points, { wobble, seed }, variant);
	const tail = wobbled[wobbled.length - 2] ?? from;
	const angle = Math.atan2(to[1] - tail[1], to[0] - tail[0]);
	const wing = (side: 1 | -1): Vec2 => [
		to[0] - Math.cos(angle + side * 0.5) * headSize,
		to[1] - Math.sin(angle + side * 0.5) * headSize,
	];
	const left = wing(1);
	const right = wing(-1);
	return {
		shaft: toPathData(wobbled),
		head: `${toPathData([left, to])} ${toPathData([to, right]).replace(/^M/, "L")}`,
	};
}

/**
 * Hand-drawn "boil": `d` keys that switch between `variants` poses every
 * `every` frames with hold interpolation, from `start` to `end`.
 * `makePath(variant)` must be deterministic for a variant index.
 */
export function boilKeys(
	makePath: (variant: number) => string,
	{
		start,
		end,
		every,
		variants = 3,
	}: { start: number; end: number; every: number; variants?: number },
): KeyframeTuple[] {
	const poses = Array.from({ length: Math.max(1, variants) }, (_, i) =>
		makePath(i),
	);
	if (every <= 0 || poses.length === 1) return [[start, poses[0]!]];
	const keys: KeyframeTuple[] = [];
	let i = 0;
	for (let f = start; f <= end; f += every) {
		keys.push([f, poses[i % poses.length]!, "hold"]);
		i++;
	}
	return keys;
}
