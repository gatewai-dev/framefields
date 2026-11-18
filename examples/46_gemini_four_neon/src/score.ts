/**
 * Bespoke 48 kHz stereo score for the 20-second Gemini 4 Neon showcase.
 * Synthesized deterministically in code and mathematically locked to every
 * visual hit in `BEAT`: ignition (2.0s), neural lock (6.0s), build verified
 * (10.0s), Voronoi shatter (13.0s), and hero star convergence (17.0s).
 */
import { BEAT, BEAT_FRAMES, clamp01, DURATION, FPS } from "./theme.js";

export const SCORE_RATE = 48000;
const TAU = Math.PI * 2;
const sec = (frame: number) => frame / FPS;
const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);

export type StereoBuffer = [Float32Array, Float32Array];

function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const smooth = (x: number) => {
	const t = clamp01(x);
	return t * t * (3 - 2 * t);
};

interface ChordSpec {
	readonly from: number;
	readonly to: number;
	readonly attack: number;
	readonly notes: readonly number[];
	readonly bright: readonly [number, number];
	readonly gain: number;
}

const STEP = sec(BEAT_FRAMES);
const END = sec(DURATION);

/**
 * Harmonic progression in C minor → radiant C add9 resolution on `starLock`:
 *   Bar 0–1  (0–2s):   C5 obsidian drone building into ignition
 *   Bar 1–2  (2–4s):   Cm9 electric bloom
 *   Bar 2–4  (4–8s):   Ab maj9 → Eb maj9 (reasoning lattice expansion)
 *   Bar 4–6  (8–12s):  Fm9 → G sus4 (agentic momentum & verification)
 *   Bar 6–8  (12–16s): Ab maj7#11 → Bb add9 (omni-modal shatter energy)
 *   Bar 8–8.5(16–17s): G sus4 shimmer rise (swarm gathering)
 *   Bar 8.5–10(17–20s):C add9 monumental resolution
 */
const CHORDS: readonly ChordSpec[] = [
	{
		from: 0,
		to: sec(BEAT.ignite),
		attack: 1.7,
		notes: [36, 43, 48, 55],
		bright: [0.12, 0.55],
		gain: 0.9,
	},
	{
		from: sec(BEAT.ignite),
		to: sec(BEAT.reasoningIn) + 0.12,
		attack: 0.04,
		notes: [36, 48, 55, 58, 62, 63, 67],
		bright: [0.68, 0.52],
		gain: 1.25,
	},
	{
		from: sec(BEAT.reasoningIn),
		to: sec(BEAT.latticeLock) + 0.12,
		attack: 0.12,
		notes: [32, 44, 51, 55, 58, 60, 67],
		bright: [0.54, 0.66],
		gain: 1.25,
	},
	{
		from: sec(BEAT.latticeLock),
		to: sec(BEAT.agenticIn) + 0.12,
		attack: 0.08,
		notes: [39, 46, 51, 58, 62, 63, 67],
		bright: [0.7, 0.58],
		gain: 1.3,
	},
	{
		from: sec(BEAT.agenticIn),
		to: sec(BEAT.buildPass) + 0.12,
		attack: 0.08,
		notes: [41, 48, 53, 56, 60, 63, 67],
		bright: [0.58, 0.72],
		gain: 1.3,
	},
	{
		from: sec(BEAT.buildPass),
		to: sec(BEAT.omnimodalIn) + 0.12,
		attack: 0.06,
		notes: [43, 50, 55, 60, 62, 67, 72],
		bright: [0.74, 0.64],
		gain: 1.32,
	},
	{
		from: sec(BEAT.omnimodalIn),
		to: sec(BEAT.shatterOrbit) + 0.12,
		attack: 0.08,
		notes: [32, 44, 51, 55, 60, 62, 67],
		bright: [0.62, 0.84],
		gain: 1.35,
	},
	{
		from: sec(BEAT.shatterOrbit),
		to: sec(BEAT.finaleIn) + 0.12,
		attack: 0.12,
		notes: [34, 46, 53, 58, 60, 65, 69],
		bright: [0.78, 0.6],
		gain: 1.3,
	},
	{
		from: sec(BEAT.finaleIn),
		to: sec(BEAT.starLock) + 0.08,
		attack: 0.15,
		notes: [43, 50, 55, 60, 62, 67, 74],
		bright: [0.45, 0.85],
		gain: 1.15,
	},
	{
		from: sec(BEAT.starLock),
		to: END - 0.15,
		attack: 0.04,
		notes: [24, 36, 43, 48, 52, 55, 60, 62, 67, 72],
		bright: [0.76, 0.24],
		gain: 1.3,
	},
];

const chordAt = (t: number): ChordSpec => {
	for (let i = CHORDS.length - 1; i >= 0; i--) {
		const c = CHORDS[i];
		if (c && t >= c.from) return c;
	}
	return CHORDS[0] as ChordSpec;
};

/** Lush detuned harmonic synth pad for one note. */
function renderPadNote(
	out: StereoBuffer,
	chord: ChordSpec,
	note: number,
	rand: () => number,
): void {
	const f0 = midi(note);
	const release = 0.65;
	const start = Math.max(0, Math.floor(chord.from * SCORE_RATE));
	const end = Math.min(
		out[0].length,
		Math.floor((chord.to + release) * SCORE_RATE),
	);
	const weight = (note < 38 ? 0.92 : note < 52 ? 0.62 : 0.36) * chord.gain;
	const span = Math.max(0.1, chord.to - chord.from);

	for (let v = 0; v < 3; v++) {
		const detuneCents = (v - 1) * 6.5 + (rand() - 0.5) * 3;
		const f = f0 * 2 ** (detuneCents / 1200);
		const pan = note < 45 ? 0 : (v - 1) * 0.6 + (rand() - 0.5) * 0.2;
		const phases = Array.from({ length: 7 }, () => rand() * TAU);
		const lfoFreq = 0.12 + rand() * 0.14;
		const lfoPhase = rand() * TAU;
		const gl = weight * Math.SQRT1_2 * (1 - pan * 0.65);
		const gr = weight * Math.SQRT1_2 * (1 + pan * 0.65);

		for (let i = start; i < end; i++) {
			const t = i / SCORE_RATE;
			const local = t - chord.from;
			const env =
				smooth(local / chord.attack) * (1 - smooth((t - chord.to) / release));
			if (env <= 0) continue;
			const prog = Math.min(1, local / span);
			const b = chord.bright[0] + (chord.bright[1] - chord.bright[0]) * prog;
			const breathe = 0.86 + 0.14 * Math.sin(TAU * lfoFreq * t + lfoPhase);

			let s = 0;
			let roll = 1;
			for (let h = 1; h <= 7; h++) {
				if (f * h > 10500) break;
				s += (roll / h) * Math.sin(TAU * f * h * t + (phases[h - 1] ?? 0));
				roll *= b;
			}
			const sample = s * env * breathe * 0.068;
			out[0][i] = (out[0][i] ?? 0) + sample * gl;
			out[1][i] = (out[1][i] ?? 0) + sample * gr;
		}
	}
}

/** Crystalline bell / FM pluck note. */
function renderPluck(
	out: StereoBuffer,
	at: number,
	note: number,
	gain: number,
	pan: number,
	decayScale = 1,
): void {
	const f = midi(note);
	const start = Math.max(0, Math.floor(at * SCORE_RATE));
	const end = Math.min(
		out[0].length,
		start + Math.floor(2.6 * decayScale * SCORE_RATE),
	);
	const gl = (1 - pan) * 0.72;
	const gr = (1 + pan) * 0.72;

	for (let i = start; i < end; i++) {
		const t = (i - start) / SCORE_RATE;
		const atk = Math.min(1, t / 0.004);
		const fmIndex = 2.4 * Math.exp(-t / (0.14 * decayScale));
		const mod = Math.sin(TAU * f * 2.0 * t);
		const body =
			Math.sin(TAU * f * t + fmIndex * mod) *
			Math.exp(-t / (0.65 * decayScale));
		const shimmer =
			0.25 * Math.sin(TAU * f * 3.01 * t) * Math.exp(-t / (0.28 * decayScale));
		const sample = (body + shimmer) * atk * gain;
		out[0][i] = (out[0][i] ?? 0) + sample * gl;
		out[1][i] = (out[1][i] ?? 0) + sample * gr;
	}
}

/** Deep cinematic sub-bass drop with downward pitch envelope. */
function renderSubDrop(
	out: StereoBuffer,
	at: number,
	startHz: number,
	endHz: number,
	gain: number,
	decay: number,
): void {
	const start = Math.max(0, Math.floor(at * SCORE_RATE));
	const end = Math.min(
		out[0].length,
		start + Math.floor(decay * 3.8 * SCORE_RATE),
	);
	let phase = 0;
	for (let i = start; i < end; i++) {
		const t = (i - start) / SCORE_RATE;
		const freq = endHz + (startHz - endHz) * Math.exp(-t / 0.09);
		phase += (TAU * freq) / SCORE_RATE;
		const env = Math.min(1, t / 0.008) * Math.exp(-t / decay);
		const sample =
			(Math.sin(phase) * 0.85 + Math.sin(phase * 2) * 0.15) * env * gain;
		out[0][i] = (out[0][i] ?? 0) + sample;
		out[1][i] = (out[1][i] ?? 0) + sample;
	}
}

/** Tight electronic kick + sub punch on the 120 BPM pulse. */
function renderPulseAndHats(out: StereoBuffer, rand: () => number): void {
	const startT = sec(BEAT.ignite);
	const stopT = sec(BEAT.finaleIn) - 0.05;

	for (let t = startT; t < stopT; t += STEP / 4) {
		const beatsFromStart = (t - startT) / STEP;
		const frac = beatsFromStart - Math.floor(beatsFromStart);
		const isKick =
			frac < 0.02 ||
			(t >= sec(BEAT.agenticIn) &&
				Math.abs(frac - 0.5) < 0.02 &&
				Math.floor(beatsFromStart) % 4 === 3);
		const isHat = Math.abs(frac - 0.25) < 0.02 || Math.abs(frac - 0.75) < 0.02;

		if (isKick) {
			const kStart = Math.floor(t * SCORE_RATE);
			const kEnd = Math.min(
				out[0].length,
				kStart + Math.floor(0.24 * SCORE_RATE),
			);
			let ph = 0;
			const g = t >= sec(BEAT.omnimodalIn) ? 0.34 : 0.28;
			for (let i = kStart; i < kEnd; i++) {
				const loc = (i - kStart) / SCORE_RATE;
				const freq = 42 + 95 * Math.exp(-loc / 0.022);
				ph += (TAU * freq) / SCORE_RATE;
				const click = Math.exp(-loc / 0.004) * 0.25;
				const body = Math.sin(ph) * Math.exp(-loc / 0.075);
				const x =
					(body + click * (rand() * 2 - 1)) * Math.min(1, loc / 0.002) * g;
				out[0][i] = (out[0][i] ?? 0) + x;
				out[1][i] = (out[1][i] ?? 0) + x;
			}
		} else if (isHat && t >= sec(BEAT.reasoningIn)) {
			const hStart = Math.floor(t * SCORE_RATE);
			const hEnd = Math.min(
				out[0].length,
				hStart + Math.floor(0.055 * SCORE_RATE),
			);
			const pan = frac < 0.5 ? -0.25 : 0.25;
			let prev = 0;
			for (let i = hStart; i < hEnd; i++) {
				const loc = (i - hStart) / SCORE_RATE;
				const n = rand() * 2 - 1;
				const hp = n - prev;
				prev = n * 0.78;
				const x = hp * Math.exp(-loc / 0.016) * 0.055;
				out[0][i] = (out[0][i] ?? 0) + x * (1 - pan);
				out[1][i] = (out[1][i] ?? 0) + x * (1 + pan);
			}
		}
	}
}

/** 16th-note crystalline arpeggio through Acts I–IV. */
function renderArpeggio(out: StereoBuffer): void {
	const pattern = [0, 2, 1, 4, 2, 3, 5, 2];
	const fromT = sec(BEAT.ignite) + STEP * 0.5;
	const toT = sec(BEAT.finaleIn) - 0.05;
	let step = 0;

	for (let t = fromT; t < toT; step++) {
		const chord = chordAt(t);
		const pool = chord.notes.filter((n) => n >= 53).map((n) => n + 12);
		if (pool.length > 0) {
			const note =
				pool[(pattern[step % pattern.length] ?? 0) % pool.length] ?? 72;
			const energy = 0.065 + 0.055 * smooth((t - fromT) / (toT - fromT));
			const pan = ((step % 4) - 1.5) * 0.35;
			renderPluck(out, t, note, energy, pan, 0.55);
		}
		t += t < sec(BEAT.reasoningIn) ? STEP / 2 : STEP / 4;
	}
}

/** Sweeping filtered noise riser leading cleanly into a major drop. */
function renderRiser(
	out: StereoBuffer,
	fromSec: number,
	toSec: number,
	gain: number,
	rand: () => number,
): void {
	const start = Math.max(0, Math.floor(fromSec * SCORE_RATE));
	const end = Math.min(out[0].length, Math.floor(toSec * SCORE_RATE));
	const len = Math.max(1, end - start);
	let lpL = 0;
	let lpR = 0;
	let ph = 0;

	for (let i = start; i < end; i++) {
		const u = (i - start) / len;
		const cutoff = 0.01 + 0.36 * u * u;
		lpL += cutoff * (rand() * 2 - 1 - lpL);
		lpR += cutoff * (rand() * 2 - 1 - lpR);
		const sweepFreq = 180 + 1300 * u * u * u;
		ph += (TAU * sweepFreq) / SCORE_RATE;
		const env = u * u * (1 - smooth((u - 0.94) / 0.06)) * gain;
		const tone = Math.sin(ph) * 0.25;
		out[0][i] = (out[0][i] ?? 0) + (lpL + tone) * env;
		out[1][i] = (out[1][i] ?? 0) + (lpR + tone) * env;
	}
}

/** Crystalline metallic shatter burst synced to the Act IV Voronoi fracture! */
function renderShatterImpact(
	out: StereoBuffer,
	atSec: number,
	rand: () => number,
): void {
	renderSubDrop(out, atSec, 140, 32, 0.55, 0.9);
	const start = Math.floor(atSec * SCORE_RATE);
	const end = Math.min(out[0].length, start + Math.floor(1.4 * SCORE_RATE));
	const partials = [1180, 1790, 2410, 3190, 4280, 5610, 6890, 8120];
	const pans = partials.map(
		(_, idx) => (idx % 2 === 0 ? -1 : 1) * (0.2 + idx * 0.09),
	);

	for (let p = 0; p < partials.length; p++) {
		const freq = partials[p] ?? 2000;
		const pan = pans[p] ?? 0;
		const delaySamples = Math.floor(rand() * 0.035 * SCORE_RATE);
		const decay = 0.16 + rand() * 0.35;
		for (let i = start + delaySamples; i < end; i++) {
			const t = (i - start - delaySamples) / SCORE_RATE;
			const env = Math.min(1, t / 0.002) * Math.exp(-t / decay);
			const s = Math.sin(TAU * freq * t) * env * 0.085;
			out[0][i] = (out[0][i] ?? 0) + s * (1 - pan);
			out[1][i] = (out[1][i] ?? 0) + s * (1 + pan);
		}
	}
	// Crisp glass crackle transient.
	for (
		let i = start;
		i < Math.min(out[0].length, start + Math.floor(0.28 * SCORE_RATE));
		i++
	) {
		const t = (i - start) / SCORE_RATE;
		const burst = (rand() * 2 - 1) * Math.exp(-t / 0.045) * 0.24;
		out[0][i] = (out[0][i] ?? 0) + burst;
		out[1][i] = (out[1][i] ?? 0) + burst * 0.92;
	}
}

/** Chord accent stab at key visual beats. */
function renderStab(out: StereoBuffer, atSec: number, gain: number): void {
	const chord = chordAt(atSec + 0.02);
	chord.notes
		.filter((n) => n >= 55)
		.forEach((n, i) => {
			renderPluck(out, atSec, n + 12, gain, ((i % 3) - 1) * 0.42, 1.15);
		});
}

/** Stereo plate reverb (8 damped combs + 4 all-pass filters per channel). */
function applyReverb(dry: StereoBuffer, mix: number): StereoBuffer {
	const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116];
	const passes = [556, 441, 341, 225];
	const len = dry[0].length;
	const wet: StereoBuffer = [new Float32Array(len), new Float32Array(len)];

	for (let ch = 0; ch < 2; ch++) {
		const input = dry[ch] as Float32Array;
		const output = wet[ch] as Float32Array;
		const spread = ch * 29;
		for (const size of combs) {
			const buf = new Float32Array(
				Math.round(((size + spread) * SCORE_RATE) / 44100),
			);
			let idx = 0;
			let store = 0;
			for (let i = 0; i < len; i++) {
				const y = buf[idx] ?? 0;
				store = y * 0.72 + store * 0.28;
				buf[idx] = (input[i] ?? 0) * 0.016 + store * 0.87;
				idx = (idx + 1) % buf.length;
				output[i] = (output[i] ?? 0) + y;
			}
		}
		for (const size of passes) {
			const buf = new Float32Array(
				Math.round(((size + spread) * SCORE_RATE) / 44100),
			);
			let idx = 0;
			for (let i = 0; i < len; i++) {
				const delayed = buf[idx] ?? 0;
				const x = output[i] ?? 0;
				buf[idx] = x + delayed * 0.5;
				idx = (idx + 1) % buf.length;
				output[i] = delayed - x;
			}
		}
	}
	for (let ch = 0; ch < 2; ch++) {
		const d = dry[ch] as Float32Array;
		const w = wet[ch] as Float32Array;
		for (let i = 0; i < len; i++) {
			w[i] = (d[i] ?? 0) * (1 - mix) + (w[i] ?? 0) * mix;
		}
	}
	return wet;
}

/** Soft limiter + loudness normalization targeting ~-14 LUFS with headroom. */
function masterAudio(buf: StereoBuffer): StereoBuffer {
	const len = buf[0].length;
	const fadeOutStart = sec(BEAT.fadeOut) - 0.1;

	// Edge fades + gentle tanh glue saturation.
	for (let ch = 0; ch < 2; ch++) {
		const c = buf[ch] as Float32Array;
		for (let i = 0; i < len; i++) {
			const t = i / SCORE_RATE;
			const fadeIn = smooth(t / 0.18);
			const fadeOut = 1 - smooth((t - fadeOutStart) / (END - fadeOutStart));
			c[i] = Math.tanh((c[i] ?? 0) * 1.15) * fadeIn * fadeOut;
		}
	}

	// Measure integrated RMS power and normalize to ~-14.2 dBFS RMS (~-14 LUFS)
	// while keeping true peaks safely below -0.8 dBFS (no clipping).
	let sumSq = 0;
	for (let i = 0; i < len; i++) {
		const l = buf[0][i] ?? 0;
		const r = buf[1][i] ?? 0;
		sumSq += 0.5 * (l * l + r * r);
	}
	const rms = Math.sqrt(sumSq / Math.max(1, len));
	const targetRms = 10 ** (-14.8 / 20);
	const gain = rms > 1e-6 ? Math.min(3.5, targetRms / rms) : 1;

	for (let ch = 0; ch < 2; ch++) {
		const c = buf[ch] as Float32Array;
		for (let i = 0; i < len; i++) {
			const v = (c[i] ?? 0) * gain;
			// Soft ceiling limiter at 0.91 (-0.8 dBFS) to guarantee zero clipping.
			c[i] =
				Math.abs(v) > 0.78
					? Math.sign(v) *
						(0.78 + 0.13 * Math.tanh((Math.abs(v) - 0.78) / 0.18))
					: v;
		}
	}
	return buf;
}

/** Synthesize the complete 20.0-second stereo soundtrack. */
export function synthesizeScore(): StereoBuffer {
	const len = Math.ceil(END * SCORE_RATE);
	const mix: StereoBuffer = [new Float32Array(len), new Float32Array(len)];
	const rand = mulberry32(4604);

	for (const chord of CHORDS) {
		for (const note of chord.notes) {
			renderPadNote(mix, chord, note, rand);
		}
	}

	// Opening digital spark ticks building anticipation into Bar 1 ignition.
	renderPluck(mix, 0.25, 72, 0.11, -0.35, 0.9);
	renderPluck(mix, 0.75, 79, 0.12, 0.35, 0.9);
	renderPluck(mix, 1.25, 84, 0.13, -0.2, 0.8);
	renderRiser(mix, 0.4, sec(BEAT.ignite), 0.18, rand);

	// Rhythmic backbone & 16th-note crystalline arpeggios.
	renderPulseAndHats(mix, rand);
	renderArpeggio(mix);

	// Major synchronized visual hit accents:
	// Act I Ignition (Bar 1 = 2.0s)
	renderSubDrop(mix, sec(BEAT.ignite), 120, 34, 0.5, 1.3);
	renderStab(mix, sec(BEAT.ignite), 0.16);

	// Act II Neural Lattice Cut & Lock (4.0s & 6.0s)
	renderSubDrop(mix, sec(BEAT.reasoningIn), 100, 38, 0.36, 0.9);
	renderStab(mix, sec(BEAT.reasoningIn), 0.12);
	renderRiser(
		mix,
		sec(BEAT.latticeLock) - 0.8,
		sec(BEAT.latticeLock),
		0.11,
		rand,
	);
	renderSubDrop(mix, sec(BEAT.latticeLock), 115, 36, 0.42, 1.0);
	renderStab(mix, sec(BEAT.latticeLock), 0.15);

	// Act III Agentic Code & Build Verified (8.0s & 10.0s)
	renderSubDrop(mix, sec(BEAT.agenticIn), 96, 40, 0.34, 0.85);
	renderStab(mix, sec(BEAT.agenticIn), 0.11);
	// Rapid subtle keystroke plicks while code streams in (8.3s .. 9.8s).
	for (let k = 0; k < 12; k++) {
		renderPluck(
			mix,
			sec(BEAT.agenticIn) + 0.3 + k * 0.115,
			84 + (k % 3) * 2,
			0.038,
			(k % 2 === 0 ? -1 : 1) * 0.3,
			0.22,
		);
	}
	renderSubDrop(mix, sec(BEAT.buildPass), 110, 42, 0.4, 0.9);
	renderPluck(mix, sec(BEAT.buildPass), 79, 0.16, -0.3, 1.2);
	renderPluck(mix, sec(BEAT.buildPass) + 0.05, 84, 0.17, 0.3, 1.4);

	// Act IV Omni-Modal Cut & Voronoi Shatter (12.0s & 13.0s)
	renderSubDrop(mix, sec(BEAT.omnimodalIn), 100, 36, 0.38, 0.8);
	renderRiser(mix, sec(BEAT.omnimodalIn) + 0.15, sec(BEAT.shatter), 0.16, rand);
	renderShatterImpact(mix, sec(BEAT.shatter), rand);
	renderStab(mix, sec(BEAT.shatterOrbit), 0.13);

	// Act V Finale Swarm Gathering & Hero Star Lock (16.0s → 17.0s → 18.5s)
	renderRiser(mix, sec(BEAT.finaleIn), sec(BEAT.starLock), 0.18, rand);
	renderSubDrop(mix, sec(BEAT.starLock), 130, 32, 0.56, 2.2);
	renderStab(mix, sec(BEAT.starLock), 0.19);
	renderPluck(mix, sec(BEAT.starLock) + 0.15, 84, 0.12, -0.35, 1.6);
	renderPluck(mix, sec(BEAT.starLock) + 0.3, 86, 0.11, 0.35, 1.6);
	// Specular glint chime on the star.
	renderPluck(mix, sec(BEAT.starGlint), 91, 0.09, -0.4, 1.3);
	renderPluck(mix, sec(BEAT.starGlint) + 0.12, 96, 0.09, 0.4, 1.5);

	const reverberated = applyReverb(mix, 0.34);
	return masterAudio(reverberated);
}

/**
 * Computes a deterministic per-frame musical energy envelope (0..1) synchronized
 * to the exact beat structure of `score.ts` for driving shaders, lights, and waveforms.
 */
export function computeMusicalEnergy(frame: number): number {
	const beatPos = (frame % BEAT_FRAMES) / BEAT_FRAMES;
	const activePulse =
		frame >= BEAT.ignite && frame < BEAT.finaleIn
			? Math.exp(-beatPos * 5.2) * 0.55
			: 0;
	const hits = [
		BEAT.ignite,
		BEAT.reasoningIn,
		BEAT.latticeLock,
		BEAT.agenticIn,
		BEAT.buildPass,
		BEAT.omnimodalIn,
		BEAT.shatter,
		BEAT.starLock,
	];
	let accent = 0;
	for (const h of hits) {
		const dt = frame - h;
		if (dt >= 0 && dt < 28) {
			accent = Math.max(accent, Math.exp(-dt / 8));
		}
	}
	return clamp01(0.18 + activePulse + accent * 0.72);
}
