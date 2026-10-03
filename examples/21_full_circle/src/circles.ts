/**
 * The circle in every shot, measured and interpolated. Each shot is sampled
 * at a few frames per second (see `pnpm assets circles`): the region connected
 * to a seed point whose luma is on one side of a threshold is flooded, and
 * its bounding box gives centre and radius. Holes (a walking figure, a
 * lighthouse) don't matter; only the outer extent does.
 */

export interface Circle {
	cx: number;
	cy: number;
	r: number;
}

export interface FloodSpec {
	/** "dark" floods pixels below the threshold, "light" above it. */
	polarity: "dark" | "light";
	threshold: number;
	/** Seed in output pixels (1920×1080, after cover fit); defaults to frame centre. */
	seed?: [number, number];
	/** Search radius around the seed; a flood that reaches it has leaked and is rejected. */
	maxR: number;
	/** Smaller results are a detail (a spindle, a catchlight), not the circle. */
	minR?: number;
}

/** Where luma can't isolate the circle (a white dress in a white pool of light), it is set by hand. */
export interface FixedSpec {
	fixed: Circle;
}

export type CircleSpec = FloodSpec | FixedSpec;

export interface CircleTrack {
	fps: number;
	samples: Circle[];
}

export function measureCircle(
	luma: Uint8Array,
	w: number,
	h: number,
	spec: FloodSpec,
	seed: [number, number],
): Circle | null {
	const limit = Math.round(spec.threshold * 255);
	const [sx, sy] = seed;
	const r2 = spec.maxR * spec.maxR;
	const inRange = (x: number, y: number) => (x - sx) ** 2 + (y - sy) ** 2 < r2;
	const match =
		spec.polarity === "dark"
			? (v: number) => v < limit
			: (v: number) => v > limit;
	const inside = (i: number) =>
		inRange(i % w, Math.floor(i / w)) && match(luma[i]);
	const start = nearestInside(w, h, seed, inside);
	if (start < 0) return null;

	const seen = new Uint8Array(w * h);
	const stack = [start];
	seen[start] = 1;
	let minX = w;
	let maxX = 0;
	let minY = h;
	let maxY = 0;
	let area = 0;
	while (stack.length) {
		const i = stack.pop() as number;
		const x = i % w;
		const y = (i - x) / w;
		area++;
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		for (const n of [i - 1, i + 1, i - w, i + w]) {
			if (n < 0 || n >= w * h || seen[n] || Math.abs((n % w) - x) > 1) continue;
			seen[n] = 1;
			if (inside(n)) stack.push(n);
		}
	}
	// A flood that leaked into the background fills the whole search disc: reject it.
	const reach = spec.maxR - 3;
	if (
		area < 200 ||
		sx - minX >= reach ||
		maxX - sx >= reach ||
		sy - minY >= reach ||
		maxY - sy >= reach
	)
		return null;
	const r = (maxX - minX + maxY - minY) / 4;
	return r < (spec.minR ?? 0)
		? null
		: { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, r };
}

/** The seed may land on a highlight or a hole; search outward in a small spiral. */
function nearestInside(
	w: number,
	h: number,
	[sx, sy]: [number, number],
	inside: (i: number) => boolean,
): number {
	for (let radius = 0; radius <= 60; radius += 4) {
		for (let a = 0; a < 16; a++) {
			const x = Math.round(sx + radius * Math.cos((a / 16) * 2 * Math.PI));
			const y = Math.round(sy + radius * Math.sin((a / 16) * 2 * Math.PI));
			if (x >= 0 && y >= 0 && x < w && y < h && inside(y * w + x))
				return y * w + x;
			if (radius === 0) break;
		}
	}
	return -1;
}

/**
 * Fills failed samples from their neighbours and runs a 5-tap median so a
 * single misread frame can't yank the ring.
 */
export function cleanTrack(samples: (Circle | null)[]): Circle[] {
	const known = samples
		.map((s, i) => [i, s] as const)
		.filter((e): e is readonly [number, Circle] => e[1] !== null);
	if (!known.length) throw new Error("no circle found in any sample");
	const filled = samples.map(
		(s, i) =>
			s ??
			known.reduce((a, b) =>
				Math.abs(b[0] - i) < Math.abs(a[0] - i) ? b : a,
			)[1],
	);
	const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
	return filled.map((_, i) => {
		const win = filled.slice(Math.max(0, i - 2), i + 3);
		return {
			cx: median(win.map((c) => c.cx)),
			cy: median(win.map((c) => c.cy)),
			r: median(win.map((c) => c.r)),
		};
	});
}

/** Circle at a clip time (seconds), linearly interpolated between samples. */
export function circleAt(track: CircleTrack, sec: number): Circle {
	const { samples, fps } = track;
	const t = Math.max(0, Math.min(samples.length - 1, sec * fps));
	const i = Math.min(samples.length - 2, Math.floor(t));
	const f = t - i;
	const a = samples[i];
	const b = samples[i + 1] ?? a;
	return {
		cx: a.cx + (b.cx - a.cx) * f,
		cy: a.cy + (b.cy - a.cy) * f,
		r: a.r + (b.r - a.r) * f,
	};
}
