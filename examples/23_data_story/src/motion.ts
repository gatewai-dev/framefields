/**
 * Motion helpers built on gsap.
 *
 * framefields already evaluates every `ease` string with gsap, so single moves
 * are plain `fromTo` calls. gsap is used directly for what keyframes can't say
 * on their own:
 *
 * - `bake` scrubs a paused gsap timeline frame by frame and writes the values
 *   out as keyframes, so multi-step choreography (staggers, overlaps, labels)
 *   is authored the gsap way and still renders deterministically.
 * - `envelope` turns a gsap ease into a curve that signal functions can sample.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { gsap } from "./gsap.js";
import { FPS, MONO, TEXT } from "./theme.js";

/** A gsap ease as a plain (t: 0..1) => value function. */
export const envelope = (ease: string): ((t: number) => number) =>
	gsap.parseEase(ease);

/** Frame → gsap timeline seconds. */
export const sec = (frames: number) => frames / FPS;

/**
 * Samples `props` of `target` while scrubbing `tl` from frame `from` to `to`
 * and returns the samples as keyframes. Sampling every `step` frames keeps a
 * long move under the 128-keyframes-per-layer budget; the engine interpolates
 * linearly in between.
 */
export function bake<T extends Record<string, number>>(
	tl: gsap.core.Timeline,
	target: T,
	props: readonly (keyof T & string)[],
	from: number,
	to: number,
	step = 2,
): LayerAnimation {
	const keys: Record<string, [number, number, string][]> = {};
	for (const p of props) keys[p] = [];
	for (let f = from; ; f = Math.min(to, f + step)) {
		tl.totalTime(sec(f), false);
		for (const p of props) keys[p].push([f, target[p], "none"]);
		if (f >= to) break;
	}
	const anim = LayerAnimation.create();
	for (const p of props) anim.keys(p as never, dropFlatRuns(keys[p]));
	return anim;
}

/** Collapses runs of equal samples to their ends: holds cost two keys, not twenty. */
function dropFlatRuns(
	keys: [number, number, string][],
): [number, number, string][] {
	return keys.filter(
		(k, i) =>
			i === 0 ||
			i === keys.length - 1 ||
			Math.abs(k[1] - keys[i - 1][1]) > 1e-3 ||
			Math.abs(k[1] - keys[i + 1][1]) > 1e-3,
	);
}

export interface OdometerOptions {
	id: string;
	x: number;
	y: number;
	/** Glyph size; each digit cell is `size * 0.62` wide and `size * 1.2` tall. */
	size: number;
	/** Frame the first value starts rolling in, relative to the parent scene (string form). */
	at?: number;
	color?: string;
	/** Frames between neighbouring digits starting their first roll. */
	stagger?: number;
	/** Frames the first roll takes. */
	duration?: number;
	/** Frames each later change takes. */
	change?: number;
}

/** A value the counter rolls to at frame `at`. Every value has the same length. */
export interface OdometerState {
	at: number;
	value: string;
}

/**
 * A rolling-digit counter. Each digit is a "0…9" strip in a clipped cell. The
 * first value rolls in from zero with a stagger, so the rightmost digits spin
 * longest the way a mechanical counter settles; every later value rolls each
 * strip straight to its new digit. It is all one gsap timeline, and `bake`
 * writes it out as keyframes. Non-digit characters ("+", "%", "$", ",", ".")
 * sit still.
 */
export function odometer(
	values: string | readonly OdometerState[],
	o: OdometerOptions,
): LayoutNode {
	const states =
		typeof values === "string" ? [{ at: o.at ?? 0, value: values }] : values;
	const first = states[0];
	const cellW = Math.round(o.size * 0.62);
	const cellH = Math.round(o.size * 1.2);
	const color = o.color ?? TEXT;
	const stagger = o.stagger ?? 3;
	const duration = o.duration ?? 36;
	const change = o.change ?? 14;
	const width = first.value.length;
	if (states.some((s) => s.value.length !== width))
		throw new Error(`odometer ${o.id}: every value needs ${width} characters`);

	const digits = [...first.value]
		.map((ch, i) => ({ ch, i }))
		.filter((d) => /\d/.test(d.ch));
	const strips = digits.map(() => ({ y: 0 }));
	const tl = gsap.timeline({ paused: true });
	let end = first.at;
	digits.forEach((d, k) => {
		// Extra turns on the first roll: two for the rightmost digits, fewer to the left.
		const band = Math.max(0, 2 - Math.floor((digits.length - 1 - k) / 2)) * 10;
		const roll = duration + k * stagger;
		tl.to(
			strips[k],
			{
				y: -(Number(d.ch) + band) * cellH,
				duration: sec(roll),
				ease: "power4.out",
			},
			sec(first.at + k * stagger),
		);
		end = Math.max(end, first.at + k * stagger + roll);
		for (const state of states.slice(1)) {
			const digit = Number(state.value[d.i]);
			tl.to(
				strips[k],
				{
					y: -(digit + band) * cellH,
					duration: sec(change),
					ease: "power3.out",
				},
				sec(state.at),
			);
			end = Math.max(end, state.at + change);
		}
	});

	const reel = Array.from({ length: 30 }, (_, n) => n % 10).join("\n");
	const children = [...first.value].map((ch, i) => {
		const cell = {
			position: "absolute" as const,
			x: i * cellW,
			y: 0,
			width: cellW,
			height: cellH,
		};
		const k = digits.findIndex((d) => d.i === i);
		if (k < 0) {
			return Layer.text(ch, {
				id: `${o.id}-glyph-${i}`,
				...cell,
				fontFamily: MONO,
				fontSize: o.size,
				fontWeight: 700,
				lineHeight: cellH,
				fill: color,
				align: "center",
				verticalAlign: "middle",
			});
		}
		return Layer.box({
			id: `${o.id}-cell-${i}`,
			...cell,
			overflow: "hidden",
			children: [
				Layer.text(reel, {
					id: `${o.id}-strip-${i}`,
					position: "absolute",
					x: 0,
					y: 0,
					width: cellW,
					height: cellH * 30,
					fontFamily: MONO,
					fontSize: o.size,
					fontWeight: 700,
					lineHeight: cellH,
					fill: color,
					align: "center",
				}).animate(bake(tl, strips[k], ["y"], Math.max(0, first.at - 1), end)),
			],
		});
	});

	return Layer.box({
		id: o.id,
		position: "absolute",
		x: o.x,
		y: o.y,
		width: cellW * width,
		height: cellH,
		children,
	}).animate(
		LayerAnimation.create()
			.fromTo("opacity", 0, 1, {
				start: Math.max(0, first.at - 8),
				end: first.at + 2,
				ease: "power2.out",
			})
			.fromTo("y", o.y + 24, o.y, {
				start: Math.max(0, first.at - 8),
				end: first.at + 10,
				ease: "expo.out",
			}),
	);
}
