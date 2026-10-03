const { cbrt, sqrt, PI: π } = Math;

// Solve cubic bezier x(t) = x for t using Cardano's formula
// Parameters are precomputed coefficients from the bezier control points
const x2t = (x: number, a: number, b: number, c: number, d: number): number => {
	const q = a + b * x;
	const s = q ** 2 + c;
	if (s > 0) {
		const root = sqrt(s);
		return cbrt(q + root) + cbrt(q - root) - d;
	}
	const l = cbrt(sqrt(q * q - s));
	const angle = q ? Math.atan(sqrt(-s) / q) : -π / 2;
	let φ: number;
	if (b < 0) {
		φ = (q > 0 ? 2 * π : π) - angle;
	} else if (d < 0) {
		φ = (q > 0 ? 2 * π : -3 * π) + angle;
	} else {
		φ = (q > 0 ? 0 : π) + angle;
	}
	return 2 * l * Math.cos(φ / 3) - d;
};

const Y = (t: number, ay: number, by: number, cy: number): number =>
	((ay * t + 3 * by) * t + cy) * t;

const linearEasing = (x: number): number => x;

export function bezier(
	mX1: number,
	mY1: number,
	mX2: number,
	mY2: number,
): (x: number) => number {
	if (!(0 <= mX1 && mX1 <= 1 && 0 <= mX2 && mX2 <= 1)) {
		throw new Error("bezier x values must be in [0, 1] range");
	}

	if (mX1 === mY1 && mX2 === mY2) {
		return linearEasing;
	}

	const a = 6 * (3 * mX1 - 3 * mX2 + 1);
	const b = 6 * (mX2 - 2 * mX1);
	const c = 3 * mX1;

	const a2 = a * a;
	const b2 = b * b;

	const d = b / a;
	const e = (3 * b * c) / a2 - (b2 * b) / (a2 * a);
	const w1 = (2 * c) / a - b2 / a2;
	const w = w1 * w1 * w1;
	const o = 3 / a;

	const ay = 3 * mY1 - 3 * mY2 + 1;
	const by = mY2 - 2 * mY1;
	const cy = 3 * mY1;

	const X2T = a ? x2t : linearEasing;

	return function BezierEasing(x: number): number {
		if (x === 0 || x === 1) {
			return x;
		}
		return Y(X2T(x, e, o, w, d), ay, by, cy);
	};
}

export const Easing = {
	linear: linearEasing,
	ease: bezier(0.25, 0.1, 0.25, 1),
	quad: (t: number): number => t * t,
	cubic: (t: number): number => t * t * t,
	poly:
		(n: number) =>
		(t: number): number =>
			t ** n,
	sin: (t: number): number => 1 - Math.cos((t * Math.PI) / 2),
	circle: (t: number): number => 1 - Math.sqrt(1 - t * t),
	exp: (t: number): number => 2 ** (10 * (t - 1)),
	elastic: (bounciness = 1) => {
		const p = bounciness * Math.PI;
		return (t: number): number =>
			1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p);
	},
	back:
		(s = 1.70158) =>
		(t: number): number =>
			t * t * ((s + 1) * t - s),
	bounce: (t: number): number => {
		if (t < 1 / 2.75) {
			return 7.5625 * t * t;
		}
		if (t < 2 / 2.75) {
			const t2 = t - 1.5 / 2.75;
			return 7.5625 * t2 * t2 + 0.75;
		}
		if (t < 2.5 / 2.75) {
			const t2 = t - 2.25 / 2.75;
			return 7.5625 * t2 * t2 + 0.9375;
		}
		const t2 = t - 2.625 / 2.75;
		return 7.5625 * t2 * t2 + 0.984375;
	},
	bezier,
	in: <T extends (t: number) => number>(fn: T): T => fn,
	out:
		<T extends (t: number) => number>(fn: T): ((t: number) => number) =>
		(t: number): number =>
			1 - fn(1 - t),
	inOut:
		<T extends (t: number) => number>(fn: T): ((t: number) => number) =>
		(t: number): number =>
			t < 0.5 ? fn(t * 2) / 2 : 1 - fn((1 - t) * 2) / 2,
};

export interface InterpolateOptions {
	extrapolateLeft?: "clamp" | "extend" | "identity";
	extrapolateRight?: "clamp" | "extend" | "identity";
	easing?: (t: number) => number;
}

export function interpolate(
	value: number,
	inputRange: readonly number[],
	outputRange: readonly number[],
	options?: InterpolateOptions,
): number {
	const extrapolateLeft = options?.extrapolateLeft ?? "extend";
	const extrapolateRight = options?.extrapolateRight ?? "extend";

	if (inputRange.length !== outputRange.length) {
		throw new Error("inputRange and outputRange must have the same length");
	}
	if (inputRange.length < 2) {
		throw new Error("inputRange must have at least 2 elements");
	}

	// Handle boundaries
	const firstInput = inputRange[0];
	const lastInput = inputRange[inputRange.length - 1];

	if (value < firstInput) {
		if (extrapolateLeft === "clamp") {
			return outputRange[0];
		}
		if (extrapolateLeft === "identity") {
			return value;
		}
		// 'extend' flows through
	}

	if (value > lastInput) {
		if (extrapolateRight === "clamp") {
			return outputRange[outputRange.length - 1];
		}
		if (extrapolateRight === "identity") {
			return value;
		}
		// 'extend' flows through
	}

	// Find the segment containing the value, or boundaries for extrapolation
	let i = 1;
	for (; i < inputRange.length - 1; i++) {
		if (value < inputRange[i]) {
			break;
		}
	}

	const x0 = inputRange[i - 1];
	const x1 = inputRange[i];
	const y0 = outputRange[i - 1];
	const y1 = outputRange[i];

	if (x0 === x1) {
		return y0;
	}

	let progress = (value - x0) / (x1 - x0);

	if (options?.easing) {
		progress = options.easing(progress);
	}

	return y0 + progress * (y1 - y0);
}
