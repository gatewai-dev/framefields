/**
 * The music bed, synthesized here rather than generated: a slow pad over four
 * chords in D, a low drone and sparse bell tones through a small reverb.
 * Deterministic (one seeded generator), stereo, 48 kHz.
 */

const RATE = 48000;
const TAU = Math.PI * 2;

/** Seconds each chord is held; neighbours crossfade over `BLEND`. */
const HOLD = 14;
const BLEND = 6;

const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** Dsus2, Bm11, Gmaj9, Asus4: open voicings that never resolve hard. */
const CHORDS = [
	[38, 45, 52, 57, 62, 64],
	[35, 47, 54, 57, 62, 66],
	[31, 43, 50, 57, 59, 66],
	[33, 45, 52, 57, 62, 64],
].map((chord) => chord.map(midi));

/** D major pentatonic, two octaves, for the bells. */
const BELLS = [74, 76, 78, 81, 83, 86, 88, 90].map(midi);

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

/** How loud chord `index` is at `t`: up over `BLEND`, held, down over `BLEND`. */
function chordLevel(index: number, t: number): number {
	const cycle = HOLD * CHORDS.length;
	const local = (((t - index * HOLD) % cycle) + cycle) % cycle;
	if (local < BLEND) return smooth(local / BLEND);
	if (local < HOLD) return 1;
	if (local < HOLD + BLEND) return 1 - smooth((local - HOLD) / BLEND);
	return 0;
}

/** One pad voice: three detuned sines and a soft octave, breathing slowly. */
function pad(
	out: [Float32Array, Float32Array],
	frequency: number,
	chord: number,
	voice: number,
	rand: () => number,
): void {
	const detune = [-0.0035, 0, 0.004];
	const phases = detune.map(() => rand() * TAU);
	const breath = 0.05 + rand() * 0.06;
	const breathPhase = rand() * TAU;
	const pan = 0.5 + (rand() - 0.5) * 0.7;
	// Lower notes carry the pad; upper ones are quieter.
	const gain = 0.05 / (1 + voice * 0.45);
	for (let i = 0; i < out[0].length; i++) {
		const t = i / RATE;
		const level = chordLevel(chord, t);
		if (level === 0) continue;
		let sample = 0;
		for (let d = 0; d < detune.length; d++) {
			const angle = TAU * frequency * (1 + (detune[d] ?? 0)) * t;
			sample += Math.sin(angle + (phases[d] ?? 0));
			sample += 0.18 * Math.sin(2 * angle + (phases[d] ?? 0));
		}
		const swell = 0.7 + 0.3 * Math.sin(TAU * breath * t + breathPhase);
		const value = sample * gain * level * swell;
		(out[0][i] as number) += value * (1 - pan);
		(out[1][i] as number) += value * pan;
	}
}

/** A bell: a sine and an inharmonic partial, decaying over a few seconds. */
function bell(
	out: [Float32Array, Float32Array],
	at: number,
	frequency: number,
	pan: number,
	gain: number,
): void {
	const start = Math.round(at * RATE);
	const length = Math.min(out[0].length - start, RATE * 6);
	for (let i = 0; i < length; i++) {
		const t = i / RATE;
		const envelope = Math.min(1, t / 0.008) * Math.exp(-t * 1.1);
		const value =
			gain *
			envelope *
			(Math.sin(TAU * frequency * t) +
				0.35 * Math.exp(-t * 2.5) * Math.sin(TAU * frequency * 2.76 * t));
		(out[0][start + i] as number) += value * (1 - pan);
		(out[1][start + i] as number) += value * pan;
	}
}

/** Four feedback combs and two allpasses per channel, mixed back under the dry signal. */
function reverb(channel: Float32Array, offset: number): Float32Array {
	const wet = new Float32Array(channel.length);
	for (const [delay, feedback] of [
		[1557, 0.86],
		[1617, 0.85],
		[1491, 0.87],
		[1422, 0.84],
	] as const) {
		const size = (delay + offset) * 3;
		const line = new Float32Array(size);
		let low = 0;
		for (let i = 0; i < channel.length; i++) {
			const at = i % size;
			const echoed = line[at] ?? 0;
			// A one-pole low-pass in the loop keeps the tail dark.
			low = echoed * 0.6 + low * 0.4;
			line[at] = (channel[i] ?? 0) + low * feedback;
			(wet[i] as number) += echoed * 0.25;
		}
	}
	for (const delay of [225 + offset, 556 + offset]) {
		const line = new Float32Array(delay);
		for (let i = 0; i < wet.length; i++) {
			const at = i % delay;
			const delayed = line[at] ?? 0;
			const input = (wet[i] ?? 0) + delayed * 0.5;
			line[at] = input;
			wet[i] = delayed - input * 0.5;
		}
	}
	return wet;
}

/**
 * `seconds` of the bed as interleaved stereo float samples. Bells start after
 * `bellsFrom` and stop before `bellsTo`, where the film looks at the vacuum.
 */
export function synthesizeBed(
	seconds: number,
	bells: { from: number; to: number },
): Float32Array {
	const length = Math.round(seconds * RATE);
	const dry: [Float32Array, Float32Array] = [
		new Float32Array(length),
		new Float32Array(length),
	];
	const rand = random(1974);
	CHORDS.forEach((chord, index) => {
		chord.forEach((frequency, voice) => {
			pad(dry, frequency, index, voice, rand);
		});
	});
	// The drone: D1 and D2, barely moving.
	for (let i = 0; i < length; i++) {
		const t = i / RATE;
		const value =
			0.05 * Math.sin(TAU * midi(26) * t) +
			0.03 * Math.sin(TAU * midi(38) * t + Math.sin(TAU * 0.03 * t));
		(dry[0][i] as number) += value;
		(dry[1][i] as number) += value;
	}
	for (let at = bells.from; at < bells.to; at += 1.4 + rand() * 3.2) {
		const note = BELLS[Math.floor(rand() * BELLS.length)] ?? 440;
		bell(dry, at, note, 0.2 + rand() * 0.6, 0.02 + rand() * 0.02);
	}
	const wet = [reverb(dry[0], 0), reverb(dry[1], 23)] as const;
	const out = new Float32Array(length * 2);
	for (let i = 0; i < length; i++) {
		const t = i / RATE;
		const fade = smooth(t / 4) * smooth((seconds - t) / 5);
		out[i * 2] = ((dry[0][i] ?? 0) * 0.6 + (wet[0][i] ?? 0) * 0.7) * fade;
		out[i * 2 + 1] = ((dry[1][i] ?? 0) * 0.6 + (wet[1][i] ?? 0) * 0.7) * fade;
	}
	return out;
}

export const BED_RATE = RATE;
