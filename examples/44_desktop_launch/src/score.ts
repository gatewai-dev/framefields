/**
 * The score, written here rather than generated, and the film's only sound:
 * a night drone that swells into the wake, a pad and an arpeggio over a soft
 * pulse while the field plays, a climb through the flight and a held chord
 * under the name. Its turns and accents are the film's own beats (the wake,
 * the four flips, the mark, the glint). Deterministic (seeded), stereo,
 * 48 kHz.
 */
import { BEAT, BEAT_FRAMES, DURATION, FPS } from "./theme.js";

export const SCORE_RATE = 48000;
const TAU = Math.PI * 2;
const sec = (frame: number) => frame / FPS;
const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);

type Stereo = [Float32Array, Float32Array];

/** mulberry32. */
function random(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const smooth = (x: number) => {
	const t = Math.min(1, Math.max(0, x));
	return t * t * (3 - 2 * t);
};

const WAKE = sec(BEAT.wake);
const FLIGHT = sec(BEAT.through);
const MARK = sec(BEAT.mark);
const END = sec(DURATION);

interface Chord {
	from: number;
	to: number;
	attack: number;
	notes: number[];
	/** How open the pad's filter is, start and end of the chord (0..1). */
	bright: [number, number];
	gain: number;
}

const BAR = sec(BEAT_FRAMES * 4);
const STEP = sec(BEAT_FRAMES);

/** A night fifth, then D add9, B minor 11, G major 9, A sus4 to A, home to D. */
const CHORDS: Chord[] = [
	{
		from: 0,
		to: WAKE,
		attack: WAKE * 0.95,
		notes: [38, 45, 50],
		bright: [0.1, 0.34],
		gain: 0.6,
	},
	{
		from: WAKE,
		to: WAKE + BAR + 0.1,
		attack: 0.06,
		notes: [38, 45, 50, 57, 62, 64, 66],
		bright: [0.5, 0.44],
		gain: 1.3,
	},
	{
		from: WAKE + BAR,
		to: WAKE + 2 * BAR + 0.1,
		attack: 0.5,
		notes: [35, 47, 54, 57, 62, 64, 69],
		bright: [0.46, 0.52],
		gain: 1.35,
	},
	{
		from: WAKE + 2 * BAR,
		to: FLIGHT + 0.1,
		attack: 0.5,
		notes: [31, 43, 50, 59, 62, 66, 69],
		bright: [0.5, 0.6],
		gain: 1.4,
	},
	{
		from: FLIGHT,
		to: (FLIGHT + MARK) / 2 + 0.1,
		attack: 0.3,
		notes: [33, 45, 52, 57, 62, 64, 69, 76],
		bright: [0.58, 0.74],
		gain: 1.25,
	},
	{
		from: (FLIGHT + MARK) / 2,
		to: MARK,
		attack: 0.4,
		notes: [33, 45, 52, 57, 61, 64, 69, 76],
		bright: [0.72, 0.9],
		gain: 1.3,
	},
	{
		from: MARK,
		to: END - 0.3,
		attack: 0.05,
		notes: [26, 38, 45, 50, 54, 57, 62, 66, 69],
		bright: [0.66, 0.2],
		gain: 1,
	},
];
const RELEASE = 0.9;

/** One pad note: three detuned voices of a few harmonics, opened by `bright`. */
function pad(
	out: Stereo,
	chord: Chord,
	note: number,
	rand: () => number,
): void {
	const f0 = midi(note);
	const start = Math.max(0, Math.floor(chord.from * SCORE_RATE));
	const end = Math.min(
		out[0].length,
		Math.floor((chord.to + RELEASE) * SCORE_RATE),
	);
	// Low notes carry the weight, high ones the air.
	const weight = (note < 40 ? 0.9 : note < 52 ? 0.6 : 0.34) * chord.gain;
	for (let v = 0; v < 3; v++) {
		const f = f0 * 2 ** (((v - 1) * 5 + (rand() - 0.5) * 3) / 1200);
		const pan = note < 46 ? 0 : (v - 1) * 0.55 + (rand() - 0.5) * 0.3;
		const phases = Array.from({ length: 6 }, () => rand() * TAU);
		const drift = 0.07 + rand() * 0.08;
		const driftPhase = rand() * TAU;
		const gl = weight * Math.SQRT1_2 * (1 - pan * 0.7);
		const gr = weight * Math.SQRT1_2 * (1 + pan * 0.7);
		for (let i = start; i < end; i++) {
			const t = i / SCORE_RATE;
			const local = t - chord.from;
			const level =
				smooth(local / chord.attack) * (1 - smooth((t - chord.to) / RELEASE));
			if (level <= 0) continue;
			const b =
				chord.bright[0] +
				(chord.bright[1] - chord.bright[0]) *
					Math.min(1, local / (chord.to - chord.from));
			const breathe = 0.82 + 0.18 * Math.sin(TAU * drift * t + driftPhase);
			let s = 0;
			let rolloff = 1;
			for (let h = 1; h <= 6; h++) {
				if (f * h > 9000) break;
				s +=
					(rolloff / h) * Math.sin(TAU * f * h * t + (phases[h - 1] as number));
				rolloff *= b;
			}
			const x = s * level * breathe * 0.055;
			out[0][i] = (out[0][i] as number) + x * gl;
			out[1][i] = (out[1][i] as number) + x * gr;
		}
	}
}

/** A felt-piano note: a few partials, each dying at its own pace. */
function pluck(
	out: Stereo,
	at: number,
	note: number,
	gain: number,
	pan: number,
): void {
	const f = midi(note);
	const partials: Array<[number, number, number]> = [
		[1, 1, 1.5],
		[2, 0.32, 0.8],
		[3, 0.1, 0.45],
		[4.1, 0.04, 0.25],
	];
	const start = Math.floor(at * SCORE_RATE);
	const end = Math.min(out[0].length, start + Math.floor(5 * SCORE_RATE));
	for (let i = Math.max(0, start); i < end; i++) {
		const t = (i - start) / SCORE_RATE;
		const attack = Math.min(1, t / 0.006);
		let s = 0;
		for (const [ratio, amp, decay] of partials)
			s += amp * Math.exp(-t / decay) * Math.sin(TAU * f * ratio * t);
		const x = s * attack * gain;
		out[0][i] = (out[0][i] as number) + x * (1 - pan) * 0.7;
		out[1][i] = (out[1][i] as number) + x * (1 + pan) * 0.7;
	}
}

/** A low sine that lands and rings down: the weight under a turn. */
function sub(
	out: Stereo,
	at: number,
	note: number,
	gain: number,
	decay: number,
): void {
	const f = midi(note);
	const start = Math.floor(at * SCORE_RATE);
	const end = Math.min(
		out[0].length,
		start + Math.floor(decay * 4 * SCORE_RATE),
	);
	for (let i = start; i < end; i++) {
		const t = (i - start) / SCORE_RATE;
		const x =
			Math.sin(TAU * f * t) *
			Math.min(1, t / 0.04) *
			Math.exp(-t / decay) *
			gain;
		out[0][i] = (out[0][i] as number) + x;
		out[1][i] = (out[1][i] as number) + x;
	}
}

/** Night air: low filtered noise that thins out once the field is awake. */
function air(out: Stereo, rand: () => number): void {
	let l = 0;
	let r = 0;
	for (let i = 0; i < out[0].length; i++) {
		const t = i / SCORE_RATE;
		l += 0.035 * (rand() * 2 - 1 - l);
		r += 0.035 * (rand() * 2 - 1 - r);
		const level =
			0.05 *
			smooth(t / 3) *
			(1 - 0.6 * smooth((t - WAKE) / 4)) *
			(1 - smooth((t - MARK) / 4));
		out[0][i] = (out[0][i] as number) + l * level;
		out[1][i] = (out[1][i] as number) + r * level;
	}
}

/** The soft pulse under the field: a low thump on each beat, on the half beat too in the flight. */
function pulse(out: Stereo): void {
	for (let t = WAKE + STEP; t < MARK - 0.05; t += STEP / 2) {
		const onBeat =
			Math.abs((t - WAKE) / STEP - Math.round((t - WAKE) / STEP)) < 0.01;
		if (!onBeat && t < FLIGHT) continue;
		const gain = (onBeat ? 0.2 : 0.11) * (t < FLIGHT ? 1 : 1.15);
		const start = Math.floor(t * SCORE_RATE);
		const end = Math.min(out[0].length, start + Math.floor(0.22 * SCORE_RATE));
		let phase = 0;
		for (let i = start; i < end; i++) {
			const local = (i - start) / SCORE_RATE;
			// A sine falling from 95 to 46 Hz: felt more than heard.
			phase += (TAU * (46 + 49 * Math.exp(-local / 0.025))) / SCORE_RATE;
			const x =
				Math.sin(phase) *
				Math.min(1, local / 0.003) *
				Math.exp(-local / 0.07) *
				gain;
			out[0][i] = (out[0][i] as number) + x;
			out[1][i] = (out[1][i] as number) + x;
		}
	}
}

/** The chord sounding at `t`. */
const chordAt = (t: number) =>
	[...CHORDS].reverse().find((c) => t >= c.from) as Chord;

/** The arpeggio: eighths from first light, sixteenths through the flight, growing all the way. */
function arpeggio(out: Stereo): void {
	const pattern = [0, 2, 1, 3, 2, 4, 3, 1];
	let step = 0;
	for (let t = WAKE + STEP / 2; t < MARK - 0.05; step++) {
		const tones = chordAt(t)
			.notes.filter((n) => n >= 57)
			.map((n) => n + 12);
		const note = tones[
			(pattern[step % pattern.length] as number) % tones.length
		] as number;
		const grow = smooth((t - WAKE) / (MARK - WAKE));
		pluck(out, t, note, 0.05 + 0.08 * grow, step % 2 === 0 ? -0.5 : 0.5);
		t += t < FLIGHT ? STEP / 2 : STEP / 4;
	}
}

/** The chord's top notes struck together: an accent where the picture has one. */
function stab(out: Stereo, at: number, gain: number): void {
	chordAt(at + 0.01)
		.notes.filter((n) => n >= 57)
		.forEach((n, i) => {
			pluck(out, at, n + 12, gain, (i % 3) * 0.4 - 0.4);
		});
}

/** A small plate: eight damped combs and four all-passes a side. */
function reverb(dry: Stereo, mix: number): Stereo {
	const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116];
	const passes = [556, 441, 341, 225];
	const wet: Stereo = [
		new Float32Array(dry[0].length),
		new Float32Array(dry[0].length),
	];
	for (let ch = 0; ch < 2; ch++) {
		const input = dry[ch] as Float32Array;
		const output = wet[ch] as Float32Array;
		const spread = ch * 23;
		for (const size of combs) {
			const buffer = new Float32Array(
				Math.round(((size + spread) * SCORE_RATE) / 44100),
			);
			let at = 0;
			let store = 0;
			for (let i = 0; i < input.length; i++) {
				const y = buffer[at] as number;
				store = y * 0.72 + store * 0.28;
				buffer[at] = (input[i] as number) * 0.015 + store * 0.88;
				at = (at + 1) % buffer.length;
				output[i] = (output[i] as number) + y;
			}
		}
		for (const size of passes) {
			const buffer = new Float32Array(
				Math.round(((size + spread) * SCORE_RATE) / 44100),
			);
			let at = 0;
			for (let i = 0; i < output.length; i++) {
				const delayed = buffer[at] as number;
				const x = output[i] as number;
				buffer[at] = x + delayed * 0.5;
				at = (at + 1) % buffer.length;
				output[i] = delayed - x;
			}
		}
	}
	for (let ch = 0; ch < 2; ch++) {
		const d = dry[ch] as Float32Array;
		const w = wet[ch] as Float32Array;
		for (let i = 0; i < d.length; i++)
			w[i] = (d[i] as number) * (1 - mix) + (w[i] as number) * mix;
	}
	return wet;
}

/** The whole score, as long as the film. */
export function synthesizeScore(): Stereo {
	const length = Math.ceil(END * SCORE_RATE);
	const mix: Stereo = [new Float32Array(length), new Float32Array(length)];
	const rand = random(44);
	for (const chord of CHORDS)
		for (const note of chord.notes) pad(mix, chord, note, rand);
	air(mix, rand);
	// Night: two notes far apart, then one note repeated, closing in on the wake.
	pluck(mix, WAKE * 0.16, 69, 0.12, -0.3);
	pluck(mix, WAKE * 0.42, 74, 0.12, 0.3);
	const lead = sec(BEAT.work);
	for (let t = lead; t < WAKE - 0.05; t += STEP / 2) {
		const near = (t - lead) / (WAKE - lead);
		pluck(mix, t, 62, 0.04 + 0.1 * near * near, near - 0.5);
	}
	pulse(mix);
	arpeggio(mix);
	// The picture's accents: the wake, the four flips, the mark, the glint.
	stab(mix, WAKE, 0.16);
	sub(mix, WAKE, 26, 0.34, 1.6);
	for (let n = 0; n < 4; n++)
		stab(mix, sec(BEAT.flips + n * BEAT_FRAMES), 0.09);
	sub(mix, FLIGHT, 33, 0.18, 1.2);
	stab(mix, MARK, 0.17);
	sub(mix, MARK, 26, 0.3, 2.4);
	pluck(mix, sec(BEAT.name), 74, 0.14, -0.2);
	pluck(mix, sec(BEAT.glint), 86, 0.07, -0.4);
	pluck(mix, sec(BEAT.glint) + STEP / 2, 90, 0.07, 0.4);
	pluck(mix, sec(BEAT.glint) + 3 * BAR, 81, 0.07, 0);

	const out = reverb(mix, 0.36);
	// Out to silence at the very end, then level the peak.
	let peak = 0;
	const fade = sec(DURATION - BEAT.out) + 0.4;
	for (let ch = 0; ch < 2; ch++) {
		const c = out[ch] as Float32Array;
		for (let i = 0; i < c.length; i++) {
			const t = i / SCORE_RATE;
			c[i] =
				(c[i] as number) *
				smooth(t / 0.6) *
				(1 - smooth((t - (END - fade)) / (fade - 0.2)));
			peak = Math.max(peak, Math.abs(c[i] as number));
		}
	}
	const k = 0.86 / (peak || 1);
	for (let ch = 0; ch < 2; ch++) {
		const c = out[ch] as Float32Array;
		for (let i = 0; i < c.length; i++) c[i] = (c[i] as number) * k;
	}
	return out;
}
