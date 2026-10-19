/**
 * pnpm score → assets/stems/{drums,bass,music}.wav (transition effects are Freesound files, see SFX)
 *
 * A small deterministic synthesizer renders music.ts's arrangement (120 BPM, A minor) into four
 * stems. The film mixes them with framefields' audio nodes (compressor, EQ sweep, delay, reverb,
 * panning, fades), so the processing is part of the render rather than baked in here.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
	beatToFrame,
	CLAPS,
	HATS,
	KICKS,
	PROGRESSION,
	SAMPLE_RATE,
	SECONDS_PER_BEAT,
	sectionAt,
} from "./music.js";
import { ASSETS } from "./paths.js";
import { FPS } from "./theme.js";
import { TOTAL_BARS, TOTAL_FRAMES } from "./timeline.js";

const SR = SAMPLE_RATE;
const LENGTH = Math.ceil((TOTAL_FRAMES / FPS + 2) * SR);
const TAU = Math.PI * 2;

type Stereo = [Float32Array, Float32Array];
const stem = (): Stereo => [new Float32Array(LENGTH), new Float32Array(LENGTH)];

// Deterministic noise.
let seed = 0x2f6b1d;
const noise = () => {
	seed ^= seed << 13;
	seed ^= seed >>> 17;
	seed ^= seed << 5;
	return ((seed >>> 0) / 4294967296) * 2 - 1;
};

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const beatSec = (beat: number, step = 0) => beatToFrame(beat, step) / FPS;

function add(
	out: Stereo,
	at: number,
	mono: Float32Array,
	gain = 1,
	pan = 0,
): void {
	const i0 = Math.round(at * SR);
	const l = gain * Math.cos(((pan + 1) * Math.PI) / 4);
	const r = gain * Math.sin(((pan + 1) * Math.PI) / 4);
	for (let i = 0; i < mono.length; i++) {
		const j = i0 + i;
		if (j < 0 || j >= LENGTH) continue;
		out[0][j] += mono[i] * l;
		out[1][j] += mono[i] * r;
	}
}

// ── Voices ──────────────────────────────────────────────────────────────────

function kickVoice(): Float32Array {
	const n = Math.round(0.45 * SR);
	const out = new Float32Array(n);
	let phase = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		const f = 46 + 110 * Math.exp(-t * 32);
		phase += (TAU * f) / SR;
		const body = Math.sin(phase) * Math.exp(-t * 7);
		const click = noise() * Math.exp(-t * 400) * 0.35;
		out[i] = Math.tanh((body + click) * 1.6) * 0.95;
	}
	return out;
}

function clapVoice(): Float32Array {
	const n = Math.round(0.3 * SR);
	const out = new Float32Array(n);
	let bp1 = 0;
	let bp2 = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		// Three quick bursts then a tail, band-passed around 1.5 kHz.
		const bursts = [0, 0.011, 0.022].reduce(
			(s, o) => s + (t >= o ? Math.exp(-(t - o) * 180) : 0),
			0,
		);
		const env = bursts * 0.6 + Math.exp(-t * 18) * 0.5;
		const x = noise() * env;
		const f = 2 * Math.sin((Math.PI * 1500) / SR);
		bp1 += f * (x - bp1 - 0.5 * bp2);
		bp2 += f * bp1;
		out[i] = bp1 * 1.4;
	}
	return out;
}

function hatVoice(open: boolean): Float32Array {
	const n = Math.round((open ? 0.22 : 0.05) * SR);
	const out = new Float32Array(n);
	let prev = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		const x = noise();
		const hp = x - prev;
		prev = x;
		out[i] = hp * Math.exp(-t * (open ? 14 : 90)) * 0.35;
	}
	return out;
}

function bassNote(hz: number, dur: number): Float32Array {
	const n = Math.round(dur * SR);
	const out = new Float32Array(n);
	let ph = 0;
	let lp = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		ph = (ph + hz / SR) % 1;
		const saw = ph * 2 - 1;
		const sub = Math.sin(TAU * ph);
		const cutoff = 180 + 900 * Math.exp(-t * 9);
		const a = 1 - Math.exp((-TAU * cutoff) / SR);
		lp += a * (saw - lp);
		const env = Math.min(1, t * 400) * Math.min(1, (dur - t) * 60);
		out[i] = (lp * 0.55 + sub * 0.6) * env;
	}
	return out;
}

function pluck(hz: number, dur: number, bright: number): Float32Array {
	const n = Math.round(dur * SR);
	const out = new Float32Array(n);
	let ph = 0;
	let lp = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		ph = (ph + hz / SR) % 1;
		const sq = (ph < 0.5 ? 1 : -1) * 0.6 + (ph * 2 - 1) * 0.4;
		const cutoff = 500 + bright * 4500 * Math.exp(-t * 14);
		lp += (1 - Math.exp((-TAU * cutoff) / SR)) * (sq - lp);
		out[i] = lp * Math.exp(-t * 7) * Math.min(1, t * 800);
	}
	return out;
}

function padChord(tones: number[], dur: number, bright: number): Stereo {
	const n = Math.round(dur * SR);
	const out: Stereo = [new Float32Array(n), new Float32Array(n)];
	const voices = tones.flatMap((m) =>
		[-0.09, 0.0, 0.11].map((d) => ({
			hz: midiHz(m + d),
			ph: noise() * 0.5 + 0.5,
		})),
	);
	let lpL = 0;
	let lpR = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		let l = 0;
		let r = 0;
		voices.forEach((v, k) => {
			v.ph = (v.ph + v.hz / SR) % 1;
			const s = v.ph * 2 - 1;
			if (k % 2) l += s;
			else r += s;
		});
		const cutoff = 400 + bright * 2400 * (0.6 + 0.4 * Math.sin(TAU * 0.25 * t));
		const a = 1 - Math.exp((-TAU * cutoff) / SR);
		lpL += a * (l - lpL);
		lpR += a * (r - lpR);
		const env = Math.min(1, t / 0.4) * Math.min(1, (dur - t) / 0.3);
		out[0][i] = lpL * env * 0.06;
		out[1][i] = lpR * env * 0.06;
	}
	return out;
}

// ── Arrangement ─────────────────────────────────────────────────────────────

const drums = stem();
const bass = stem();
const music = stem();

const K = kickVoice();
const C = clapVoice();
const hatClosed = hatVoice(false);
const hatOpen = hatVoice(true);
for (const b of KICKS) add(drums, beatSec(b), K, 0.95);
for (const b of CLAPS) add(drums, beatSec(b), C, 0.55, 0.05);
HATS.forEach((h, i) => {
	add(
		drums,
		beatSec(h.beat, h.step),
		h.open ? hatOpen : hatClosed,
		0.5,
		i % 2 ? 0.35 : -0.35,
	);
});

const kickTimes = KICKS.map((b) => beatSec(b));
const duck = (t: number) => {
	// Side-chain feel: dip under each kick.
	let g = 1;
	for (const k of kickTimes) {
		const d = t - k;
		if (d >= 0 && d < 0.3) g = Math.min(g, 0.25 + 0.75 * (d / 0.3) ** 0.6);
	}
	return g;
};

const ARP = [0, 1, 2, 3, 2, 1, 3, 2];
for (let bar = 0; bar < TOTAL_BARS; bar++) {
	const section = sectionAt(bar);
	const chord = PROGRESSION[bar % PROGRESSION.length];
	const barSec = beatSec(bar * 4);
	const barDur = SECONDS_PER_BEAT * 4;
	const bright =
		section === "intro"
			? 0.25
			: section === "breakdown"
				? 0.45
				: section === "drop"
					? 1
					: 0.7;

	if (section !== "outro") {
		const pad = padChord(chord.tones, barDur + 0.25, bright);
		add(music, barSec, pad[0], 1, -0.4);
		add(music, barSec, pad[1], 1, 0.4);
	} else {
		const pad = padChord(PROGRESSION[0].tones, 5, 0.3);
		add(music, barSec, pad[0], 1.2, -0.4);
		add(music, barSec, pad[1], 1.2, 0.4);
	}

	if (section !== "intro" && section !== "outro") {
		// Bass: 8ths on the root, octave jump on the last of each beat pair.
		for (let e = 0; e < 8; e++) {
			const t = barSec + e * (SECONDS_PER_BEAT / 2);
			const hz = midiHz(chord.root - 12 + (e % 4 === 3 ? 12 : 0));
			add(
				bass,
				t,
				bassNote(hz, SECONDS_PER_BEAT / 2 - 0.01),
				section === "breakdown" ? 0.25 : 0.5,
			);
		}
	}

	if (section !== "outro") {
		// Arp: 16ths over the chord, an octave up in drops.
		const lift = section === "drop" ? 12 : 0;
		for (let s = 0; s < 16; s++) {
			if (section === "intro" && bar === 0 && s % 2) continue;
			const tone = chord.tones[ARP[s % ARP.length]] + 12 + lift;
			const t = barSec + s * (SECONDS_PER_BEAT / 4);
			add(
				music,
				t,
				pluck(midiHz(tone), 0.28, bright),
				0.11,
				Math.sin(s * 0.9) * 0.6,
			);
		}
	}
}

for (let i = 0; i < LENGTH; i++) {
	const g = duck(i / SR);
	bass[0][i] *= g;
	bass[1][i] *= g;
	music[0][i] *= 0.55 + 0.45 * g;
	music[1][i] *= 0.55 + 0.45 * g;
}

// ── Write ───────────────────────────────────────────────────────────────────

function wav(data: Stereo, peak: number): Buffer {
	const n = data[0].length;
	const buf = Buffer.alloc(44 + n * 4);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + n * 4, 4);
	buf.write("WAVEfmt ", 8);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(2, 22);
	buf.writeUInt32LE(SR, 24);
	buf.writeUInt32LE(SR * 4, 28);
	buf.writeUInt16LE(4, 32);
	buf.writeUInt16LE(16, 34);
	buf.write("data", 36);
	buf.writeUInt32LE(n * 4, 40);
	let max = 1e-9;
	for (let i = 0; i < n; i++)
		max = Math.max(max, Math.abs(data[0][i]), Math.abs(data[1][i]));
	const g = peak / max;
	for (let i = 0; i < n; i++) {
		buf.writeInt16LE(
			Math.round(Math.max(-1, Math.min(1, data[0][i] * g)) * 32767),
			44 + i * 4,
		);
		buf.writeInt16LE(
			Math.round(Math.max(-1, Math.min(1, data[1][i] * g)) * 32767),
			46 + i * 4,
		);
	}
	return buf;
}

const dir = path.join(ASSETS, "stems");
await fs.mkdir(dir, { recursive: true });
// Stems keep their relative levels: each is normalised to its own role's peak.
const stems: Record<string, [Stereo, number]> = {
	drums: [drums, 0.7],
	bass: [bass, 0.5],
	music: [music, 0.42],
};
for (const [name, [data, peak]] of Object.entries(stems)) {
	const file = path.join(dir, `${name}.wav`);
	await fs.writeFile(file, wav(data, peak));
	console.log(file);
}
process.exit(0);
