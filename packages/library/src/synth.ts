/**
 * The library's own sound effects, synthesized from code: deterministic
 * (seeded noise, fixed math), so a recipe always gives the same bytes and
 * the library owns every sample outright. Each recipe is a small DSP graph
 * written out as a 48 kHz stereo 16-bit WAV.
 */

export const SAMPLE_RATE = 48_000;

/** Parameters of one effect, as written in a catalog entry's `synth`. */
export type SynthRecipe =
	| { kind: "whoosh"; seconds: number; from: number; to: number; seed?: number }
	| { kind: "riser"; seconds: number; from: number; to: number; seed?: number }
	| { kind: "impact"; seconds: number; from: number; to: number; seed?: number }
	| { kind: "click"; seconds: number; tone: number; seed?: number }
	| { kind: "pop"; seconds: number; from: number; to: number }
	| { kind: "chime"; seconds: number; notes: number[]; gap: number }
	| { kind: "glitch"; seconds: number; seed?: number };

/** Mulberry32: a tiny seeded PRNG, uniform in [-1, 1). */
function noise(seed = 1): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
	};
}

/** A state-variable band-pass whose center moves per sample. */
function bandPass(q: number) {
	let low = 0;
	let band = 0;
	return (x: number, hz: number) => {
		const f =
			2 * Math.sin((Math.PI * Math.min(hz, SAMPLE_RATE / 6)) / SAMPLE_RATE);
		low += f * band;
		const high = x - low - band / q;
		band += f * high;
		return band;
	};
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Exponential glide between two frequencies. */
const glide = (from: number, to: number, t: number) => from * (to / from) ** t;
/** Attack then exponential-ish release, peak 1. */
const envelope = (t: number, attack: number, release: number) =>
	t < attack ? t / attack : Math.exp(-(t - attack) / release);

/** Left and right channels, each in [-1, 1]. */
export function synthesize(recipe: SynthRecipe): [Float32Array, Float32Array] {
	const n = Math.round(recipe.seconds * SAMPLE_RATE);
	const left = new Float32Array(n);
	const right = new Float32Array(n);
	const write = (i: number, l: number, r = l) => {
		left[i] = l;
		right[i] = r;
	};
	switch (recipe.kind) {
		case "whoosh":
		case "riser": {
			const rl = noise(recipe.seed ?? 7);
			const rr = noise((recipe.seed ?? 7) + 1);
			const fl = bandPass(recipe.kind === "riser" ? 6 : 2.5);
			const fr = bandPass(recipe.kind === "riser" ? 6 : 2.5);
			for (let i = 0; i < n; i++) {
				const t = i / n;
				// A whoosh swells to the middle and passes; a riser builds to its end.
				const env =
					recipe.kind === "whoosh"
						? Math.sin(Math.PI * t) ** 2
						: t ** 2.2 * (1 - Math.max(0, (t - 0.97) / 0.03));
				const hz = glide(recipe.from, recipe.to, t);
				const pan = recipe.kind === "whoosh" ? lerp(-0.6, 0.6, t) : 0;
				const tone =
					recipe.kind === "riser"
						? 0.25 * Math.sin(2 * Math.PI * hz * (i / SAMPLE_RATE) * 0.5)
						: 0;
				const l = fl(rl(), hz) * 2.2 + tone;
				const r = fr(rr(), hz * 1.03) * 2.2 + tone;
				write(i, l * env * (1 - pan) * 0.7, r * env * (1 + pan) * 0.7);
			}
			break;
		}
		case "impact": {
			const rnd = noise(recipe.seed ?? 3);
			const body = bandPass(1.2);
			let phase = 0;
			for (let i = 0; i < n; i++) {
				const s = i / SAMPLE_RATE;
				const hz = glide(recipe.from, recipe.to, Math.min(1, s / 0.35));
				phase += (2 * Math.PI * hz) / SAMPLE_RATE;
				const boom = Math.sin(phase) * envelope(s, 0.002, recipe.seconds / 3.5);
				const crack = body(rnd(), 1800) * envelope(s, 0.0005, 0.03) * 1.5;
				const v = Math.tanh((boom + crack) * 1.6) * 0.9;
				write(i, v);
			}
			break;
		}
		case "click": {
			const rnd = noise(recipe.seed ?? 11);
			const body = bandPass(12);
			for (let i = 0; i < n; i++) {
				const s = i / SAMPLE_RATE;
				const v = body(rnd() * envelope(s, 0.0002, 0.002), recipe.tone) * 3;
				write(i, v * envelope(s, 0.0003, 0.02));
			}
			break;
		}
		case "pop": {
			let phase = 0;
			for (let i = 0; i < n; i++) {
				const s = i / SAMPLE_RATE;
				const hz = glide(
					recipe.from,
					recipe.to,
					Math.min(1, s / recipe.seconds),
				);
				phase += (2 * Math.PI * hz) / SAMPLE_RATE;
				write(
					i,
					Math.sin(phase) * envelope(s, 0.001, recipe.seconds / 4) * 0.8,
				);
			}
			break;
		}
		case "chime": {
			// Bell-like: a few inharmonic partials per note, each decaying on its own.
			const partials = [
				[1, 1, 1],
				[2.76, 0.45, 0.6],
				[5.4, 0.25, 0.35],
				[8.93, 0.12, 0.2],
			] as const;
			for (let i = 0; i < n; i++) {
				const s = i / SAMPLE_RATE;
				let l = 0;
				let r = 0;
				recipe.notes.forEach((hz, k) => {
					const local = s - k * recipe.gap;
					if (local < 0) return;
					const pan =
						recipe.notes.length > 1
							? lerp(-0.3, 0.3, k / (recipe.notes.length - 1))
							: 0;
					let v = 0;
					for (const [ratio, gain, decay] of partials)
						v +=
							Math.sin(2 * Math.PI * hz * ratio * local) *
							gain *
							envelope(local, 0.002, decay);
					l += v * (1 - pan);
					r += v * (1 + pan);
				});
				write(i, l * 0.3, r * 0.3);
			}
			break;
		}
		case "glitch": {
			const rnd = noise(recipe.seed ?? 5);
			const step = Math.round(SAMPLE_RATE * 0.012);
			let held = 0;
			let hz = 400;
			let phase = 0;
			for (let i = 0; i < n; i++) {
				if (i % step === 0) {
					held = rnd();
					hz = 200 + Math.abs(rnd()) * 2400;
				}
				phase += (2 * Math.PI * hz) / SAMPLE_RATE;
				const square = Math.sign(Math.sin(phase));
				const gate = Math.abs(held) > 0.35 ? 1 : 0;
				const s = i / SAMPLE_RATE;
				const v =
					(square * 0.5 + held * 0.5) *
					gate *
					envelope(s, 0.001, recipe.seconds / 2);
				write(i, v * 0.6, v * 0.6 * (held > 0 ? 1 : 0.5));
			}
			break;
		}
	}
	normalize(left, right, 0.89);
	return [left, right];
}

/** Scales both channels so the louder peak lands at `peak`. */
function normalize(
	left: Float32Array,
	right: Float32Array,
	peak: number,
): void {
	let max = 0;
	for (let i = 0; i < left.length; i++)
		max = Math.max(max, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
	if (max === 0) return;
	const k = peak / max;
	for (let i = 0; i < left.length; i++) {
		left[i] = (left[i] ?? 0) * k;
		right[i] = (right[i] ?? 0) * k;
	}
}

/** Stereo float samples as a 16-bit PCM WAV file. */
export function encodeWav([left, right]: [Float32Array, Float32Array]): Buffer {
	const frames = left.length;
	const data = frames * 4;
	const out = Buffer.alloc(44 + data);
	out.write("RIFF", 0, "ascii");
	out.writeUInt32LE(36 + data, 4);
	out.write("WAVE", 8, "ascii");
	out.write("fmt ", 12, "ascii");
	out.writeUInt32LE(16, 16);
	out.writeUInt16LE(1, 20); // PCM
	out.writeUInt16LE(2, 22);
	out.writeUInt32LE(SAMPLE_RATE, 24);
	out.writeUInt32LE(SAMPLE_RATE * 4, 28);
	out.writeUInt16LE(4, 32);
	out.writeUInt16LE(16, 34);
	out.write("data", 36, "ascii");
	out.writeUInt32LE(data, 40);
	const pcm = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
	for (let i = 0; i < frames; i++) {
		out.writeInt16LE(pcm(left[i] ?? 0), 44 + i * 4);
		out.writeInt16LE(pcm(right[i] ?? 0), 46 + i * 4);
	}
	return out;
}
