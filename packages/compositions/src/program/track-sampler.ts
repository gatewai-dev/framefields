/**
 * Sampling a layer's animation at a frame exactly as the compositor draws
 * it: keyframe segments shaped by GSAP's eases (what the compiled GSAP
 * timeline plays), other sources (wiggle, spring, signals) by the program
 * evaluator. The compositor's draw-time tracks and anything that must agree
 * with the picture outside a render (physics following a layer) share it.
 */
import gsapModule from "gsap";
import { evaluateKeyframes, evaluateTrackAtFrame } from "./evaluator.js";
import type { AnimationTrack, EaseRef } from "./schema.js";

type EaseFn = (p: number) => number;
interface GsapEases {
	parseEase(ease: string): EaseFn | undefined;
}
const gsap = ((gsapModule as unknown as { default?: GsapEases }).default ??
	gsapModule) as unknown as GsapEases;

/**
 * Solves a cubic bezier curve defined by control points (x1, y1) and (x2, y2)
 * for a given progress parameter t in [0, 1].
 */
export function solveCubicBezier(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	t: number,
): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;

	// Check for linear edge case
	if (x1 === y1 && x2 === y2) return t;

	// Find u such that x(u) = t
	// x(u) = 3*(1-u)^2 * u * x1 + 3*(1-u) * u^2 * x2 + u^3
	// dx/du = 3*(1-u)^2 * x1 + 6*(1-u)*u * (x2 - x1) + 3*u^2 * (1 - x2)
	let u = t; // initial guess
	for (let i = 0; i < 8; i++) {
		const oneMinusU = 1 - u;
		const oneMinusU2 = oneMinusU * oneMinusU;
		const u2 = u * u;

		const currentX = 3 * oneMinusU2 * u * x1 + 3 * oneMinusU * u2 * x2 + u2 * u;
		const diff = currentX - t;
		if (Math.abs(diff) < 1e-6) break;

		const dx =
			3 * oneMinusU2 * x1 + 6 * oneMinusU * u * (x2 - x1) + 3 * u2 * (1 - x2);

		if (Math.abs(dx) < 1e-6) break;
		u -= diff / dx;
		u = Math.max(0, Math.min(1, u));
	}

	// Bisection fallback if Newton didn't converge within bounds
	const oneMinusU = 1 - u;
	const checkX =
		3 * oneMinusU * oneMinusU * u * x1 + 3 * oneMinusU * u * u * x2 + u * u * u;

	if (Math.abs(checkX - t) > 1e-3) {
		let low = 0;
		let high = 1;
		u = t;
		for (let i = 0; i < 16; i++) {
			const mid = (low + high) * 0.5;
			const oMid = 1 - mid;
			const xMid =
				3 * oMid * oMid * mid * x1 +
				3 * oMid * mid * mid * x2 +
				mid * mid * mid;
			if (Math.abs(xMid - t) < 1e-5) {
				u = mid;
				break;
			}
			if (xMid < t) low = mid;
			else high = mid;
			u = mid;
		}
	}

	// Evaluate y(u)
	const oU = 1 - u;
	return 3 * oU * oU * u * y1 + 3 * oU * u * u * y2 + u * u * u;
}

export function mappedEase(
	ease?: EaseRef,
	durationFrames?: number,
	fps = 24,
): string | ((p: number) => number) {
	if (!ease) return "none";
	const { name, dir, params } = ease;
	if (name === "none") return "none";

	// Custom closed-form Spring ease solver
	if ((name as string) === "spring") {
		const damping = Math.max(0.001, params?.[0] ?? 10);
		const stiffness = Math.max(0.001, params?.[1] ?? 100);
		const mass = Math.max(0.001, params?.[2] ?? 1);

		return (p: number) => {
			const safeFps = fps > 0 ? fps : 24;
			const durSec =
				durationFrames && durationFrames > 0 ? durationFrames / safeFps : 1.0;
			const t = p * durSec;

			const m = mass;
			const k = stiffness;
			const c = damping;

			const w0 = Math.sqrt(k / m);
			const zeta = c / (2 * Math.sqrt(k * m));

			let x = 0;
			if (zeta < 1) {
				const wd = w0 * Math.sqrt(1 - zeta * zeta);
				const A = -1;
				const B = (-zeta * w0) / wd;
				x =
					Math.exp(-zeta * w0 * t) *
					(A * Math.cos(wd * t) + B * Math.sin(wd * t));
			} else if (zeta === 1) {
				const A = -1;
				const B = -w0;
				x = Math.exp(-w0 * t) * (A + B * t);
			} else {
				const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
				const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
				const C1 = -1 / (1 - r1 / r2);
				const C2 = -1 - C1;
				x = C1 * Math.exp(r1 * t) + C2 * Math.exp(r2 * t);
			}
			return 1 + x;
		};
	}

	if ((name as string) === "cubic") {
		const x1 = params?.[0] ?? 0.25;
		const y1 = params?.[1] ?? 0.1;
		const x2 = params?.[2] ?? 0.25;
		const y2 = params?.[3] ?? 1.0;
		return (p: number) => solveCubicBezier(x1, y1, x2, y2, p);
	}

	if ((name as string) === "hold") {
		// GSAP rounds time to 1e-7 s, so on its own end frame a short segment's
		// progress can land ~1e-5 under 1; 1e-4 of a segment is safe slack for the
		// jump (it would only fire a frame early on segments over 10,000 frames).
		return (p: number) => (p >= 1 - 1e-4 ? 1 : 0);
	}

	const easeName = name as string;
	let suffix = "";
	if (params && params.length > 0) {
		suffix = `(${params.join(", ")})`;
	} else if (name === "back") {
		suffix = "(1.7)";
	} else if (name === "elastic") {
		suffix = "(1, 0.3)";
	}

	return `${easeName}.${dir}${suffix}`;
}

/** GSAP's shaping for a keyframe segment, so draw-time tracks ease like baked ones. */
export function gsapEase(
	fps: number,
): (ease: EaseRef | undefined, deltaFrames: number, t: number) => number {
	return (ease, deltaFrames, t) => {
		const e = mappedEase(ease, deltaFrames, fps);
		const fn = typeof e === "function" ? e : gsap.parseEase(e);
		return fn ? fn(t) : t;
	};
}

export interface TrackSampleContext {
	/** The layer's start frame: keyframes are relative to it. */
	startFrame?: number;
	/** Stepped timing ("on twos" = 2): the value holds for this many frames. */
	step?: number;
	/** The layer's own values, for sources that modulate them. */
	base?: Record<string, unknown>;
	signals?: Record<string, unknown>;
}

/** A track's value at composition frame `frame`. */
export function sampleTrack(
	track: AnimationTrack,
	frame: number,
	fps: number,
	ctx: TrackSampleContext = {},
): number | boolean | string {
	const startFrame = ctx.startFrame ?? 0;
	const step = ctx.step ?? 1;
	const f =
		step > 1
			? startFrame + Math.floor((frame - startFrame) / step) * step
			: frame;
	const source = track.source ?? { type: "keyframe" };
	if (source.type === "keyframe") {
		return evaluateKeyframes(track, f - startFrame, gsapEase(fps));
	}
	return evaluateTrackAtFrame(track, f, fps, {
		startFrame,
		baseValues: ctx.base,
		signals: ctx.signals,
	});
}

/** What `sampleLayerProp` reads from a layer. */
export interface AnimatedLayer {
	startFrame?: number;
	animation?: { tracks?: AnimationTrack[]; frameStep?: number };
	[prop: string]: unknown;
}

/**
 * A layer's numeric prop at composition frame `frame`: its own value, then
 * each of its tracks on that prop in order (a later track overrides).
 */
export function sampleLayerProp(
	layer: AnimatedLayer,
	prop: string,
	frame: number,
	fps: number,
	fallback = 0,
): number {
	const own = layer[prop];
	let value = typeof own === "number" && Number.isFinite(own) ? own : fallback;
	const animation = layer.animation;
	for (const track of animation?.tracks ?? []) {
		if (track.prop !== prop) continue;
		const v = sampleTrack(track, frame, fps, {
			startFrame: layer.startFrame ?? 0,
			step: animation?.frameStep,
			base: layer,
		});
		if (typeof v === "number" && Number.isFinite(v)) value = v;
	}
	return value;
}
