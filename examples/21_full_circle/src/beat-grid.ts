/**
 * Measures the beat grid of a generated score so the cut list can be written
 * in bars instead of guessed frames.
 *
 *   onset envelope   log-energy flux (full band + kick band) at 100 Hz
 *   tempo            autocorrelation of the envelope, log-normal prior around the prompt's BPM
 *   beat phase       comb filter over the envelope, searched jointly with a ±0.6 % tempo
 *                    refinement (a 0.2 % tempo error drifts ~90 ms over a 36 s score)
 *   drop             the first beat in the loud tier after a full bar below it
 *   downbeat         the beat phase that puts the drop on a bar line: arrangements
 *                    change on downbeats, and a generated mix's kick pattern is too
 *                    ambiguous to say which beat is "one"
 */

export interface Bar {
	index: number;
	startSec: number;
	rmsDb: number;
}

export interface BeatGrid {
	bpm: number;
	beatSec: number;
	barSec: number;
	/** First downbeat at or after 0 s; bar 0 starts here. */
	downbeatSec: number;
	durationSec: number;
	/** Bar where the loudness jumps the most: the drop. */
	dropBar: number;
	bars: Bar[];
}

export interface AnalyzeOptions {
	bpmHint?: number;
	minBpm?: number;
	maxBpm?: number;
	beatsPerBar?: number;
}

const ENVELOPE_HZ = 100;
const KICK_HZ = 150;

export function analyzeBeatGrid(
	samples: Float32Array,
	sampleRate: number,
	o: AnalyzeOptions = {},
): BeatGrid {
	const beatsPerBar = o.beatsPerBar ?? 4;
	const hop = Math.round(sampleRate / ENVELOPE_HZ);
	const rate = sampleRate / hop;
	const { full, kick } = envelopes(samples, sampleRate, hop);
	const flux = onset(full);
	const kickFlux = onset(kick);
	const strength = flux.map((v, i) => v + kickFlux[i]);

	const coarse = tempo(
		strength,
		rate,
		o.bpmHint ?? 120,
		o.minBpm ?? 70,
		o.maxBpm ?? 180,
	);
	const { period, phase } = refine(strength, coarse);

	const durationSec = samples.length / sampleRate;
	const beatSec = period / rate;
	const barSec = beatSec * beatsPerBar;
	const beats = loudness(full, rate, phase / rate, beatSec, durationSec);
	const dropBeat = findDrop(beats, beatsPerBar);
	const downbeatSec =
		(phase / rate + (dropBeat % beatsPerBar) * beatSec) % barSec;
	return {
		bpm: 60 / beatSec,
		beatSec,
		barSec,
		downbeatSec,
		durationSec,
		dropBar: Math.round((beats[dropBeat].startSec - downbeatSec) / barSec),
		bars: loudness(full, rate, downbeatSec, barSec, durationSec),
	};
}

/** Mean-square energy per hop, full band and through a one-pole low-pass (the kick band). */
function envelopes(samples: Float32Array, sampleRate: number, hop: number) {
	const n = Math.floor(samples.length / hop);
	const full = new Float32Array(n);
	const kick = new Float32Array(n);
	const a = 1 - Math.exp((-2 * Math.PI * KICK_HZ) / sampleRate);
	let lp = 0;
	for (let i = 0; i < n; i++) {
		let e = 0;
		let k = 0;
		for (let j = i * hop; j < (i + 1) * hop; j++) {
			const x = samples[j];
			lp += a * (x - lp);
			e += x * x;
			k += lp * lp;
		}
		full[i] = e / hop;
		kick[i] = k / hop;
	}
	return { full, kick };
}

/** Half-wave rectified log-energy flux with its local (0.5 s) mean removed. */
function onset(energy: Float32Array): Float32Array {
	const n = energy.length;
	const flux = new Float32Array(n);
	for (let i = 1; i < n; i++) {
		flux[i] = Math.max(
			0,
			Math.log10(energy[i] + 1e-10) - Math.log10(energy[i - 1] + 1e-10),
		);
	}
	const half = Math.round(ENVELOPE_HZ / 4);
	const out = new Float32Array(n);
	let sum = 0;
	for (let i = 0; i < Math.min(n, half); i++) sum += flux[i];
	for (let i = 0; i < n; i++) {
		if (i + half < n) sum += flux[i + half];
		if (i - half - 1 >= 0) sum -= flux[i - half - 1];
		const count = Math.min(n - 1, i + half) - Math.max(0, i - half) + 1;
		out[i] = Math.max(0, flux[i] - sum / count);
	}
	return out;
}

/** Beat period in envelope frames (fractional). */
function tempo(
	env: Float32Array,
	rate: number,
	hint: number,
	minBpm: number,
	maxBpm: number,
): number {
	const minLag = Math.floor((60 * rate) / maxBpm);
	const maxLag = Math.ceil((60 * rate) / minBpm);
	const score = new Float64Array(maxLag + 2);
	let best = minLag;
	for (let lag = minLag; lag <= maxLag + 1; lag++) {
		let r = 0;
		for (let i = lag; i < env.length; i++) r += env[i] * env[i - lag];
		const bpm = (60 * rate) / lag;
		// Log-normal prior: octave errors (60 vs 120 vs 240) cost the same, a hint breaks ties.
		const prior = Math.exp(-0.5 * (Math.log2(bpm / hint) / 0.6) ** 2);
		score[lag] = (r / (env.length - lag)) * prior;
		if (lag <= maxLag && score[lag] > score[best]) best = lag;
	}
	return (
		best + parabolicOffset(score[best - 1] ?? 0, score[best], score[best + 1])
	);
}

function parabolicOffset(a: number, b: number, c: number): number {
	const d = a - 2 * b + c;
	return d === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d));
}

/**
 * Autocorrelation lags are whole frames; a comb that has to line up with every
 * beat across the whole track pins the period far tighter.
 */
function refine(
	env: Float32Array,
	coarse: number,
): { period: number; phase: number } {
	let best = { period: coarse, phase: 0, score: -1 };
	for (let p = coarse * 0.994; p <= coarse * 1.006; p += 0.01) {
		const phase = bestPhase(env, p);
		const score = combScore(env, p, phase);
		if (score > best.score) best = { period: p, phase, score };
	}
	return best;
}

function combScore(env: Float32Array, stride: number, offset: number): number {
	let s = 0;
	for (let t = offset; t < env.length; t += stride) s += sampleAt(env, t);
	return s;
}

const sampleAt = (env: Float32Array, t: number) => {
	const i = Math.floor(t);
	const f = t - i;
	return (env[i] ?? 0) * (1 - f) + (env[i + 1] ?? 0) * f;
};

/** Comb filter: the offset within one `stride` whose pulses collect the most envelope. */
function bestPhase(env: Float32Array, stride: number): number {
	let best = 0;
	let bestScore = -1;
	for (let p = 0; p < stride; p += 0.25) {
		const s = combScore(env, stride, p);
		if (s > bestScore) {
			bestScore = s;
			best = p;
		}
	}
	return best;
}

/** Loudness of consecutive `stepSec` spans from `startSec` (beats or bars). */
function loudness(
	full: Float32Array,
	rate: number,
	startSec: number,
	stepSec: number,
	durationSec: number,
): Bar[] {
	const spans: Bar[] = [];
	for (let index = 0; startSec + index * stepSec < durationSec; index++) {
		const from = startSec + index * stepSec;
		const a = Math.floor(from * rate);
		const b = Math.min(full.length, Math.floor((from + stepSec) * rate));
		let e = 0;
		for (let i = a; i < b; i++) e += full[i];
		spans.push({
			index,
			startSec: from,
			rmsDb: 10 * Math.log10(e / Math.max(1, b - a) + 1e-10),
		});
	}
	return spans;
}

/**
 * The drop: the first span that reaches the track's loud tier (within 4 dB of
 * its 90th-percentile loudness) after a full `lookback` of spans below it. A
 * plain "largest jump" picks the intro rising out of silence instead.
 */
function findDrop(spans: Bar[], lookback: number): number {
	const sorted = spans.map((s) => s.rmsDb).sort((x, y) => x - y);
	const loud = sorted[Math.floor(sorted.length * 0.9)] - 4;
	for (let i = lookback; i < spans.length; i++) {
		if (spans[i].rmsDb < loud) continue;
		if (spans.slice(i - lookback, i).every((s) => s.rmsDb < loud)) return i;
	}
	return lookback;
}
