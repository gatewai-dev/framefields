/**
 * Turn per-frame values into a few linear keyframes. Components solve motion
 * offline (springs, camera follow, arc-length travel) and bake it, so the
 * output stays plain keyframe JSON that seeks exactly.
 */

/** `[frame, value]`: a linear keyframe, as `LayerAnimation.keys` takes it. */
export type BakedKey = [frame: number, value: number];

export interface BakeOptions {
	/** Max deviation (in the value's units) of the simplified curve. Default 0.25. */
	tolerance?: number;
}

/**
 * Simplify `values` (one per frame, starting at `startFrame`) to linear keys
 * whose interpolation stays within `tolerance` of every sample
 * (Ramer–Douglas–Peucker on the frame/value polyline). First and last
 * samples are always kept.
 */
export function bakeSamples(
	values: readonly number[],
	startFrame = 0,
	options: BakeOptions = {},
): BakedKey[] {
	const tolerance = options.tolerance ?? 0.25;
	if (values.length === 0) return [];
	if (values.length === 1) return [[startFrame, values[0] as number]];

	const keep = new Uint8Array(values.length);
	keep[0] = 1;
	keep[values.length - 1] = 1;
	const stack: Array<[number, number]> = [[0, values.length - 1]];
	while (stack.length > 0) {
		const [a, b] = stack.pop() as [number, number];
		const va = values[a] as number;
		const vb = values[b] as number;
		let worst = -1;
		let worstErr = tolerance;
		for (let i = a + 1; i < b; i++) {
			const t = (i - a) / (b - a);
			const err = Math.abs((values[i] as number) - (va + (vb - va) * t));
			if (err > worstErr) {
				worstErr = err;
				worst = i;
			}
		}
		if (worst !== -1) {
			keep[worst] = 1;
			stack.push([a, worst], [worst, b]);
		}
	}

	const out: BakedKey[] = [];
	for (let i = 0; i < values.length; i++) {
		if (keep[i]) out.push([startFrame + i, values[i] as number]);
	}
	return out;
}

/** Sample `fn` on every frame in [start, end] and bake it. */
export function bakeFunction(
	fn: (frame: number) => number,
	start: number,
	end: number,
	options?: BakeOptions,
): BakedKey[] {
	const values: number[] = [];
	for (let f = start; f <= end; f++) values.push(fn(f));
	return bakeSamples(values, start, options);
}

/**
 * Damped spring from 0 to 1 in closed form: `stiffness` (k), `damping` (c),
 * `mass` (m), sampled in seconds. Under-damped springs overshoot.
 */
export function springAt(
	seconds: number,
	{ stiffness = 170, damping = 26, mass = 1 } = {},
): number {
	if (seconds <= 0) return 0;
	const w0 = Math.sqrt(stiffness / mass);
	const zeta = damping / (2 * Math.sqrt(stiffness * mass));
	if (zeta < 1) {
		const wd = w0 * Math.sqrt(1 - zeta * zeta);
		return (
			1 -
			Math.exp(-zeta * w0 * seconds) *
				(Math.cos(wd * seconds) + ((zeta * w0) / wd) * Math.sin(wd * seconds))
		);
	}
	if (zeta === 1) {
		return 1 - Math.exp(-w0 * seconds) * (1 + w0 * seconds);
	}
	const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
	const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
	const c2 = r1 / (r1 - r2);
	const c1 = 1 - c2;
	return 1 - (c1 * Math.exp(r1 * seconds) + c2 * Math.exp(r2 * seconds));
}

/**
 * Frames until a spring stays within `epsilon` of rest, at `fps`; capped at
 * `max` frames.
 */
export function springSettleFrames(
	fps: number,
	options?: Parameters<typeof springAt>[1],
	epsilon = 0.001,
	max = 600,
): number {
	let last = 0;
	for (let f = 0; f <= max; f++) {
		if (Math.abs(1 - springAt(f / fps, options)) > epsilon) last = f;
	}
	return Math.min(max, last + 1);
}

/**
 * A spring from `from` to `to` starting at frame `start`, baked to linear
 * keys (within `tolerance`, default 0.2 % of the distance).
 */
export function springKeys(
	start: number,
	from: number,
	to: number,
	fps: number,
	options?: Parameters<typeof springAt>[1],
	tolerance = Math.max(1e-4, Math.abs(to - from) * 0.002),
): BakedKey[] {
	const frames = springSettleFrames(fps, options);
	const values = Array.from({ length: frames + 1 }, (_, f) =>
		f === frames ? to : from + (to - from) * springAt(f / fps, options),
	);
	return bakeSamples(values, start, { tolerance });
}
