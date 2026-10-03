import type { RenderDiagnostic } from "@gitframes/core";

/**
 * Quality checks run on a video while it renders: frames are measured as
 * they are read back for the encoder and audio as it is mixed, so the report
 * describes exactly what was encoded without decoding the file again.
 */
export interface VideoQaOptions {
	/** Luma (0-1) at or below which a pixel counts as black. Default 0.1. */
	readonly blackPixelThreshold?: number;
	/** Share of black pixels that makes a frame black. Default 0.98. */
	readonly blackFrameRatio?: number;
	/** Shortest run of black frames reported. Default 0.5 s. */
	readonly minBlackSec?: number;
	/** Shortest run of unchanging frames reported. Default 2 s. */
	readonly minFrozenSec?: number;
	/** Level (dBFS, 100 ms windows) below which audio counts as silent. Default -60. */
	readonly silenceDbfs?: number;
	/** Shortest silent stretch reported. Default 2 s. */
	readonly minSilenceSec?: number;
	/** Integrated loudness to hit, e.g. -14 for most streaming platforms. Unchecked when unset. */
	readonly targetLufs?: number;
	/** Allowed distance from `targetLufs`, in LU. Default 1. */
	readonly lufsTolerance?: number;
}

export interface QaSegment {
	readonly startSec: number;
	readonly endSec: number;
}

export interface QaIssue {
	readonly severity: "error" | "warning" | "info";
	/** Stable machine-readable kind, e.g. "black_frames", "audio_clipping" */
	readonly code: string;
	readonly message: string;
	readonly startSec?: number;
	readonly endSec?: number;
	readonly layerId?: string;
}

export interface VideoQaStats {
	readonly expectedFrames: number;
	readonly encodedFrames: number;
	readonly fps: number;
	readonly width: number;
	readonly height: number;
	/** Average luma over the whole video, 0-1 */
	readonly meanLuma: number;
	readonly blackSegments: readonly QaSegment[];
	readonly frozenSegments: readonly QaSegment[];
}

export interface AudioQaStats {
	readonly sampleRate: number;
	readonly channels: number;
	readonly durationSec: number;
	/** Highest sample, dBFS (sample peak, not true peak) */
	readonly peakDbfs: number;
	/** Mean level over the whole track, dBFS */
	readonly rmsDbfs: number;
	/** ITU-R BS.1770 integrated loudness; null when the track is silent */
	readonly integratedLufs: number | null;
	/** Samples at or beyond full scale */
	readonly clippedSamples: number;
	readonly silentSegments: readonly QaSegment[];
}

export interface VideoQaReport {
	/** No errors or warnings (info issues do not fail a render) */
	readonly passed: boolean;
	readonly video?: VideoQaStats;
	readonly audio?: AudioQaStats;
	readonly issues: readonly QaIssue[];
}

const DEFAULTS = {
	blackPixelThreshold: 0.1,
	blackFrameRatio: 0.98,
	minBlackSec: 0.5,
	minFrozenSec: 2,
	silenceDbfs: -60,
	minSilenceSec: 2,
	lufsTolerance: 1,
} as const;

// Every 4th pixel of every 4th row: 1/16 of the frame keeps inspection
// around a millisecond at 1080p while still seeing anything frame-sized.
const SAMPLE_STEP = 4;
// Mean absolute luma change (0-255) under which two frames are the same picture.
const FROZEN_DIFF = 0.25;

/** Measures frames handed to it in order, as RGBA bytes. */
export class FrameInspector {
	private readonly blackLuma: number;
	private readonly blackRatio: number;
	private readonly black: boolean[] = [];
	private readonly sameAsPrevious: boolean[] = [];
	private lumaSum = 0;
	private previous: Uint8Array | null = null;

	constructor(options: VideoQaOptions = {}) {
		this.blackLuma =
			(options.blackPixelThreshold ?? DEFAULTS.blackPixelThreshold) * 255;
		this.blackRatio = options.blackFrameRatio ?? DEFAULTS.blackFrameRatio;
	}

	get frameCount(): number {
		return this.black.length;
	}

	inspect(rgba: Uint8Array, width: number, height: number): void {
		const cols = Math.ceil(width / SAMPLE_STEP);
		const rows = Math.ceil(height / SAMPLE_STEP);
		const luma = new Uint8Array(cols * rows);
		let blackCount = 0;
		let sum = 0;
		let k = 0;
		for (let y = 0; y < height; y += SAMPLE_STEP) {
			let p = y * width * 4;
			for (let x = 0; x < width; x += SAMPLE_STEP, p += SAMPLE_STEP * 4) {
				// BT.709 luma from 8-bit RGB
				const l =
					0.2126 * rgba[p]! + 0.7152 * rgba[p + 1]! + 0.0722 * rgba[p + 2]!;
				luma[k++] = l;
				sum += l;
				if (l <= this.blackLuma) blackCount++;
			}
		}
		const n = luma.length;
		this.lumaSum += sum / n / 255;
		this.black.push(blackCount / n >= this.blackRatio);

		let same = false;
		if (this.previous && this.previous.length === n) {
			let diff = 0;
			for (let i = 0; i < n; i++)
				diff += Math.abs(luma[i]! - this.previous[i]!);
			same = diff / n < FROZEN_DIFF;
		}
		this.sameAsPrevious.push(same);
		this.previous = luma;
	}

	stats(
		expectedFrames: number,
		encodedFrames: number,
		fps: number,
		width: number,
		height: number,
		options: VideoQaOptions = {},
	): VideoQaStats {
		const minBlack = Math.max(
			1,
			Math.round((options.minBlackSec ?? DEFAULTS.minBlackSec) * fps),
		);
		const minFrozen = Math.max(
			2,
			Math.round((options.minFrozenSec ?? DEFAULTS.minFrozenSec) * fps),
		);
		const blackSegments = runs(this.black, minBlack).map(([a, b]) => ({
			startSec: a / fps,
			endSec: b / fps,
		}));
		// A frozen run starts on the frame before its first repeat.
		const frozenSegments = runs(this.sameAsPrevious, minFrozen - 1).map(
			([a, b]) => ({ startSec: (a - 1) / fps, endSec: b / fps }),
		);
		return {
			expectedFrames,
			encodedFrames,
			fps,
			width,
			height,
			meanLuma: this.frameCount > 0 ? this.lumaSum / this.frameCount : 0,
			blackSegments,
			frozenSegments,
		};
	}
}

/** [start, end) index ranges where flags hold for at least minLength in a row. */
function runs(
	flags: readonly boolean[],
	minLength: number,
): [number, number][] {
	const out: [number, number][] = [];
	let start = -1;
	for (let i = 0; i <= flags.length; i++) {
		if (i < flags.length && flags[i]) {
			if (start < 0) start = i;
		} else if (start >= 0) {
			if (i - start >= minLength) out.push([start, i]);
			start = -1;
		}
	}
	return out;
}

const toDb = (power: number) =>
	power > 0 ? 10 * Math.log10(power) : -Infinity;

/** Measures a mixed audio track (one Float32Array per channel). */
export function analyzeAudio(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: VideoQaOptions = {},
): AudioQaStats {
	const length = channels[0]?.length ?? 0;
	let peak = 0;
	let sumSquares = 0;
	let clipped = 0;
	for (const ch of channels) {
		for (let i = 0; i < length; i++) {
			const v = Math.abs(ch[i]!);
			if (v > peak) peak = v;
			if (v >= 0.9999) clipped++;
			sumSquares += v * v;
		}
	}
	const total = length * Math.max(1, channels.length);

	const silenceDbfs = options.silenceDbfs ?? DEFAULTS.silenceDbfs;
	const window = Math.max(1, Math.round(sampleRate * 0.1));
	const silent: boolean[] = [];
	for (let start = 0; start < length; start += window) {
		const end = Math.min(length, start + window);
		let s = 0;
		for (const ch of channels)
			for (let i = start; i < end; i++) s += ch[i]! * ch[i]!;
		silent.push(toDb(s / ((end - start) * channels.length)) < silenceDbfs);
	}
	const minSilence = Math.max(
		1,
		Math.round((options.minSilenceSec ?? DEFAULTS.minSilenceSec) / 0.1),
	);
	const silentSegments = runs(silent, minSilence).map(([a, b]) => ({
		startSec: (a * window) / sampleRate,
		endSec: Math.min(length, b * window) / sampleRate,
	}));

	const peakDbfs = 20 * Math.log10(Math.max(peak, 1e-12));
	return {
		sampleRate,
		channels: channels.length,
		durationSec: length / sampleRate,
		peakDbfs,
		rmsDbfs: toDb(sumSquares / Math.max(1, total)),
		integratedLufs:
			peakDbfs < silenceDbfs ? null : integratedLoudness(channels, sampleRate),
		clippedSamples: clipped,
		silentSegments,
	};
}

interface Biquad {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
}

/** BS.1770 K-weighting stage 1: +4 dB high shelf around 1.5 kHz (the head). */
function highShelf(sampleRate: number): Biquad {
	const A = 10 ** (4 / 40);
	const w0 = (2 * Math.PI * 1500) / sampleRate;
	const cos = Math.cos(w0);
	const alpha = Math.sin(w0) / (2 / Math.SQRT2);
	const sq = 2 * Math.sqrt(A) * alpha;
	const a0 = A + 1 - (A - 1) * cos + sq;
	return {
		b0: (A * (A + 1 + (A - 1) * cos + sq)) / a0,
		b1: (-2 * A * (A - 1 + (A + 1) * cos)) / a0,
		b2: (A * (A + 1 + (A - 1) * cos - sq)) / a0,
		a1: (2 * (A - 1 - (A + 1) * cos)) / a0,
		a2: (A + 1 - (A - 1) * cos - sq) / a0,
	};
}

/** BS.1770 K-weighting stage 2: 38 Hz high pass, Q 0.5 (the RLB curve). */
function highPass(sampleRate: number): Biquad {
	const w0 = (2 * Math.PI * 38) / sampleRate;
	const cos = Math.cos(w0);
	const alpha = Math.sin(w0) / (2 * 0.5);
	const a0 = 1 + alpha;
	return {
		b0: (1 + cos) / 2 / a0,
		b1: -(1 + cos) / a0,
		b2: (1 + cos) / 2 / a0,
		a1: (-2 * cos) / a0,
		a2: (1 - alpha) / a0,
	};
}

function filter(input: Float32Array, f: Biquad): Float32Array {
	const out = new Float32Array(input.length);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < input.length; i++) {
		const x = input[i]!;
		const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
		out[i] = y;
		x2 = x1;
		x1 = x;
		y2 = y1;
		y1 = y;
	}
	return out;
}

/**
 * ITU-R BS.1770-4 integrated loudness (LUFS): K-weighted mean square in
 * 400 ms blocks with 75% overlap, gated at -70 LUFS and then at 10 LU below
 * the mean of what passed. Channels weigh 1 (stereo and mono layouts).
 */
export function integratedLoudness(
	channels: readonly Float32Array[],
	sampleRate: number,
): number | null {
	const shelf = highShelf(sampleRate);
	const hp = highPass(sampleRate);
	const weighted = channels.map((ch) => filter(filter(ch, shelf), hp));
	const length = weighted[0]?.length ?? 0;
	const block = Math.round(0.4 * sampleRate);
	const hop = Math.round(0.1 * sampleRate);
	if (length < block) return null;

	const blockPower: number[] = [];
	for (let start = 0; start + block <= length; start += hop) {
		let power = 0;
		for (const ch of weighted) {
			let s = 0;
			for (let i = start; i < start + block; i++) s += ch[i]! * ch[i]!;
			power += s / block;
		}
		blockPower.push(power);
	}
	const lufs = (power: number) => -0.691 + toDb(power);
	const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

	const absolute = blockPower.filter((p) => lufs(p) > -70);
	if (absolute.length === 0) return null;
	const relativeGate = lufs(mean(absolute)) - 10;
	const gated = absolute.filter((p) => lufs(p) > relativeGate);
	return gated.length > 0 ? lufs(mean(gated)) : null;
}

/** Turn measurements and document diagnostics into a report with issues. */
export function buildQaReport(parts: {
	video?: VideoQaStats;
	audio?: AudioQaStats;
	diagnostics?: readonly RenderDiagnostic[];
	options?: VideoQaOptions;
}): VideoQaReport {
	const { video, audio, options = {} } = parts;
	const issues: QaIssue[] = [];
	const at = (s: QaSegment) =>
		`${s.startSec.toFixed(2)}–${s.endSec.toFixed(2)} s`;

	if (video) {
		if (video.encodedFrames !== video.expectedFrames) {
			issues.push({
				severity: "error",
				code: "frames_missing",
				message: `${video.encodedFrames} of ${video.expectedFrames} frames were encoded`,
			});
		}
		for (const s of video.blackSegments) {
			issues.push({
				severity: "warning",
				code: "black_frames",
				message: `Black frames at ${at(s)}`,
				...s,
			});
		}
		for (const s of video.frozenSegments) {
			issues.push({
				severity: "info",
				code: "frozen_video",
				message: `Picture does not change at ${at(s)}`,
				...s,
			});
		}
	}

	if (audio) {
		if (audio.integratedLufs === null) {
			issues.push({
				severity: "info",
				code: "audio_silent",
				message: "The audio track is silent",
			});
		} else {
			if (audio.clippedSamples > 0) {
				issues.push({
					severity: "warning",
					code: "audio_clipping",
					message: `${audio.clippedSamples} audio sample(s) at or beyond full scale (peak ${audio.peakDbfs.toFixed(1)} dBFS)`,
				});
			}
			for (const s of audio.silentSegments) {
				issues.push({
					severity: "info",
					code: "audio_silence",
					message: `Silence at ${at(s)}`,
					...s,
				});
			}
			if (options.targetLufs !== undefined) {
				const off = audio.integratedLufs - options.targetLufs;
				const tolerance = options.lufsTolerance ?? DEFAULTS.lufsTolerance;
				if (Math.abs(off) > tolerance) {
					issues.push({
						severity: "warning",
						code: "loudness_off_target",
						message: `Integrated loudness ${audio.integratedLufs.toFixed(1)} LUFS is ${Math.abs(off).toFixed(1)} LU ${off > 0 ? "above" : "below"} the ${options.targetLufs} LUFS target`,
					});
				}
			}
		}
	}

	for (const d of parts.diagnostics ?? []) {
		issues.push({
			severity: d.severity,
			code: d.code,
			message: d.message,
			...(d.layerId !== undefined && { layerId: d.layerId }),
		});
	}

	return {
		passed: !issues.some((i) => i.severity !== "info"),
		...(video && { video }),
		...(audio && { audio }),
		issues,
	};
}

/** A short human- and agent-readable summary of a report. */
export function formatQaReport(report: VideoQaReport): string {
	const lines = [`QA ${report.passed ? "passed" : "FAILED"}`];
	const v = report.video;
	if (v) {
		lines.push(
			`  video: ${v.encodedFrames}/${v.expectedFrames} frames, ${v.width}x${v.height} @ ${v.fps} fps, mean luma ${v.meanLuma.toFixed(2)}`,
		);
	}
	const a = report.audio;
	if (a) {
		const lufs =
			a.integratedLufs === null
				? "silent"
				: `${a.integratedLufs.toFixed(1)} LUFS`;
		lines.push(
			`  audio: ${a.durationSec.toFixed(2)} s, ${lufs}, peak ${a.peakDbfs.toFixed(1)} dBFS, rms ${a.rmsDbfs.toFixed(1)} dBFS`,
		);
	}
	for (const i of report.issues) {
		lines.push(`  ${i.severity.padEnd(7)} ${i.code}: ${i.message}`);
	}
	return lines.join("\n");
}
