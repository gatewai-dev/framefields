import { signalRegistry } from "@gitframes/webgpu-renderers";
import type {
	AnimationTrack,
	LayerAnimationSpec as LayerAnimation,
	TrackSource,
} from "./schema.js";

export type SignalDataSource = unknown;

export interface TrackEvaluationContext {
	/** Root frame (timeline frame). */
	rootFrame?: number;
	/** Layer start frame offset. */
	startFrame?: number;
	/** Base layer property fallback values. */
	baseValues?: Record<string, unknown>;
	/** Connected signal providers indexed by inputHandleId. */
	signals?: Record<string, SignalDataSource>;
}

// ── 1D Coherent Gradient Noise for Wiggle ─────────────────────────────

function hash1D(n: number, seed: number): number {
	let x = (Math.floor(n) ^ (seed * 1013)) | 0;
	x = Math.imul(x ^ (x >>> 15), x | 1);
	x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
	return (((x ^ (x >>> 14)) >>> 0) / 4294967295) * 2 - 1;
}

function smoothNoise1D(x: number, seed: number): number {
	const i0 = Math.floor(x);
	const i1 = i0 + 1;
	const f = x - i0;

	// Hermite cubic smoothstep
	const u = f * f * (3 - 2 * f);

	const g0 = hash1D(i0, seed);
	const g1 = hash1D(i1, seed);

	const v0 = g0 * f;
	const v1 = g1 * (f - 1);

	// Scaled to roughly [-1, 1]
	return (v0 * (1 - u) + v1 * u) * 2;
}

/**
 * Procedural wiggle generator using multi-octave coherent 1D gradient noise.
 */
export function evaluateWiggle(
	source: {
		frequency?: number;
		amplitude?: number;
		octaves?: number;
		seed?: number;
	},
	tSec: number,
	baseValue = 0,
): number {
	const freq = source.frequency ?? 2.0;
	const amp = source.amplitude ?? 50.0;
	const octaves = Math.max(1, Math.min(4, source.octaves ?? 1));
	const seed = source.seed ?? 1234;

	let total = 0;
	let maxAmp = 0;
	let currentAmp = 1.0;
	let currentFreq = freq;

	for (let i = 0; i < octaves; i++) {
		const noiseVal = smoothNoise1D(tSec * currentFreq, seed + i * 7919);
		total += noiseVal * currentAmp;
		maxAmp += currentAmp;
		currentAmp *= 0.5;
		currentFreq *= 2.0;
	}

	const normalized = maxAmp > 0 ? total / maxAmp : 0;
	return baseValue + normalized * amp;
}

// ── Spring Overshoot ODE Evaluator ────────────────────────────────────

/**
 * Analytical solution to the second-order damped harmonic oscillator ODE:
 *   m*x'' + c*x' + k*x = 0
 */
export function evaluateSpringOvershoot(
	source: {
		damping?: number;
		stiffness?: number;
		mass?: number;
	},
	tSec: number,
	v0: number,
	v1: number,
): number {
	if (tSec <= 0) return v0;

	const m = Math.max(0.001, source.mass ?? 1);
	const k = Math.max(0.001, source.stiffness ?? 180);
	const c = Math.max(0.001, source.damping ?? 12);

	const w0 = Math.sqrt(k / m);
	const zeta = c / (2 * Math.sqrt(k * m));

	let progress = 1;

	if (zeta < 1) {
		// Underdamped (oscillates and overshoots)
		const wd = w0 * Math.sqrt(1 - zeta * zeta);
		const A = -1;
		const B = (-zeta * w0) / wd;
		const x =
			Math.exp(-zeta * w0 * tSec) *
			(A * Math.cos(wd * tSec) + B * Math.sin(wd * tSec));
		progress = 1 + x;
	} else if (Math.abs(zeta - 1) < 1e-4) {
		// Critically damped
		const x = Math.exp(-w0 * tSec) * (-1 - w0 * tSec);
		progress = 1 + x;
	} else {
		// Overdamped
		const sq = Math.sqrt(zeta * zeta - 1);
		const r1 = -w0 * (zeta - sq);
		const r2 = -w0 * (zeta + sq);
		const c1 = -1 / (1 - r1 / r2);
		const c2 = -1 - c1;
		progress = 1 + c1 * Math.exp(r1 * tSec) + c2 * Math.exp(r2 * tSec);
	}

	return v0 + (v1 - v0) * progress;
}

// ── Signal Sampler & Filter ───────────────────────────────────────────

function extractRawSignalSample(
	signalData: SignalDataSource,
	frame: number,
	fps: number,
): number {
	if (signalData === null || signalData === undefined) return 0;

	if (typeof signalData === "number") return signalData;

	if (typeof signalData === "function") {
		return Number(signalData(frame, fps)) || 0;
	}

	// Array of frame samples (e.g. from FFT analysis buffer or AudioSignalExtractor channel)
	if (Array.isArray(signalData) || ArrayBuffer.isView(signalData)) {
		const arr = signalData as ArrayLike<number>;
		if (arr.length === 0) return 0;
		const idx = Math.max(0, Math.min(arr.length - 1, Math.round(frame)));
		return Number(arr[idx]) || 0;
	}

	// Object with frame-indexed samples or channel streams
	if (typeof signalData === "object") {
		const sd = signalData as Record<string, unknown>;
		if (typeof sd.get === "function") {
			return (
				Number(
					(sd.get as (ctx: unknown) => unknown)({
						frame,
						fps,
						time: fps > 0 ? frame / fps : 0,
					}),
				) || 0
			);
		}

		if (sd.type === "Signal" && sd.data) {
			return extractRawSignalSample(sd.data as SignalDataSource, frame, fps);
		}

		// Array of samples inside an object, or audio_extractor descriptor
		const rawSamples =
			sd.samples ??
			(typeof sd.channel === "string" && sd[sd.channel] !== undefined
				? sd[sd.channel]
				: undefined);

		if (Array.isArray(rawSamples) || ArrayBuffer.isView(rawSamples)) {
			const arr = rawSamples as ArrayLike<number>;
			if (arr.length === 0) return 0;
			const srcFps = Number(sd.fps) || 24;
			const compFps = fps > 0 ? fps : 24;
			const t = frame / compFps;
			const idx = Math.max(0, Math.min(arr.length - 1, Math.round(t * srcFps)));
			return Number(arr[idx]) || 0;
		}

		if (sd.type === "audio_extractor" || sd.extractionMode !== undefined) {
			const nodeId = sd.nodeId as string | undefined;
			if (nodeId) {
				const ch = (sd.channel as string) ?? "primary";
				const channelSamples = signalRegistry.getChannelSamples(nodeId, ch);
				if (channelSamples && channelSamples.length > 0) {
					const srcFps = Number(sd.fps) || 24;
					const compFps = fps > 0 ? fps : 24;
					const t = frame / compFps;
					const idx = Math.max(
						0,
						Math.min(channelSamples.length - 1, Math.round(t * srcFps)),
					);
					return Number(channelSamples[idx]) || 0;
				}
			}
			return 0;
		}

		// Generator descriptor (customWGSL, mathematical formula, LFO, etc.)
		if (sd.type === "generator") {
			const amp = typeof sd.amplitude === "number" ? sd.amplitude : 1.0;
			let freq = typeof sd.frequency === "number" ? sd.frequency : 1.0;
			if (sd.syncToBpm && typeof sd.bpm === "number" && sd.bpm > 0) {
				const bars = typeof sd.bars === "number" && sd.bars > 0 ? sd.bars : 1;
				freq = sd.bpm / 60 / bars;
			}
			const phase = typeof sd.phase === "number" ? sd.phase : 0.0;
			const offset = typeof sd.offset === "number" ? sd.offset : 0.0;
			const t = frame / (fps > 0 ? fps : 24);
			const baseType = sd.baseType ?? "sine";

			// FM modulation support
			const fmEnabled = Boolean(sd.fmEnabled);
			let tMod = t;
			if (fmEnabled) {
				const fmAmp = Number(sd.fmAmplitude) || 1.0;
				const fmFreq = Number(sd.fmFrequency) || 0.5;
				tMod = t + Math.sin(t * fmFreq * Math.PI * 2) * fmAmp;
			}

			let val = 0;
			const phaseNorm = (tMod * freq + phase / (Math.PI * 2)) % 1;
			const normT = phaseNorm < 0 ? phaseNorm + 1 : phaseNorm;
			const fract = (x: number) => ((x % 1) + 1) % 1;

			switch (baseType) {
				case "triangle":
					val = 4 * Math.abs(normT - 0.5) - 1;
					break;
				case "sawtooth":
					val = 2 * normT - 1;
					break;
				case "square":
					val = normT < 0.5 ? 1 : -1;
					break;
				case "constant":
					val = 1;
					break;
				case "noise_smooth": {
					const noiseT = tMod * freq + phase;
					const noiseI = Math.floor(noiseT);
					const noiseF = noiseT - noiseI;
					const noiseU = noiseF * noiseF * (3.0 - 2.0 * noiseF);
					const n0 = fract(Math.sin(noiseI * 12.9898) * 43758.5453);
					const n1 = fract(Math.sin((noiseI + 1.0) * 12.9898) * 43758.5453);
					val = (n0 * (1.0 - noiseU) + n1 * noiseU) * 2.0 - 1.0;
					break;
				}
				case "noise_white":
					val =
						fract(Math.sin(tMod * 12.9898 + phase) * 43758.5453) * 2.0 - 1.0;
					break;
				case "pulse": {
					const pulseDuty =
						phase === 0 ? 0.5 : Math.max(0.01, Math.min(0.99, phase));
					val = fract(tMod * freq) < pulseDuty ? 1.0 : -1.0;
					break;
				}
				case "bounce":
					val = Math.abs(Math.sin(tMod * freq * Math.PI + phase));
					break;
				case "staircase":
					val = (Math.floor(normT * 8.0) / 7.0) * 2.0 - 1.0;
					break;
				default:
					val = Math.sin(tMod * freq * Math.PI * 2 + phase);
					break;
			}
			return val * amp + offset;
		}

		// Signal Gate / Trigger node descriptor
		if (sd.type === "gate") {
			const source = (sd.sourceSignal ?? sd.signal) as SignalDataSource;
			const thresh = typeof sd.threshold === "number" ? sd.threshold : 0.5;
			const mode = (sd.mode as string) ?? "gate";
			const invert = Boolean(sd.invert);
			const debounceMs = typeof sd.debounceMs === "number" ? sd.debounceMs : 0;
			const debounceFrames = Math.max(1, Math.round((debounceMs / 1000) * fps));
			const holdFrames = Math.max(1, Number(sd.holdFrames) || 4);

			let output = 0.0;
			if (mode === "gate") {
				const src = extractRawSignalSample(source, frame, fps);
				output = src >= thresh ? 1.0 : 0.0;
			} else if (mode === "trigger") {
				let lastTrigger = -Infinity;
				const startF = Math.max(0, frame - 300);
				for (let f = startF; f <= frame; f++) {
					const val = extractRawSignalSample(source, f, fps);
					const prev = f > 0 ? extractRawSignalSample(source, f - 1, fps) : 0;
					if (
						val >= thresh &&
						prev < thresh &&
						f - lastTrigger >= debounceFrames
					) {
						lastTrigger = f;
					}
				}
				output =
					frame >= lastTrigger && frame < lastTrigger + holdFrames ? 1.0 : 0.0;
			} else if (mode === "toggle") {
				let toggleCount = 0;
				let lastTrigger = -Infinity;
				for (let f = 0; f <= frame; f++) {
					const val = extractRawSignalSample(source, f, fps);
					const prev = f > 0 ? extractRawSignalSample(source, f - 1, fps) : 0;
					if (
						val >= thresh &&
						prev < thresh &&
						f - lastTrigger >= debounceFrames
					) {
						toggleCount++;
						lastTrigger = f;
					}
				}
				output = toggleCount % 2 === 1 ? 1.0 : 0.0;
			}
			return invert ? 1.0 - output : output;
		}

		// Signal Math node descriptor
		if (sd.type === "signal_math") {
			const valA = extractRawSignalSample(
				sd.signalA as SignalDataSource,
				frame,
				fps,
			);
			const hasB = sd.signalB !== undefined;
			const valB = hasB
				? extractRawSignalSample(sd.signalB as SignalDataSource, frame, fps)
				: Number(sd.bValue) || 0.0;

			switch (sd.operation) {
				case "add":
					return valA + valB;
				case "subtract":
					return valA - valB;
				case "multiply":
					return valA * valB;
				case "divide":
					return valB !== 0 ? valA / valB : 0;
				case "min":
					return Math.min(valA, valB);
				case "max":
					return Math.max(valA, valB);
				case "clamp": {
					const cMin = Number(sd.clampMin) || 0;
					const cMax = Number(sd.clampMax) || 1;
					return Math.max(cMin, Math.min(cMax, valA));
				}
				case "abs":
					return Math.abs(valA);
				case "negate":
					return -valA;
				case "invert":
					return 1.0 - valA;
				case "power":
					return valA ** (Number(sd.exponent) || 2);
				case "modulo":
					return valB !== 0 ? valA % valB : 0;
				case "remap": {
					const inMin = Number(sd.inMin) || 0;
					const inMax = Number(sd.inMax) || 1;
					const outMin = Number(sd.outMin) || 0;
					const outMax = Number(sd.outMax) || 1;
					const rangeIn = inMax - inMin;
					const norm = rangeIn !== 0 ? (valA - inMin) / rangeIn : 0;
					return outMin + norm * (outMax - outMin);
				}
				case "normalize": {
					const minVal = Number(sd.aMin ?? sd.inMin) || 0.0;
					const maxVal = Number(sd.aMax ?? sd.inMax) || 1.0;
					const range = maxVal - minVal;
					return range !== 0
						? Math.max(0, Math.min(1, (valA - minVal) / range))
						: 0;
				}
				case "smoothstep": {
					const e0 = Number(sd.edge0) || 0;
					const e1 = Number(sd.edge1) || 1;
					const range = e1 - e0;
					const x =
						range !== 0 ? Math.max(0, Math.min(1, (valA - e0) / range)) : 0;
					return x * x * (3 - 2 * x);
				}
				case "custom":
					return valA;
				default:
					return valA;
			}
		}

		if (typeof sd.value === "number") {
			return sd.value;
		}
	}

	return 0;
}

/**
 * Evaluates an external Signal as an event accumulator / integrator.
 * On each rising edge above `threshold` (with `debounceFrames` guard),
 * the accumulator increments by 1.
 */
export function evaluateSignalAccumulator(
	rawSource: unknown,
	currentFrame: number,
	fps: number,
	threshold = 0.15,
	debounceFrames = 2,
): number {
	if (currentFrame < 0 || !rawSource) return 0;
	const src = rawSource as SignalDataSource;

	let count = 0;
	let lastTriggerFrame = -Infinity;

	for (let f = 0; f <= currentFrame; f++) {
		const val = extractRawSignalSample(src, f, fps);
		const prevVal = f > 0 ? extractRawSignalSample(src, f - 1, fps) : 0;

		// Rising edge crossing the threshold with debounce protection
		if (
			val >= threshold &&
			prevVal < threshold &&
			f - lastTriggerFrame >= debounceFrames
		) {
			count++;
			lastTriggerFrame = f;
		}
	}

	return count;
}

/**
 * Evaluates an external Signal with smoothing window and linear remapping,
 * or as a discrete event accumulator.
 */
export function evaluateSignal(
	source: {
		inputHandleId: string;
		multiplier?: number;
		offset?: number;
		smoothingWindowFrames?: number;
		signalMode?: "continuous" | "accumulate";
		threshold?: number;
		accumulateThreshold?: number;
		debounceFrames?: number;
		channel?: string;
	},
	frame: number,
	fps: number,
	signals: Record<string, SignalDataSource> = {},
): number {
	let rawSource = signals[source.inputHandleId];
	if (rawSource === undefined && signals) {
		const signalKeys = Object.keys(signals);
		if (signalKeys.length === 1) {
			rawSource = signals[signalKeys[0]];
		} else if (signalKeys.length > 1) {
			const matched = signalKeys.find((k) => k === source.inputHandleId);
			rawSource = matched ? signals[matched] : signals[signalKeys[0]];
		}
	}

	if (source.channel && rawSource && typeof rawSource === "object") {
		const candidate = (rawSource as Record<string, unknown>)[source.channel];
		if (candidate !== undefined) {
			rawSource = candidate as SignalDataSource;
		} else if (typeof (rawSource as { get?: unknown }).get !== "function") {
			rawSource = { ...(rawSource as object), channel: source.channel };
		}
	}

	if (source.signalMode === "accumulate") {
		const threshold = source.threshold ?? source.accumulateThreshold ?? 0.15;
		const debounce = source.debounceFrames ?? 2;
		const count = evaluateSignalAccumulator(
			rawSource,
			frame,
			fps,
			threshold,
			debounce,
		);
		const mult = source.multiplier ?? 1.0;
		const off = source.offset ?? 0.0;
		return count * mult + off;
	}

	const multiplier = source.multiplier ?? 1.0;
	const offset = source.offset ?? 0.0;
	const windowFrames = Math.max(
		0,
		Math.round(source.smoothingWindowFrames ?? 0),
	);

	if (windowFrames <= 1) {
		const rawVal = extractRawSignalSample(rawSource, frame, fps);
		return rawVal * multiplier + offset;
	}

	// Moving-average smoothing filter
	let sum = 0;
	let count = 0;
	const startF = Math.max(0, frame - windowFrames + 1);
	for (let f = startF; f <= frame; f++) {
		sum += extractRawSignalSample(rawSource, f, fps);
		count++;
	}

	const avg = count > 0 ? sum / count : 0;
	return avg * multiplier + offset;
}

// ── Keyframe Interpolation ────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function parseHexColor(hex: string): [number, number, number, number] {
	let h = hex.trim().replace("#", "");
	if (h.length === 3) {
		h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	}
	if (h.length === 6) {
		const num = parseInt(h, 16);
		return [(num >> 16) & 255, (num >> 8) & 255, num & 255, 1];
	}
	if (h.length === 8) {
		const num = parseInt(h, 16);
		return [
			(num >> 24) & 255,
			(num >> 16) & 255,
			(num >> 8) & 255,
			(num & 255) / 255,
		];
	}
	return [255, 255, 255, 1];
}

function lerpColor(c1: string, c2: string, t: number): string {
	if (!c1.startsWith("#") || !c2.startsWith("#")) return t < 0.5 ? c1 : c2;
	const [r1, g1, b1, a1] = parseHexColor(c1);
	const [r2, g2, b2, a2] = parseHexColor(c2);
	const r = Math.round(lerp(r1, r2, t));
	const g = Math.round(lerp(g1, g2, t));
	const b = Math.round(lerp(b1, b2, t));
	const a = lerp(a1, a2, t);

	const toHex = (n: number) => n.toString(16).padStart(2, "0");
	if (a >= 0.999) {
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}
	return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
}

function hueToRgb(p: number, q: number, t: number): number {
	let tt = t;
	if (tt < 0) tt += 1;
	if (tt > 1) tt -= 1;
	if (tt < 1 / 6) return p + (q - p) * 6 * tt;
	if (tt < 1 / 2) return q;
	if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
	return p;
}

export function rotateHue(hex: string, delta: number): string {
	const [r255, g255, b255, a] = parseHexColor(hex);
	const r = r255 / 255;
	const g = g255 / 255;
	const b = b255 / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;

	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = (g - b) / d + (g < b ? 6 : 0);
				break;
			case g:
				h = (b - r) / d + 2;
				break;
			case b:
				h = (r - g) / d + 4;
				break;
		}
		h /= 6;
	}

	h = (h + (delta % 1) + 1) % 1;

	let newR = l;
	let newG = l;
	let newB = l;

	if (s !== 0) {
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		newR = hueToRgb(p, q, h + 1 / 3);
		newG = hueToRgb(p, q, h);
		newB = hueToRgb(p, q, h - 1 / 3);
	}

	const toHex = (n: number) =>
		Math.round(Math.max(0, Math.min(255, n * 255)))
			.toString(16)
			.padStart(2, "0");
	if (a >= 0.999) {
		return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
	}
	return `rgba(${Math.round(newR * 255)}, ${Math.round(newG * 255)}, ${Math.round(newB * 255)}, ${Math.round(a * 100) / 100})`;
}

const COLOR_PROPS = new Set([
	"fill",
	"fillColor",
	"strokeColor",
	"textBackgroundColor",
	"color",
]);

/**
 * Standard keyframe track evaluation.
 */
export function evaluateKeyframes(
	track: AnimationTrack,
	localFrame: number,
): number | boolean | string {
	const keyframes = track.keyframes ?? [];
	if (keyframes.length === 0) return 0;
	if (keyframes.length === 1) return keyframes[0].value;

	if (localFrame <= keyframes[0].frame) {
		return keyframes[0].value;
	}
	if (localFrame >= keyframes[keyframes.length - 1].frame) {
		return keyframes[keyframes.length - 1].value;
	}

	for (let i = 0; i < keyframes.length - 1; i++) {
		const kf0 = keyframes[i];
		const kf1 = keyframes[i + 1];

		if (localFrame >= kf0.frame && localFrame <= kf1.frame) {
			const delta = kf1.frame - kf0.frame;
			const t = delta > 0 ? (localFrame - kf0.frame) / delta : 0;

			if (typeof kf0.value === "boolean") {
				return t >= 1 ? kf1.value : kf0.value;
			}

			if (typeof kf0.value === "string" && typeof kf1.value === "string") {
				return lerpColor(kf0.value, kf1.value, t);
			}

			const n0 = Number(kf0.value) || 0;
			const n1 = Number(kf1.value) || 0;
			return lerp(n0, n1, t);
		}
	}

	return keyframes[keyframes.length - 1].value;
}

// ── Master Track Evaluator ────────────────────────────────────────────

/**
 * Evaluates an AnimationTrack at a given global or local frame.
 */
export function evaluateTrackAtFrame(
	track: AnimationTrack,
	frame: number,
	fps = 24,
	context: TrackEvaluationContext = {},
): number | boolean | string {
	const startFrame = context.startFrame ?? 0;
	const localFrame = frame - startFrame;
	const source: TrackSource = track.source ?? { type: "keyframe" };
	const basePropVal = context.baseValues?.[track.prop];

	switch (source.type) {
		case "keyframe":
			return evaluateKeyframes(track, localFrame);

		case "wiggle": {
			const fallbackNum = typeof basePropVal === "number" ? basePropVal : 0;
			const base =
				track.keyframes && track.keyframes.length > 0
					? Number(evaluateKeyframes(track, localFrame)) || 0
					: fallbackNum;
			const tSec = localFrame / (fps > 0 ? fps : 24);
			return evaluateWiggle(source, tSec, base);
		}

		case "springOvershoot": {
			let v0 = 0;
			let v1 = 1;
			if (track.keyframes && track.keyframes.length >= 2) {
				v0 = Number(track.keyframes[0].value) || 0;
				v1 = Number(track.keyframes[1].value) || 1;
			} else if (track.keyframes && track.keyframes.length === 1) {
				v0 = Number(basePropVal) || 0;
				v1 = Number(track.keyframes[0].value) || 0;
			} else if (typeof basePropVal === "number") {
				v0 = basePropVal;
				v1 = basePropVal;
			}
			const tSec = localFrame / (fps > 0 ? fps : 24);
			return evaluateSpringOvershoot(source, tSec, v0, v1);
		}

		case "signal": {
			const sigVal = evaluateSignal(source, frame, fps, context.signals);
			if (COLOR_PROPS.has(track.prop)) {
				const src = source as {
					colorMode?: "interpolate" | "hueRotate" | "threshold";
					colorA?: string;
					colorB?: string;
					colorThreshold?: number;
				};
				const colorA = src.colorA ?? "#ffffff";
				const colorB = src.colorB ?? "#ffffff";
				const mode = src.colorMode ?? "interpolate";
				if (mode === "threshold") {
					const threshold = src.colorThreshold ?? 0.5;
					return sigVal >= threshold ? colorB : colorA;
				}
				if (mode === "hueRotate") {
					return rotateHue(colorA, sigVal);
				}
				// Default interpolate
				const t = Math.max(0, Math.min(1, sigVal));
				return lerpColor(colorA, colorB, t);
			}
			return sigVal;
		}

		default:
			return evaluateKeyframes(track, localFrame);
	}
}

/**
 * Evaluates all animation tracks for a layer at `frame`.
 */
export function evaluateAnimationAtFrame(
	animation: LayerAnimation | undefined,
	frame: number,
	fps = 24,
	context: TrackEvaluationContext = {},
): Record<string, number | boolean | string> {
	const result: Record<string, number | boolean | string> = {};
	if (!animation?.tracks) return result;

	for (const track of animation.tracks) {
		result[track.prop] = evaluateTrackAtFrame(track, frame, fps, context);
	}

	return result;
}
