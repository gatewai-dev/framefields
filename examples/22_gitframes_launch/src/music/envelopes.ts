/**
 * Per-frame envelopes for the picture, from the separated stems: the drum
 * stem's kick band (below ~120 Hz) and snare band (~1.5–4 kHz) as 0–1 onset
 * envelopes, and the vocal stem's loudness.
 */
import { FPS } from "../grid.js";
import { SR, type Stereo, Svf } from "./dsp.js";

export interface Envelopes {
	fps: number;
	kick: number[];
	snare: number[];
	vocal: number[];
}

const HOP = SR / FPS;

function bandEnergy(
	mix: Stereo,
	band: (x: number, f: Svf) => number,
): Float32Array {
	const frames = Math.floor(mix[0].length / HOP);
	const out = new Float32Array(frames);
	const filter = new Svf();
	for (let f = 0; f < frames; f++) {
		let e = 0;
		for (let i = f * HOP; i < (f + 1) * HOP; i++) {
			const y = band((mix[0][i] + mix[1][i]) * 0.5, filter);
			e += y * y;
		}
		out[f] = Math.log10(e / HOP + 1e-9);
	}
	return out;
}

/** Positive log-energy flux, normalised to its 98th percentile and clamped to 0–1. */
function onset(energy: Float32Array): Float32Array {
	const flux = new Float32Array(energy.length);
	for (let i = 1; i < energy.length; i++)
		flux[i] = Math.max(0, energy[i] - energy[i - 1]);
	const ref =
		[...flux].sort((a, b) => a - b)[Math.floor(flux.length * 0.98)] || 1;
	return flux.map((v) => Math.min(1, v / ref));
}

/** Holds each onset and lets it decay, so a hit reads for a few frames. */
function decay(onsets: Float32Array, frames: number): number[] {
	const out: number[] = [];
	let level = 0;
	for (const v of onsets) {
		level = Math.max(v, level * Math.exp(-1 / frames));
		out.push(Number(level.toFixed(4)));
	}
	return out;
}

export function envelopes(drums: Stereo, vocals: Stereo): Envelopes {
	const kick = onset(bandEnergy(drums, (x, f) => f.run(x, 120, 0.3).lp));
	const snare = onset(bandEnergy(drums, (x, f) => f.run(x, 2400, 0.55).bp));
	const loud = bandEnergy(vocals, (x) => x);
	const lo = Math.min(...loud);
	const hi = Math.max(...loud);
	return {
		fps: FPS,
		kick: decay(kick, 5),
		snare: decay(snare, 4),
		vocal: [...loud].map((v) => Number(((v - lo) / (hi - lo)).toFixed(4))),
	};
}
