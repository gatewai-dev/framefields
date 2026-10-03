/**
 * DSP building blocks for the soundtrack pipeline: stereo buffers, a
 * zero-delay state-variable filter (band envelopes, structure detection) and
 * loudness measurement.
 */
import { SAMPLE_RATE } from "../grid.js";

export type Stereo = [Float32Array, Float32Array];

export const SR = SAMPLE_RATE;

export const stereo = (length: number): Stereo => [
	new Float32Array(length),
	new Float32Array(length),
];

export interface SvfOut {
	lp: number;
	bp: number;
	hp: number;
}

/** Cytomic trapezoidal state-variable filter: stable under fast cutoff sweeps. */
export class Svf {
	private ic1 = 0;
	private ic2 = 0;
	private readonly out: SvfOut = { lp: 0, bp: 0, hp: 0 };

	run(x: number, cutoff: number, resonance = 0.2): SvfOut {
		const g = Math.tan((Math.PI * Math.min(cutoff, SR * 0.45)) / SR);
		const k = 2 - 2 * Math.min(0.98, resonance);
		const a1 = 1 / (1 + g * (g + k));
		const a2 = g * a1;
		const a3 = g * a2;
		const v3 = x - this.ic2;
		const v1 = a1 * this.ic1 + a2 * v3;
		const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
		this.ic1 = 2 * v1 - this.ic1;
		this.ic2 = 2 * v2 - this.ic2;
		this.out.lp = v2;
		this.out.bp = v1;
		this.out.hp = x - k * v1 - v2;
		return this.out;
	}
}

export function rms(buf: Stereo): number {
	let sum = 0;
	for (const c of buf) for (let i = 0; i < c.length; i++) sum += c[i] * c[i];
	return Math.sqrt(sum / (buf[0].length * 2));
}
