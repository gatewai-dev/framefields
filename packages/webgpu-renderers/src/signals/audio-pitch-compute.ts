/// <reference types="webgpu" />

import { downmixToMono } from "./audio-signal-compute.js";

/**
 * Fundamental-frequency (f0) tracking: YIN period candidates on the GPU, then
 * a Viterbi decode on the CPU (in the spirit of pYIN) that keeps the track
 * continuous across octave errors and marks frames with no clear period as
 * unvoiced.
 */
export interface AudioPitchTrackConfig {
	/** Lowest pitch to search, in Hz. The longest period must fit in `MAX_PITCH_LAG` samples. */
	minHz?: number;
	/** Highest pitch to search, in Hz. */
	maxHz?: number;
	/** Analysis window per frame, in milliseconds. Never shorter than the longest period. */
	windowMs?: number;
	/** YIN dip depth (0..1) above which a frame is treated as unvoiced. Higher accepts noisier sources. */
	voicingThreshold?: number;
	/** Cost per octave of pitch change between neighboring frames. Higher gives a smoother track. */
	octaveJumpCost?: number;
}

export interface AudioPitchTrack {
	/** Pitch in Hz per frame; unvoiced gaps are interpolated between voiced neighbors. */
	hz: Float32Array;
	/** 1 minus the YIN dip depth of the chosen period, 0 on unvoiced frames. */
	confidence: Float32Array;
	/** 1 where a period was measured, 0 where `hz` is interpolated. */
	voiced: Float32Array;
	numFrames: number;
	durationSec: number;
}

/** Period candidates as `[lagSamples, yinValue]` pairs, `PITCH_CANDIDATES` per frame. */
export interface PitchCandidates {
	data: Float32Array;
	numFrames: number;
	sampleRate: number;
}

export const MAX_PITCH_LAG = 2048;
export const PITCH_CANDIDATES = 8;
const EMPTY_CANDIDATE = 2;
/** Cost of switching between voiced and unvoiced from one frame to the next. */
const VOICING_SWITCH_COST = 0.6;
/** Extra cost of a dip that echoes a shorter candidate's period. */
const SUBHARMONIC_COST = 0.5;
/** How many times shallower the shorter dip may be and still explain a longer one. */
const SUBHARMONIC_DEPTH_RATIO = 1.25;
/** Relative lag error allowed when matching a period multiple. */
const PERIOD_MULTIPLE_TOLERANCE = 0.03;
/** Relative lag distance under which two local minima are one noisy dip. */
const RIPPLE_MERGE = 0.03;
const WORKGROUP_SIZE = 128;
const MAX_GRID_X = 65535;

export const AUDIO_PITCH_CANDIDATES_SHADER = `
struct PitchUniforms {
    sampleRate : f32,
    numSamples : u32,
    numFrames  : u32,
    windowSize : u32,
    lagMin     : u32,
    lagMax     : u32,
    gridX      : u32,
    fps        : f32,
};

const K : u32 = ${PITCH_CANDIDATES}u;
const WG : u32 = ${WORKGROUP_SIZE}u;
const EMPTY : f32 = ${EMPTY_CANDIDATE}.0f;
const MERGE : f32 = ${RIPPLE_MERGE}f;

@group(0) @binding(0) var<uniform> u : PitchUniforms;
@group(0) @binding(1) var<storage, read> pcm : array<f32>;
@group(0) @binding(2) var<storage, read_write> candidates : array<vec2f>;

var<workgroup> yin : array<f32, ${MAX_PITCH_LAG + 1}>;

fn sampleAt(i : u32) -> f32 {
    if (i >= u.numSamples) { return 0.0f; }
    return pcm[i];
}

// Keeps the K deepest dips sorted by value, shallowest last. A dip within
// MERGE of an existing candidate's lag is the same broad dip: only the
// deeper of the two survives.
fn insertCandidate(lags : ptr<function, array<f32, K>>, vals : ptr<function, array<f32, K>>, lag : f32, val : f32) {
    var slot = K - 1u;
    for (var k = 0u; k < K; k = k + 1u) {
        if ((*vals)[k] < EMPTY && abs((*lags)[k] - lag) <= MERGE * lag) {
            if ((*vals)[k] <= val) { return; }
            slot = k;
            break;
        }
    }
    if ((*vals)[slot] <= val) { return; }
    var i = slot;
    loop {
        if (i == 0u || (*vals)[i - 1u] <= val) { break; }
        (*vals)[i] = (*vals)[i - 1u];
        (*lags)[i] = (*lags)[i - 1u];
        i = i - 1u;
    }
    (*vals)[i] = val;
    (*lags)[i] = lag;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(workgroup_id) wid : vec3<u32>, @builtin(local_invocation_index) lid : u32) {
    let frame = wid.x + wid.y * u.gridX;
    if (frame >= u.numFrames) { return; }

    // Center the analysed span (window + longest lag) on the frame time.
    let span = u.windowSize + u.lagMax;
    let center = i32(round(f32(frame) * u.sampleRate / u.fps));
    let maxStart = max(i32(u.numSamples) - i32(span), 0);
    let start = u32(clamp(center - i32(span / 2u), 0, maxStart));

    // YIN difference function, one lag per invocation per stride.
    for (var tau = lid; tau <= u.lagMax; tau = tau + WG) {
        var acc = 0.0f;
        for (var j = 0u; j < u.windowSize; j = j + 1u) {
            let d = sampleAt(start + j) - sampleAt(start + j + tau);
            acc = acc + d * d;
        }
        yin[tau] = acc;
    }
    workgroupBarrier();
    if (lid != 0u) { return; }

    // Cumulative mean normalized difference, in place.
    var running = 0.0f;
    yin[0] = 1.0f;
    for (var tau = 1u; tau <= u.lagMax; tau = tau + 1u) {
        running = running + yin[tau];
        yin[tau] = select(1.0f, yin[tau] * f32(tau) / running, running > 0.0f);
    }

    var lags : array<f32, K>;
    var vals : array<f32, K>;
    for (var k = 0u; k < K; k = k + 1u) {
        lags[k] = 0.0f;
        vals[k] = EMPTY;
    }
    for (var tau = max(u.lagMin, 1u); tau < u.lagMax; tau = tau + 1u) {
        let prev = yin[tau - 1u];
        let cur = yin[tau];
        let next = yin[tau + 1u];
        if (cur < prev && cur <= next) {
            // Parabolic interpolation of the dip for sub-sample period.
            let den = prev - 2.0f * cur + next;
            let offset = select(0.0f, 0.5f * (prev - next) / den, den > 0.0f);
            insertCandidate(&lags, &vals, f32(tau) + offset, cur);
        }
    }

    let base = frame * K;
    for (var k = 0u; k < K; k = k + 1u) {
        candidates[base + k] = vec2f(lags[k], vals[k]);
    }
}
`;

interface ResolvedPitchConfig {
	lagMin: number;
	lagMax: number;
	windowSize: number;
	voicingThreshold: number;
	octaveJumpCost: number;
}

function resolvePitchConfig(
	sampleRate: number,
	config: AudioPitchTrackConfig,
): ResolvedPitchConfig {
	const minHz = config.minHz ?? 50;
	const maxHz = config.maxHz ?? 1000;
	if (!(minHz > 0 && maxHz > minHz)) {
		throw new Error(
			`Pitch range needs 0 < minHz < maxHz (got ${minHz}..${maxHz}).`,
		);
	}
	const lagMax = Math.ceil(sampleRate / minHz) + 1;
	if (lagMax > MAX_PITCH_LAG) {
		throw new Error(
			`minHz ${minHz} needs a ${lagMax}-sample period at ${sampleRate} Hz; the limit is ${MAX_PITCH_LAG} (minHz >= ${Math.ceil(sampleRate / (MAX_PITCH_LAG - 1))}).`,
		);
	}
	const lagMin = Math.max(2, Math.floor(sampleRate / maxHz));
	const windowMs = config.windowMs ?? 45;
	return {
		lagMin,
		lagMax,
		windowSize: Math.max(lagMax, Math.round((windowMs / 1000) * sampleRate)),
		voicingThreshold: config.voicingThreshold ?? 0.8,
		octaveJumpCost: config.octaveJumpCost ?? 8,
	};
}

function transitionCost(
	prevLag: number,
	lag: number,
	octaveJumpCost: number,
): number {
	const prevVoiced = prevLag > 0;
	const voiced = lag > 0;
	if (prevVoiced !== voiced) return VOICING_SWITCH_COST;
	if (!voiced) return 0;
	return octaveJumpCost * Math.abs(Math.log2(lag / prevLag));
}

/**
 * True when `lag` is an integer multiple (2x, 3x, ...) of a shorter candidate
 * that is about as deep. YIN's normalized difference dips at every multiple
 * of the true period, often slightly deeper, so such a dip is an echo.
 */
function isPeriodMultiple(
	data: Float32Array,
	base: number,
	lag: number,
	depth: number,
): boolean {
	for (let j = 0; j < PITCH_CANDIDATES; j++) {
		const shorter = data[(base + j) * 2];
		const shorterDepth = data[(base + j) * 2 + 1];
		if (shorterDepth >= EMPTY_CANDIDATE || shorter <= 0 || shorter >= lag)
			continue;
		const m = Math.round(lag / shorter);
		if (
			m >= 2 &&
			Math.abs(lag - m * shorter) <= PERIOD_MULTIPLE_TOLERANCE * lag &&
			shorterDepth <= depth * SUBHARMONIC_DEPTH_RATIO
		) {
			return true;
		}
	}
	return false;
}

/**
 * Writes each state's lag and emission cost for frame `f`. A candidate costs
 * its YIN dip depth, plus `SUBHARMONIC_COST` when it is a period multiple;
 * the unvoiced state (index K, lag 0) costs the voicing threshold.
 */
function observeFrame(
	data: Float32Array,
	f: number,
	voicingThreshold: number,
	lags: Float64Array,
	costs: Float64Array,
): void {
	const K = PITCH_CANDIDATES;
	const base = f * K;
	const row = f * (K + 1);
	for (let k = 0; k < K; k++) {
		const lag = data[(base + k) * 2];
		const depth = data[(base + k) * 2 + 1];
		const valid = depth < EMPTY_CANDIDATE && lag > 0;
		lags[row + k] = valid ? lag : 0;
		costs[row + k] = !valid
			? Number.POSITIVE_INFINITY
			: depth +
				(isPeriodMultiple(data, base, lag, depth) ? SUBHARMONIC_COST : 0);
	}
	lags[row + K] = 0;
	costs[row + K] = voicingThreshold;
}

/** Most likely state per frame given per-state lags and -log emission costs. */
function viterbi(
	lags: Float64Array,
	costs: Float64Array,
	numFrames: number,
	octaveJumpCost: number,
): Uint8Array {
	const S = PITCH_CANDIDATES + 1;
	const back = new Uint8Array(numFrames * S);
	let total = costs.slice(0, S);
	for (let f = 1; f < numFrames; f++) {
		const next = new Float64Array(S);
		for (let s = 0; s < S; s++) {
			let best = Number.POSITIVE_INFINITY;
			for (let p = 0; p < S; p++) {
				const c =
					total[p] +
					transitionCost(
						lags[(f - 1) * S + p],
						lags[f * S + s],
						octaveJumpCost,
					);
				if (c < best) {
					best = c;
					back[f * S + s] = p;
				}
			}
			next[s] = best + costs[f * S + s];
		}
		total = next;
	}
	const path = new Uint8Array(numFrames);
	let state = total.indexOf(Math.min(...total));
	for (let f = numFrames - 1; f >= 0; f--) {
		path[f] = state;
		state = back[f * S + state];
	}
	return path;
}

/**
 * Viterbi decode over each frame's period candidates plus one unvoiced state,
 * emissions from `observeFrame`, transitions costing `octaveJumpCost` per
 * octave and a fixed voicing switch.
 */
export function decodePitchTrack(
	candidates: PitchCandidates,
	config: Pick<AudioPitchTrackConfig, "voicingThreshold" | "octaveJumpCost">,
): Omit<AudioPitchTrack, "durationSec"> {
	const { data, numFrames, sampleRate } = candidates;
	const K = PITCH_CANDIDATES;
	const S = K + 1;
	const lags = new Float64Array(numFrames * S);
	const costs = new Float64Array(numFrames * S);
	for (let f = 0; f < numFrames; f++) {
		observeFrame(data, f, config.voicingThreshold ?? 0.8, lags, costs);
	}
	const path = viterbi(lags, costs, numFrames, config.octaveJumpCost ?? 8);

	const hz = new Float32Array(numFrames);
	const confidence = new Float32Array(numFrames);
	const voiced = new Float32Array(numFrames);
	for (let f = 0; f < numFrames; f++) {
		const s = path[f];
		if (lags[f * S + s] === 0) continue;
		hz[f] = sampleRate / lags[f * S + s];
		confidence[f] = Math.min(1, Math.max(0, 1 - data[(f * K + s) * 2 + 1]));
		voiced[f] = 1;
	}
	fillUnvoiced(hz, voiced);
	return { hz, confidence, voiced, numFrames };
}

/** Linearly interpolates `hz` across unvoiced runs; holds the nearest voiced value at the ends. */
function fillUnvoiced(hz: Float32Array, voiced: Float32Array): void {
	let prev = -1;
	for (let f = 0; f <= hz.length; f++) {
		if (f < hz.length && voiced[f] === 0) continue;
		const from = prev >= 0 ? hz[prev] : f < hz.length ? hz[f] : 0;
		const to = f < hz.length ? hz[f] : from;
		for (let g = prev + 1; g < f; g++) {
			const t = prev >= 0 && f < hz.length ? (g - prev) / (f - prev) : 0;
			hz[g] = from + (to - from) * t;
		}
		prev = f;
	}
}

const pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();

function getPipeline(device: GPUDevice): GPUComputePipeline {
	let pipeline = pipelines.get(device);
	if (!pipeline) {
		pipeline = device.createComputePipeline({
			label: "AudioPitchCandidatesPipeline",
			layout: "auto",
			compute: {
				module: device.createShaderModule({
					label: "AudioPitchCandidatesPipeline.wgsl",
					code: AUDIO_PITCH_CANDIDATES_SHADER,
				}),
				entryPoint: "main",
			},
		});
		pipelines.set(device, pipeline);
	}
	return pipeline;
}

/** Runs the YIN candidate pass on the GPU: `PITCH_CANDIDATES` periods per frame. */
export async function extractPitchCandidates(
	device: GPUDevice,
	audioChannels: Float32Array[],
	sampleRate: number,
	fps: number,
	config: AudioPitchTrackConfig = {},
): Promise<PitchCandidates> {
	if (audioChannels.length === 0 || audioChannels[0].length === 0) {
		throw new Error("Empty audio buffer supplied to the pitch tracker.");
	}
	const { lagMin, lagMax, windowSize } = resolvePitchConfig(sampleRate, config);
	const mono = downmixToMono(audioChannels);
	const numFrames = Math.max(1, Math.ceil((mono.length / sampleRate) * fps));
	const gridX = Math.min(numFrames, MAX_GRID_X);
	const outBytes = numFrames * PITCH_CANDIDATES * 2 * 4;

	const uniforms = new ArrayBuffer(8 * 4);
	const f32 = new Float32Array(uniforms);
	const u32 = new Uint32Array(uniforms);
	f32[0] = sampleRate;
	u32[1] = mono.length;
	u32[2] = numFrames;
	u32[3] = windowSize;
	u32[4] = lagMin;
	u32[5] = lagMax;
	u32[6] = gridX;
	f32[7] = fps;

	const uniformBuffer = device.createBuffer({
		size: uniforms.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		label: "audio_pitch_uniforms",
	});
	device.queue.writeBuffer(uniformBuffer, 0, uniforms);
	const pcmBuffer = device.createBuffer({
		size: mono.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		label: "audio_pitch_pcm",
	});
	device.queue.writeBuffer(
		pcmBuffer,
		0,
		mono as unknown as GPUAllowSharedBufferSource,
	);
	const candidateBuffer = device.createBuffer({
		size: outBytes,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
		label: "audio_pitch_candidates",
	});
	const readback = device.createBuffer({
		size: outBytes,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		label: "audio_pitch_candidates_readback",
	});

	const pipeline = getPipeline(device);
	const encoder = device.createCommandEncoder({
		label: "audio_pitch_encoder",
	});
	const pass = encoder.beginComputePass({
		label: "audio_pitch_candidates_pass",
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(
		0,
		device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: pcmBuffer } },
				{ binding: 2, resource: { buffer: candidateBuffer } },
			],
		}),
	);
	pass.dispatchWorkgroups(gridX, Math.ceil(numFrames / gridX));
	pass.end();
	encoder.copyBufferToBuffer(candidateBuffer, 0, readback, 0, outBytes);
	device.queue.submit([encoder.finish()]);

	await readback.mapAsync(GPUMapMode.READ);
	const data = new Float32Array(readback.getMappedRange().slice(0));
	readback.unmap();
	for (const b of [readback, candidateBuffer, pcmBuffer, uniformBuffer]) {
		b.destroy();
	}
	return { data, numFrames, sampleRate };
}

/** Tracks the fundamental frequency of the downmixed channels at `fps` frames per second. */
export async function trackAudioPitch(
	device: GPUDevice,
	audioChannels: Float32Array[],
	sampleRate: number,
	fps: number,
	config: AudioPitchTrackConfig = {},
): Promise<AudioPitchTrack> {
	const candidates = await extractPitchCandidates(
		device,
		audioChannels,
		sampleRate,
		fps,
		config,
	);
	return {
		...decodePitchTrack(candidates, config),
		durationSec: audioChannels[0].length / sampleRate,
	};
}
