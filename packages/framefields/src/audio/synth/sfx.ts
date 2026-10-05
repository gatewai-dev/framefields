/**
 * @file packages/framefields/src/audio/synth/sfx.ts
 * Deterministic procedural transition effects (whoosh, riser, impact, downshifter, glitch).
 * Pure CPU DSP: the same trigger always renders the same samples.
 */

/**
 * Procedural sound effect transition event, synthesized deterministically on the CPU.
 * Default durations: whoosh 0.7s, riser 2s, impact 1.8s, downshifter 1.2s, glitch 0.35s.
 */
export interface SfxTrigger {
	type: "whoosh" | "riser" | "impact" | "downshifter" | "glitch";
	/** Bar (fractional allowed) where the effect *starts*. A riser landing on a cut starts `durationSec` earlier. */
	atBar: number;
	durationSec?: number;
	volume?: number;
}

export type StereoBuffer = [Float32Array, Float32Array];

export interface RenderedSfx {
	/** First sample of the effect on the score timeline. */
	startSample: number;
	channels: StereoBuffer;
}

export interface SfxRenderContext {
	sampleRate: number;
	secondsPerBar: number;
	/** Distinguishes otherwise identical triggers so noise differs between them. */
	seed: number;
}

const DEFAULT_DURATION_SEC: Record<SfxTrigger["type"], number> = {
	whoosh: 0.7,
	riser: 2,
	impact: 1.8,
	downshifter: 1.2,
	glitch: 0.35,
};

/** Small, fast, seedable PRNG returning values in [-1, 1). */
function createNoise(seed: number): () => number {
	let state = (seed ^ 0x9e3779b9) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
	};
}

/** Chamberlin state-variable filter; returns the band-pass output of one sample. */
class BandPass {
	private low = 0;
	private band = 0;

	public process(
		input: number,
		freq: number,
		q: number,
		sampleRate: number,
	): number {
		const f =
			2 * Math.sin((Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate);
		this.low += f * this.band;
		const high = input - this.low - q * this.band;
		this.band += f * high;
		return this.band;
	}
}

/** Exponential sweep from `a` to `b` as `x` moves 0 → 1. */
const expSweep = (a: number, b: number, x: number): number => a * (b / a) ** x;

/** Fast rise, longer fall: a bell centred at `peak` in 0..1. */
const bell = (x: number, peak: number): number =>
	x < peak
		? Math.sin((x / peak) * (Math.PI / 2)) ** 2
		: Math.cos(((x - peak) / (1 - peak)) * (Math.PI / 2)) ** 2;

function whoosh(
	n: number,
	sr: number,
	noise: () => number,
	reverse: boolean,
): StereoBuffer {
	const left = new Float32Array(n);
	const right = new Float32Array(n);
	const filter = new BandPass();
	for (let i = 0; i < n; i++) {
		const x = i / n;
		const sweep = reverse ? 1 - x : x;
		const env = bell(x, reverse ? 0.35 : 0.6);
		const s =
			filter.process(noise(), expSweep(250, 7000, sweep), 0.35, sr) * env * 0.9;
		const pan = (reverse ? 1 - x : x) * 2 - 1;
		left[i] = s * Math.sqrt((1 - pan) / 2) * 1.4;
		right[i] = s * Math.sqrt((1 + pan) / 2) * 1.4;
	}
	return [left, right];
}

function riser(
	n: number,
	sr: number,
	noise: () => number,
	reverse: boolean,
): StereoBuffer {
	const left = new Float32Array(n);
	const right = new Float32Array(n);
	const air = new BandPass();
	let phase = 0;
	for (let i = 0; i < n; i++) {
		const x = i / n;
		const sweep = reverse ? 1 - x : x;
		const env = reverse ? (1 - x) ** 1.5 : x ** 2.2;
		const freq = expSweep(110, 880, sweep);
		phase += (2 * Math.PI * freq) / sr;
		// Band-limited enough at these pitches: two detuned-free partials of a saw.
		const tone =
			(Math.sin(phase) +
				0.5 * Math.sin(phase * 2) +
				0.25 * Math.sin(phase * 3)) *
			0.3;
		const hiss =
			air.process(noise(), expSweep(300, 9000, sweep), 0.5, sr) * 1.2;
		const s = (tone + hiss) * env * 0.6;
		left[i] = s;
		right[i] = s;
	}
	return [left, right];
}

function impact(n: number, sr: number, noise: () => number): StereoBuffer {
	const left = new Float32Array(n);
	const right = new Float32Array(n);
	const burst = new BandPass();
	let phase = 0;
	for (let i = 0; i < n; i++) {
		const t = i / sr;
		const freq = 38 + 62 * Math.exp(-t * 14);
		phase += (2 * Math.PI * freq) / sr;
		const sub = Math.sin(phase) * Math.exp(-t * 2.6);
		const body =
			burst.process(noise(), 900 * Math.exp(-t * 6) + 120, 0.6, sr) *
			Math.exp(-t * 9) *
			1.6;
		const click = i < 96 ? noise() * (1 - i / 96) * 0.5 : 0;
		const s = (sub * 1.1 + body + click) * 0.85;
		// Slight decorrelated tail widens the hit without smearing the transient.
		const tail = noise() * Math.exp(-t * 5) * 0.08;
		left[i] = s + tail;
		right[i] = s - tail;
	}
	return [left, right];
}

function glitch(n: number, sr: number, noise: () => number): StereoBuffer {
	const left = new Float32Array(n);
	const right = new Float32Array(n);
	const slice = Math.max(1, Math.round(sr * 0.022));
	let held = 0;
	let gate = 1;
	let crush = 1;
	for (let i = 0; i < n; i++) {
		if (i % slice === 0) {
			gate = noise() > -0.2 ? 1 : 0;
			crush = 2 + Math.floor((noise() + 1) * 6);
		}
		if (i % crush === 0) held = noise() > 0 ? 1 : -1;
		const env = 1 - i / n;
		const s = held * gate * env * 0.45;
		left[i] = s;
		right[i] = gate ? -s * 0.6 : 0;
	}
	return [left, right];
}

/**
 * Renders one trigger to stereo PCM positioned at `atBar` on the score timeline.
 * `atBar` is where the effect *starts*; a riser meant to land on a cut starts
 * `durationSec / secondsPerBar` bars before it.
 */
export function renderSfx(
	trigger: SfxTrigger,
	ctx: SfxRenderContext,
): RenderedSfx {
	const durationSec = trigger.durationSec ?? DEFAULT_DURATION_SEC[trigger.type];
	const sr = ctx.sampleRate;
	const n = Math.max(1, Math.round(durationSec * sr));
	const noise = createNoise(ctx.seed + n);

	let channels: StereoBuffer;
	switch (trigger.type) {
		case "whoosh":
			channels = whoosh(n, sr, noise, false);
			break;
		case "riser":
			channels = riser(n, sr, noise, false);
			break;
		case "downshifter":
			channels = riser(n, sr, noise, true);
			break;
		case "impact":
			channels = impact(n, sr, noise);
			break;
		case "glitch":
			channels = glitch(n, sr, noise);
			break;
	}

	const gain = trigger.volume ?? 0.8;
	for (const channel of channels) {
		for (let i = 0; i < n; i++)
			channel[i] = Math.tanh((channel[i] ?? 0) * gain);
	}
	return {
		startSample: Math.max(
			0,
			Math.round(trigger.atBar * ctx.secondsPerBar * sr),
		),
		channels,
	};
}

/** Adds rendered effects into `target` in place, clipping to its length. */
export function mixSfxInto(
	target: StereoBuffer,
	effects: readonly RenderedSfx[],
): void {
	for (const fx of effects) {
		for (let c = 0; c < 2; c++) {
			const dst = target[c];
			const src = fx.channels[c];
			if (!dst || !src) continue;
			const limit = Math.min(src.length, dst.length - fx.startSample);
			for (let i = 0; i < limit; i++) {
				const val = dst[fx.startSample + i];
				const s = src[i];
				if (val !== undefined && s !== undefined) {
					dst[fx.startSample + i] = val + s;
				}
			}
		}
	}
}

/**
 * Soft-knee limiter for sums that may exceed full scale (impacts stacked on a
 * loud mix): transparent below the knee, asymptotically bounded by 1.0 above it.
 */
export function softLimit(
	target: StereoBuffer,
	knee = 0.7,
	ceiling = 0.97,
): void {
	const headroom = ceiling - knee;
	for (const channel of target) {
		for (let i = 0; i < channel.length; i++) {
			const x = channel[i] ?? 0;
			const a = Math.abs(x);
			if (a > knee)
				channel[i] =
					Math.sign(x) * (knee + headroom * Math.tanh((a - knee) / headroom));
		}
	}
}
