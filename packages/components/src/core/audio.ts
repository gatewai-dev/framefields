/**
 * Audio analysis, offline and deterministic: decoded samples in, plain
 * per-frame data out (`AudioLevels`). Components bind it to props as
 * signals or bake it into glyph tables, so the result seeks exactly and
 * serialises as JSON.
 */
import { z } from "zod";

/** A track's spectrum and loudness per frame, every value 0–1. */
export interface AudioLevels {
	fps: number;
	/** Length in frames. */
	frames: number;
	/** `[band][frame]`, low → high frequencies. */
	bands: number[][];
	/** Loudness envelope, `[frame]`. */
	level: number[];
	/** Onset frames (kicks, plosives), from low-band flux. */
	beats: number[];
}

export interface AnalyzeOptions {
	/** Frame rate of the composition. Default 30. */
	fps?: number;
	/** Log-spaced bands. Default 32. */
	bands?: number;
	/** Lowest band edge, Hz. Default 50. */
	minHz?: number;
	/** Highest band edge, Hz. Default 12 000 (or Nyquist). */
	maxHz?: number;
}

const FFT_SIZE = 2048;
/** dB below a band's reference that reads as 0. */
const BAND_RANGE = 42;
/** A band's reference never sits more than this under the loudest band's. */
const BAND_FLOOR = 30;
const LEVEL_RANGE = 48;
/** References never sit below this (dBFS): silence stays 0, not normalised up. */
const SILENCE = -60;

/** In-place radix-2 FFT over `re` / `im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j] as number, re[i] as number];
			[im[i], im[j]] = [im[j] as number, im[i] as number];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const a = i + k;
				const b = a + len / 2;
				const xr = (re[b] as number) * cr - (im[b] as number) * ci;
				const xi = (re[b] as number) * ci + (im[b] as number) * cr;
				re[b] = (re[a] as number) - xr;
				im[b] = (im[a] as number) - xi;
				re[a] = (re[a] as number) + xr;
				im[a] = (im[a] as number) + xi;
				const t = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = t;
			}
		}
	}
}

function percentile(values: readonly number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[
		Math.min(sorted.length - 1, Math.floor(p * sorted.length))
	] as number;
}

const db = (v: number) => 20 * Math.log10(v + 1e-9);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Band edges in Hz, log-spaced. */
export function bandEdges(
	count: number,
	minHz: number,
	maxHz: number,
): number[] {
	return Array.from(
		{ length: count + 1 },
		(_, i) => minHz * (maxHz / minHz) ** (i / count),
	);
}

/**
 * Analyse decoded audio: a Hann-windowed FFT per frame into log-spaced
 * bands, each normalised to its own 98th percentile (floored 30 dB under the
 * loudest band's, so a quiet band is not stretched into noise), an RMS level
 * envelope, and onsets from low-band spectral flux.
 */
export function analyzeChannels(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: AnalyzeOptions = {},
): AudioLevels {
	const fps = options.fps ?? 30;
	const count = options.bands ?? 32;
	const minHz = options.minHz ?? 50;
	const maxHz = Math.min(options.maxHz ?? 12000, sampleRate / 2);
	const length = Math.max(0, ...channels.map((c) => c.length));
	const mono = new Float32Array(length);
	for (const c of channels)
		for (let i = 0; i < c.length; i++)
			mono[i] = (mono[i] as number) + (c[i] as number) / channels.length;

	const frames = Math.ceil((length / sampleRate) * fps);
	const hop = sampleRate / fps;
	const hann = Float64Array.from(
		{ length: FFT_SIZE },
		(_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)),
	);
	const edges = bandEdges(count, minHz, maxHz);
	const binHz = sampleRate / FFT_SIZE;
	const ranges = edges.slice(0, -1).map((lo, b) => {
		const from = Math.max(1, Math.floor(lo / binHz));
		const to = Math.max(from + 1, Math.ceil((edges[b + 1] as number) / binHz));
		return [from, Math.min(FFT_SIZE / 2, to)] as const;
	});
	const lowBands = edges.filter((e) => e < 150).length;

	const raw = Array.from({ length: count }, () => new Array<number>(frames));
	const rms = new Array<number>(frames);
	const flux = new Array<number>(frames).fill(0);
	let previousLow: number[] | null = null;
	const re = new Float64Array(FFT_SIZE);
	const im = new Float64Array(FFT_SIZE);
	for (let f = 0; f < frames; f++) {
		const centre = Math.round((f + 0.5) * hop);
		const from = centre - FFT_SIZE / 2;
		for (let i = 0; i < FFT_SIZE; i++) {
			const s = mono[from + i];
			re[i] = (s ?? 0) * (hann[i] as number);
			im[i] = 0;
		}
		fft(re, im);
		const low: number[] = [];
		ranges.forEach(([a, b], band) => {
			let sum = 0;
			for (let k = a; k < b; k++)
				sum += Math.hypot(re[k] as number, im[k] as number);
			const mag = (sum / (b - a)) * (4 / FFT_SIZE);
			(raw[band] as number[])[f] = mag;
			if (band < Math.max(1, lowBands)) low.push(mag);
		});
		if (previousLow)
			flux[f] = low.reduce(
				(acc, v, i) =>
					acc + Math.max(0, v - ((previousLow as number[])[i] ?? 0)),
				0,
			);
		previousLow = low;
		// Loudness of this frame's own stretch of samples.
		const s0 = Math.round(f * hop);
		const s1 = Math.min(length, Math.round((f + 1) * hop));
		let e = 0;
		for (let i = s0; i < s1; i++) e += (mono[i] as number) ** 2;
		rms[f] = Math.sqrt(e / Math.max(1, s1 - s0));
	}

	const refs = raw.map((band) => percentile(band.map(db), 0.98));
	const loudest = Math.max(...refs);
	const bands = raw.map((band, b) => {
		const ref = Math.max(refs[b] as number, loudest - BAND_FLOOR, SILENCE - 20);
		return band.map((v) => round(clamp01(1 - (ref - db(v)) / BAND_RANGE)));
	});
	const levelRef = Math.max(SILENCE, percentile(rms.map(db), 0.98));
	const level = rms.map((v) =>
		round(clamp01(1 - (levelRef - db(v)) / LEVEL_RANGE)),
	);
	return { fps, frames, bands, level, beats: pickOnsets(flux, fps) };
}

/** Local maxima of `flux` well above its neighbourhood, at least 0.15 s apart. */
function pickOnsets(flux: readonly number[], fps: number): number[] {
	const reach = Math.max(2, Math.round(fps * 0.5));
	const gap = Math.max(1, Math.round(fps * 0.15));
	const peak = Math.max(0, ...flux);
	const beats: number[] = [];
	for (let f = 1; f < flux.length; f++) {
		const v = flux[f] as number;
		if (v <= peak * 0.08) continue;
		if (v < (flux[f - 1] as number) || v < (flux[f + 1] ?? 0)) continue;
		const near = flux.slice(Math.max(0, f - reach), f + reach + 1);
		const mean = near.reduce((a, b) => a + b, 0) / near.length;
		const sd = Math.sqrt(
			near.reduce((a, b) => a + (b - mean) ** 2, 0) / near.length,
		);
		if (v < mean + 1.5 * sd) continue;
		const last = beats[beats.length - 1];
		if (last !== undefined && f - last < gap) continue;
		beats.push(f);
	}
	return beats;
}

/** Average adjacent bands down (or repeat them up) to `count` bands. */
export function resampleBands(
	bands: readonly (readonly number[])[],
	count: number,
): number[][] {
	const n = bands.length;
	if (n === 0) return [];
	const frames = bands[0]?.length ?? 0;
	return Array.from({ length: count }, (_, i) => {
		const a = Math.floor((i * n) / count);
		const b = Math.max(a + 1, Math.floor(((i + 1) * n) / count));
		return Array.from({ length: frames }, (_, f) => {
			let sum = 0;
			for (let k = a; k < b; k++)
				sum += (bands[k] as readonly number[])[f] ?? 0;
			return round(sum / (b - a));
		});
	});
}

/** Each value falls no faster than `release` frames from its peak (attack is instant). */
export function smoothRelease(
	values: readonly number[],
	release: number,
): number[] {
	if (release <= 0) return [...values];
	const k = 1 / (release + 1);
	let prev = 0;
	return values.map((v) => {
		prev = v >= prev ? v : prev + (v - prev) * k;
		return round(prev);
	});
}

/** The schema for `AudioLevels` props (Waveform, Captions `pulse`). */
export function audioLevelsSchema(): z.ZodType<AudioLevels> {
	return z.object({
		fps: z.number().positive(),
		frames: z.number().int().min(0),
		bands: z.array(z.array(z.number())),
		level: z.array(z.number()),
		beats: z.array(z.number().int()),
	});
}
