/**
 * The film's signals. Each is a per-frame function registered on the
 * composition under a name; layers bind to them with
 * `LayerAnimation.signal(prop, name, { multiplier, offset })`, which sets the
 * prop to `value × multiplier + offset` every frame.
 *
 * Register before binding: `.signal()` resolves signals by name, so pass the
 * name, not the signal object.
 *
 * Signal functions see the composition frame (`ctx.frame`), not the layer's
 * local frame, so anything tied to a scene takes that scene's start.
 */
import { type Composition, Signal } from "gitframes";
import { envelope } from "./motion.js";
import { BEAT } from "./theme.js";

export const PULSE = "pulse";
export const BREATHE = "breathe";

const hit = envelope("expo.out");
const swell = envelope("sine.inOut");

/** 1 on every beat, falling off along gsap's expo.out: a kick-drum envelope. */
export function pulseAt(frame: number): number {
	const phase = (((frame % BEAT) + BEAT) % BEAT) / BEAT;
	return 1 - hit(phase);
}

/** A slow 0 → 1 → 0 swell over four beats, eased with sine.inOut. */
export function breatheAt(frame: number): number {
	const period = BEAT * 4;
	const t = (((frame % period) + period) % period) / period;
	return swell(t < 0.5 ? t * 2 : 2 - t * 2);
}

export function registerSignals(comp: Composition): void {
	comp.addSignal(
		PULSE,
		Signal.builder({ type: "custom", fn: (ctx) => pulseAt(ctx.frame) }),
	);
	comp.addSignal(
		BREATHE,
		Signal.builder({ type: "custom", fn: (ctx) => breatheAt(ctx.frame) }),
	);
}
