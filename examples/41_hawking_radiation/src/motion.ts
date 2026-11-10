/**
 * Keyframed numbers for shader uniforms. A scene writes its keys in its own
 * frames; uniforms are sampled on the composition's clock, so a track carries
 * the scene's start.
 */
import type { SceneTiming } from "./timeline.js";

export type Ease = "linear" | "in" | "out" | "inOut" | "hold";

/** `[frame, value, ease into this key]`; the ease defaults to `inOut`. */
export type Key = [frame: number, value: number, ease?: Ease];

const EASES: Record<Ease, (t: number) => number> = {
	linear: (t) => t,
	in: (t) => t * t * t,
	out: (t) => 1 - (1 - t) ** 3,
	inOut: (t) => t * t * t * (t * (t * 6 - 15) + 10),
	hold: () => 0,
};

/** The value of `keys` at scene-local `frame`. */
export function valueAt(keys: Key[], frame: number): number {
	const first = keys[0];
	if (!first) return 0;
	if (frame <= first[0]) return first[1];
	for (let i = 1; i < keys.length; i++) {
		const from = keys[i - 1];
		const to = keys[i];
		if (!from || !to) continue;
		if (frame <= to[0]) {
			const t = (frame - from[0]) / Math.max(1, to[0] - from[0]);
			return from[1] + (to[1] - from[1]) * EASES[to[2] ?? "inOut"](t);
		}
	}
	return keys.at(-1)?.[1] ?? 0;
}

/** A uniform that follows `keys` through scene `t`. */
export const track =
	(t: SceneTiming, keys: Key[]) =>
	(ctx: { frame: number }): number =>
		valueAt(keys, ctx.frame - t.start);

/** Every entry of `tracks` as a uniform of scene `t`, over the shader's defaults. */
export function uniforms<T extends Record<string, number>>(
	t: SceneTiming,
	defaults: T,
	tracks: Partial<Record<keyof T, Key[] | number>>,
): Record<string, number | ((ctx: { frame: number }) => number)> {
	const out: Record<string, number | ((ctx: { frame: number }) => number)> = {
		...defaults,
	};
	for (const [name, keys] of Object.entries(tracks)) {
		if (keys === undefined) continue;
		out[name] = typeof keys === "number" ? keys : track(t, keys as Key[]);
	}
	return out;
}
