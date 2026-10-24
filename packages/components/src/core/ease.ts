/**
 * Ease evaluation for planning and baking. Accepts exactly the eases the
 * keyframe schema accepts (`"power2.out"`, `"back.out(1.7)"`,
 * `"elastic.out(1, 0.3)"`, `"hold"` …; `"spring"` is renderer-only), so a
 * curve a component bakes looks like the same ease keyed directly.
 */

export type EaseFn = (t: number) => number;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** The "in" form of each base curve; `out` and `inOut` derive from it. */
const BASES: Record<string, (params: number[]) => EaseFn> = {
	none: () => (x) => x,
	linear: () => (x) => x,
	power1: () => (x) => x * x,
	power2: () => (x) => x * x * x,
	cubic: () => (x) => x * x * x,
	power3: () => (x) => x ** 4,
	sine: () => (x) => 1 - Math.cos((x * Math.PI) / 2),
	circ: () => (x) => 1 - Math.sqrt(Math.max(0, 1 - x * x)),
	expo: () => (x) => (x === 0 ? 0 : 2 ** (10 * (x - 1))),
	back:
		([overshoot = 1.70158]) =>
		(x) =>
			(overshoot + 1) * x * x * x - overshoot * x * x,
	elastic: ([amplitude = 1, period = 0.3]) => {
		const a = Math.max(1, amplitude);
		const s = (period / (2 * Math.PI)) * Math.asin(1 / a);
		return (x) =>
			x === 0 || x === 1
				? x
				: -(
						a *
						2 ** (10 * (x - 1)) *
						Math.sin(((x - 1 - s) * (2 * Math.PI)) / period)
					);
	},
	bounce: () => (x) => 1 - bounceOut(1 - x),
};

function bounceOut(x: number): number {
	const n1 = 7.5625;
	const d1 = 2.75;
	if (x < 1 / d1) return n1 * x * x;
	if (x < 2 / d1) return n1 * (x - 1.5 / d1) ** 2 + 0.75;
	if (x < 2.5 / d1) return n1 * (x - 2.25 / d1) ** 2 + 0.9375;
	return n1 * (x - 2.625 / d1) ** 2 + 0.984375;
}

const cache = new Map<string, EaseFn>();

/** Parse an ease name into a function on [0, 1]. Unknown names throw. */
export function ease(name: string | undefined): EaseFn {
	if (!name) return (t) => clamp01(t);
	const cached = cache.get(name);
	if (cached) return cached;

	const match = name
		.trim()
		.match(/^([a-zA-Z0-9]+)(?:\.([a-zA-Z]+))?(?:\(([^)]*)\))?$/);
	if (!match) throw new Error(`Unknown ease "${name}"`);
	const base = (match[1] ?? "").toLowerCase();
	const dir = (match[2] ?? "out").toLowerCase();
	const params = (match[3] ?? "")
		.split(",")
		.map((s) => Number.parseFloat(s))
		.filter((n) => !Number.isNaN(n));

	let fn: EaseFn;
	if (base === "hold") {
		fn = (t) => (t >= 1 ? 1 : 0);
	} else {
		const make = BASES[base];
		if (!make) throw new Error(`Unknown ease "${name}"`);
		const easeIn = make(params);
		if (dir === "in") fn = (t) => easeIn(clamp01(t));
		else if (dir === "inout")
			fn = (t) => {
				const s = clamp01(t);
				return s < 0.5 ? easeIn(s * 2) / 2 : 1 - easeIn((1 - s) * 2) / 2;
			};
		else if (dir === "out") fn = (t) => 1 - easeIn(1 - clamp01(t));
		else throw new Error(`Unknown ease direction in "${name}"`);
	}
	cache.set(name, fn);
	return fn;
}

/** `ease(name)(t)` in one call. */
export function evaluateEase(name: string | undefined, t: number): number {
	return ease(name)(t);
}
