/**
 * Human typing rhythm, shared by everything that types (text reveals,
 * terminals): seeded jitter, a beat after spaces, a pause after punctuation.
 */
import type { Rng } from "./rng.js";

/**
 * Keystroke frames for typing at `cps` characters a second: seeded ±30 %
 * jitter, a beat after spaces, a longer one after punctuation. Frame `k[i]`
 * is when character `i` appears.
 */
export function typingFrames(
	text: string,
	cps: number,
	fps: number,
	r: Rng,
	start = 0,
): number[] {
	const per = fps / cps;
	const out: number[] = [];
	let t = start;
	for (let i = 0; i < text.length; i++) {
		const prev = text[i - 1] ?? "";
		let gap = i === 0 ? 0 : per * (1 + r.spread(0.3));
		if (prev === " ") gap += per * 0.6;
		if (/[.,!?;:]/.test(prev)) gap += per * 3;
		t += gap;
		out.push(Math.max(start, Math.round(t)));
	}
	// Two characters never land on one frame.
	for (let i = 1; i < out.length; i++)
		out[i] = Math.max(out[i] as number, (out[i - 1] as number) + 1);
	return out;
}
