/// <reference types="webgpu" />

export interface AudioSignalComputeConfig {
	extractionMode?:
		| "rms_envelope"
		| "transient_beat"
		| "sub_bass"
		| "bass"
		| "mid"
		| "high"
		| "spectral_flux";
	attackMs?: number;
	releaseMs?: number;
	sensitivity?: number;
	noiseFloorDb?: number;
	dynamicRangeDb?: number;
	autoRange?: boolean;
	smoothing?: number;
	curve?: "linear" | "exponential" | "logarithmic" | "square" | "smoothstep";
	beatThreshold?: number;
	beatDecayMs?: number;
}

export interface ExtractedSignalStats {
	primary: { min: number; max: number };
	beat: { min: number; max: number };
	bass: { min: number; max: number };
	energy: { min: number; max: number };
}

export interface ExtractedAudioSignals {
	primaryBuffer: GPUBuffer;
	beatBuffer: GPUBuffer;
	bassBuffer: GPUBuffer;
	energyBuffer: GPUBuffer;
	texture: GPUTexture;
	textureView: GPUTextureView;
	numFrames: number;
	durationSec: number;
	stats: ExtractedSignalStats;
	channelSamples?: {
		primary: Float32Array;
		beat: Float32Array;
		bass: Float32Array;
		energy: Float32Array;
	};
}

// ---------------------------------------------------------------------------
// WGSL Compute Shaders
// ---------------------------------------------------------------------------

/**
 * 1. Biquad IIR Filter Bank Compute Shader
 * Applies resonant bandpass/lowpass/highpass filtering on PCM audio buffer.
 */
export const AUDIO_BIQUAD_FILTER_SHADER = `
struct BiquadUniforms {
    b0 : f32,
    b1 : f32,
    b2 : f32,
    a1 : f32,
    a2 : f32,
    numSamples : u32,
    pad1 : f32,
    pad2 : f32,
};

@group(0) @binding(0) var<uniform> u : BiquadUniforms;
@group(0) @binding(1) var<storage, read> inAudio : array<f32>;
@group(0) @binding(2) var<storage, read_write> outAudio : array<f32>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    if (gid.x != 0u) { return; }

    var x1 = 0.0f;
    var x2 = 0.0f;
    var y1 = 0.0f;
    var y2 = 0.0f;

    let total = u.numSamples;
    for (var i = 0u; i < total; i = i + 1u) {
        let x0 = inAudio[i];
        let y0 = u.b0 * x0 + u.b1 * x1 + u.b2 * x2 - u.a1 * y1 - u.a2 * y2;

        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;

        outAudio[i] = y0;
    }
}
`;

/**
 * 2. Windowed RMS, Peak Envelope & Spectral Flux Extraction Compute Shader
 */
export const AUDIO_FEATURE_EXTRACTION_SHADER = `
struct FeatureUniforms {
    sampleRate     : f32,
    numSamples     : u32,
    numFrames      : u32,
    hopSize        : u32,
    windowSize     : u32,
    attackAlpha    : f32,
    releaseAlpha   : f32,
    sensitivity    : f32,
    noiseFloorDb   : f32,
    dynamicRangeDb : f32,
    curveType      : u32, // 0=linear, 1=exp, 2=log, 3=sqr, 4=smoothstep
    beatThreshold  : f32,
    beatDecayAlpha : f32,
    extractionMode : u32, // 0=rms, 1=beat, 2=bass, 3=energy, etc.
    pad0           : f32,
    pad1           : f32,
};

@group(0) @binding(0) var<uniform> u : FeatureUniforms;
@group(0) @binding(1) var<storage, read> rawAudio : array<f32>;
@group(0) @binding(2) var<storage, read> bassAudio : array<f32>;
@group(0) @binding(3) var<storage, read_write> outPrimary : array<f32>;
@group(0) @binding(4) var<storage, read_write> outBeat    : array<f32>;
@group(0) @binding(5) var<storage, read_write> outBass    : array<f32>;
@group(0) @binding(6) var<storage, read_write> outEnergy  : array<f32>;
@group(0) @binding(7) var<storage, read_write> outStats   : array<f32>;

fn applyCurve(v: f32, curve: u32) -> f32 {
    let cv = clamp(v, 0.0f, 1.0f);
    if (curve == 1u) { // Exponential
        return cv * cv;
    }
    if (curve == 2u) { // Logarithmic
        return log(1.0f + 9.0f * cv) / log(10.0f);
    }
    if (curve == 3u) { // Square
        return cv * cv * cv;
    }
    if (curve == 4u) { // Smoothstep
        return cv * cv * (3.0f - 2.0f * cv);
    }
    return cv; // Linear
}

fn scaleDbToNormalized(rms: f32) -> f32 {
    let eps = 1e-6f;
    let safeRms = max(rms * u.sensitivity, eps);
    let db = 20.0f * log(safeRms) / log(10.0f);
    let minDb = u.noiseFloorDb;
    let maxDb = u.noiseFloorDb + u.dynamicRangeDb;
    let norm = clamp((db - minDb) / (maxDb - minDb), 0.0f, 1.0f);
    return norm;
}

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    if (gid.x != 0u) { return; }

    var envFollower = 0.0f;
    var bassFollower = 0.0f;
    var prevBassEnergy = 0.0f;
    var beatEnvelope = 0.0f;

    let numFrames = u.numFrames;
    let numSamples = u.numSamples;
    let halfWin = u.windowSize / 2u;

    var minEnergy = 1e6f;
    var maxEnergy = -1e6f;
    var minBass = 1e6f;
    var maxBass = -1e6f;
    var minBeat = 1e6f;
    var maxBeat = -1e6f;
    var minPrimary = 1e6f;
    var maxPrimary = -1e6f;

    for (var f = 0u; f < numFrames; f = f + 1u) {
        let centerSample = f * u.hopSize;
        let startSample = select(0u, centerSample - halfWin, centerSample >= halfWin);
        let endSample = min(numSamples, centerSample + halfWin);

        var sumSq = 0.0f;
        var sumBassSq = 0.0f;
        var count = 0.0f;

        for (var s = startSample; s < endSample; s = s + 1u) {
            let val = rawAudio[s];
            let bVal = bassAudio[s];
            sumSq = sumSq + val * val;
            sumBassSq = sumBassSq + bVal * bVal;
            count = count + 1.0f;
        }

        let effectiveCount = max(count, 1.0f);
        let rms = sqrt(sumSq / effectiveCount);
        let bassRms = sqrt(sumBassSq / effectiveCount);

        let normRms = scaleDbToNormalized(rms);
        let normBass = scaleDbToNormalized(bassRms);

        // Ballistics envelope follower (Attack / Release)
        let alpha = select(u.releaseAlpha, u.attackAlpha, normRms > envFollower);
        envFollower = envFollower + alpha * (normRms - envFollower);

        let bassAlpha = select(u.releaseAlpha, u.attackAlpha, normBass > bassFollower);
        bassFollower = bassFollower + bassAlpha * (normBass - bassFollower);

        // Spectral flux / Onset detection on bass energy
        let flux = max(0.0f, bassFollower - prevBassEnergy);
        prevBassEnergy = bassFollower;

        // Beat pulse triggering and exponential decay
        beatEnvelope = beatEnvelope * u.beatDecayAlpha;
        if (flux > u.beatThreshold) {
            let hit = clamp((flux - u.beatThreshold) / max(0.01f, 0.15f - u.beatThreshold), 0.6f, 1.0f);
            beatEnvelope = max(beatEnvelope, hit);
        }

        let finalEnergy = applyCurve(envFollower, u.curveType);
        let finalBass = applyCurve(bassFollower, u.curveType);
        let finalBeat = applyCurve(beatEnvelope, u.curveType);

        var finalPrimary = finalEnergy;
        if (u.extractionMode == 1u) { // transient_beat
            finalPrimary = finalBeat;
        } else if (u.extractionMode == 2u || u.extractionMode == 3u) { // sub_bass or bass
            finalPrimary = finalBass;
        }

        minEnergy = min(minEnergy, finalEnergy);
        maxEnergy = max(maxEnergy, finalEnergy);
        minBass = min(minBass, finalBass);
        maxBass = max(maxBass, finalBass);
        minBeat = min(minBeat, finalBeat);
        maxBeat = max(maxBeat, finalBeat);
        minPrimary = min(minPrimary, finalPrimary);
        maxPrimary = max(maxPrimary, finalPrimary);

        outPrimary[f] = finalPrimary;
        outBeat[f] = finalBeat;
        outBass[f] = finalBass;
        outEnergy[f] = finalEnergy;
    }

    if (numFrames > 0u) {
        outStats[0] = minPrimary;
        outStats[1] = select(maxPrimary, minPrimary + 1.0f, maxPrimary <= minPrimary + 1e-5f);
        outStats[2] = minBeat;
        outStats[3] = select(maxBeat, minBeat + 1.0f, maxBeat <= minBeat + 1e-5f);
        outStats[4] = minBass;
        outStats[5] = select(maxBass, minBass + 1.0f, maxBass <= minBass + 1e-5f);
        outStats[6] = minEnergy;
        outStats[7] = select(maxEnergy, minEnergy + 1.0f, maxEnergy <= minEnergy + 1e-5f);
    } else {
        outStats[0] = 0.0f;
        outStats[1] = 1.0f;
        outStats[2] = 0.0f;
        outStats[3] = 1.0f;
        outStats[4] = 0.0f;
        outStats[5] = 1.0f;
        outStats[6] = 0.0f;
        outStats[7] = 1.0f;
    }
}
`;

/**
 * 3. 2D / 1D Texture Pack Shader
 * Copies the 4 extracted signals (Primary, Beat, Bass, Energy) into an RGBA32F texture for UV shader sampling.
 */
export const AUDIO_SIGNAL_TO_TEXTURE_SHADER = `
struct TexturePackUniforms {
    numFrames : u32,
    texWidth  : u32,
    pad1      : f32,
    pad2      : f32,
};

@group(0) @binding(0) var<uniform> u : TexturePackUniforms;
@group(0) @binding(1) var<storage, read> inPrimary : array<f32>;
@group(0) @binding(2) var<storage, read> inBeat    : array<f32>;
@group(0) @binding(3) var<storage, read> inBass    : array<f32>;
@group(0) @binding(4) var<storage, read> inEnergy  : array<f32>;
@group(0) @binding(5) var outTex : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let x = gid.x;
    if (x >= u.texWidth) { return; }

    let progress = f32(x) / f32(u.texWidth - 1u);
    let frameFloat = progress * f32(u.numFrames - 1u);
    let f0 = u32(clamp(floor(frameFloat), 0.0f, f32(u.numFrames - 1u)));
    let f1 = u32(clamp(ceil(frameFloat), 0.0f, f32(u.numFrames - 1u)));
    let weight = fract(frameFloat);

    let prim = mix(inPrimary[f0], inPrimary[f1], weight);
    let beat = mix(inBeat[f0], inBeat[f1], weight);
    let bass = mix(inBass[f0], inBass[f1], weight);
    let nrg  = mix(inEnergy[f0], inEnergy[f1], weight);

    textureStore(outTex, vec2<i32>(i32(x), 0), vec4<f32>(prim, beat, bass, nrg));
}
`;

/**
 * 4. Pace / Speed Ramping Prefix-Sum Time Integral Shader
 * Integrates pace = baseSpeed + gain * signal(t) over time into a monotonic timestamp lookup buffer.
 */
export const AUDIO_PACE_INTEGRAL_SHADER = `
struct PaceUniforms {
    baseSpeed  : f32,
    gain       : f32,
    dt         : f32,
    numFrames  : u32,
};

@group(0) @binding(0) var<uniform> u : PaceUniforms;
@group(0) @binding(1) var<storage, read> inSignal : array<f32>;
@group(0) @binding(2) var<storage, read_write> outSourceTimestamps : array<f32>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    if (gid.x != 0u) { return; }

    var accumulatedTime = 0.0f;
    let total = u.numFrames;

    for (var f = 0u; f < total; f = f + 1u) {
        let sig = inSignal[f];
        let instantaneousSpeed = max(0.01f, u.baseSpeed + u.gain * sig);
        accumulatedTime = accumulatedTime + instantaneousSpeed * u.dt;
        outSourceTimestamps[f] = accumulatedTime;
    }
}
`;

// ---------------------------------------------------------------------------
// Audio Signal Compute Engine Class
// ---------------------------------------------------------------------------

function calculateBiquadBandpassCoeffs(
	sampleRate: number,
	centerFreq: number,
	Q: number,
): { b0: number; b1: number; b2: number; a1: number; a2: number } {
	const w0 = (2 * Math.PI * centerFreq) / sampleRate;
	const alpha = Math.sin(w0) / (2 * Q);
	const cosW0 = Math.cos(w0);

	const b0 = alpha;
	const b1 = 0;
	const b2 = -alpha;
	const a0 = 1 + alpha;
	const a1 = -2 * cosW0;
	const a2 = 1 - alpha;

	return {
		b0: b0 / a0,
		b1: b1 / a0,
		b2: b2 / a0,
		a1: a1 / a0,
		a2: a2 / a0,
	};
}

const getCurveTypeCode = (curve?: string): number => {
	switch (curve) {
		case "exponential":
			return 1;
		case "logarithmic":
			return 2;
		case "square":
			return 3;
		case "smoothstep":
			return 4;
		case "linear":
		default:
			return 0;
	}
};

const getExtractionModeCode = (mode?: string): number => {
	switch (mode) {
		case "transient_beat":
			return 1;
		case "sub_bass":
			return 2;
		case "bass":
			return 3;
		case "mid":
			return 4;
		case "high":
			return 5;
		case "spectral_flux":
			return 6;
		case "rms_envelope":
		default:
			return 0;
	}
};

export class AudioSignalComputePipeline {
	private static pipelineCache = new WeakMap<
		GPUDevice,
		Map<string, GPUComputePipeline>
	>();

	private static getPipeline(
		device: GPUDevice,
		label: string,
		code: string,
	): GPUComputePipeline {
		let map = AudioSignalComputePipeline.pipelineCache.get(device);
		if (!map) {
			map = new Map();
			AudioSignalComputePipeline.pipelineCache.set(device, map);
		}
		let pipeline = map.get(label);
		if (!pipeline) {
			const module = device.createShaderModule({
				label: `${label}.wgsl`,
				code,
			});
			pipeline = device.createComputePipeline({
				label,
				layout: "auto",
				compute: { module, entryPoint: "main" },
			});
			map.set(label, pipeline);
		}
		return pipeline;
	}

	/**
	 * Processes raw PCM audio channels on the GPU and outputs extracted feature buffers and textures.
	 */
	public static async extractFeatures(
		device: GPUDevice,
		audioChannels: Float32Array[],
		sampleRate: number,
		fps: number,
		config: AudioSignalComputeConfig = {},
		targetWidth = 512,
	): Promise<ExtractedAudioSignals> {
		const numChannels = audioChannels.length;
		if (numChannels === 0 || audioChannels[0].length === 0) {
			throw new Error(
				"Empty audio buffer supplied to AudioSignalComputePipeline.",
			);
		}

		const numAudioSamples = audioChannels[0].length;
		const durationSec = numAudioSamples / sampleRate;
		const numFrames = Math.max(1, Math.ceil(durationSec * fps));
		const hopSize = Math.max(1, Math.round(sampleRate / fps));
		const windowSize = Math.max(32, Math.round(hopSize * 2));

		// Downmix channels to mono on CPU for storage buffer upload
		const monoPcm = new Float32Array(numAudioSamples);
		for (let c = 0; c < numChannels; c++) {
			const ch = audioChannels[c];
			for (let i = 0; i < numAudioSamples; i++) {
				monoPcm[i] += ch[i] / numChannels;
			}
		}

		// 1. Allocate GPU Buffers
		const rawAudioBuffer = device.createBuffer({
			size: numAudioSamples * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			label: "audio_raw_pcm_buffer",
		});
		device.queue.writeBuffer(
			rawAudioBuffer,
			0,
			monoPcm as unknown as GPUAllowSharedBufferSource,
		);

		const bassAudioBuffer = device.createBuffer({
			size: numAudioSamples * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			label: "audio_bass_filtered_buffer",
		});

		const primaryBuffer = device.createBuffer({
			size: numFrames * 4,
			usage:
				GPUBufferUsage.STORAGE |
				GPUBufferUsage.COPY_SRC |
				GPUBufferUsage.COPY_DST,
			label: "audio_primary_signal_buffer",
		});

		const beatBuffer = device.createBuffer({
			size: numFrames * 4,
			usage:
				GPUBufferUsage.STORAGE |
				GPUBufferUsage.COPY_SRC |
				GPUBufferUsage.COPY_DST,
			label: "audio_beat_signal_buffer",
		});

		const bassBuffer = device.createBuffer({
			size: numFrames * 4,
			usage:
				GPUBufferUsage.STORAGE |
				GPUBufferUsage.COPY_SRC |
				GPUBufferUsage.COPY_DST,
			label: "audio_bass_signal_buffer",
		});

		const energyBuffer = device.createBuffer({
			size: numFrames * 4,
			usage:
				GPUBufferUsage.STORAGE |
				GPUBufferUsage.COPY_SRC |
				GPUBufferUsage.COPY_DST,
			label: "audio_energy_signal_buffer",
		});

		// 2. Pass 1: Biquad Bandpass Filter for Bass (60-250Hz)
		const biquadPipeline = AudioSignalComputePipeline.getPipeline(
			device,
			"AudioBiquadFilterPipeline",
			AUDIO_BIQUAD_FILTER_SHADER,
		);

		const bassCoeffs = calculateBiquadBandpassCoeffs(sampleRate, 120, 1.2);
		const biquadUniformsData = new Float32Array([
			bassCoeffs.b0,
			bassCoeffs.b1,
			bassCoeffs.b2,
			bassCoeffs.a1,
			bassCoeffs.a2,
			0, // numSamples will be cast to u32
			0,
			0,
		]);
		new Uint32Array(biquadUniformsData.buffer)[5] = numAudioSamples;

		const biquadUniformBuffer = device.createBuffer({
			size: biquadUniformsData.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "audio_biquad_uniform_buffer",
		});
		device.queue.writeBuffer(
			biquadUniformBuffer,
			0,
			biquadUniformsData as unknown as GPUAllowSharedBufferSource,
		);

		const biquadBindGroup = device.createBindGroup({
			layout: biquadPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: biquadUniformBuffer } },
				{ binding: 1, resource: { buffer: rawAudioBuffer } },
				{ binding: 2, resource: { buffer: bassAudioBuffer } },
			],
		});

		// 3. Pass 2: Feature Extraction (RMS, Attack/Release, Beat Detection)
		const featurePipeline = AudioSignalComputePipeline.getPipeline(
			device,
			"AudioFeatureExtractionPipeline",
			AUDIO_FEATURE_EXTRACTION_SHADER,
		);

		const attackMs = config.attackMs ?? 10;
		const releaseMs = config.releaseMs ?? 120;
		const attackAlpha = 1 - Math.exp(-1 / ((attackMs / 1000) * fps));
		const releaseAlpha = 1 - Math.exp(-1 / ((releaseMs / 1000) * fps));
		const beatDecayMs = config.beatDecayMs ?? 80;
		const beatDecayAlpha = Math.exp(-1 / ((beatDecayMs / 1000) * fps));

		const noiseFloorDb = config.noiseFloorDb ?? -48;
		const dynamicRangeDb = config.dynamicRangeDb ?? 48;

		const featureUniformsBuffer = new ArrayBuffer(16 * 4);
		const featureF32 = new Float32Array(featureUniformsBuffer);
		const featureU32 = new Uint32Array(featureUniformsBuffer);

		featureF32[0] = sampleRate;
		featureU32[1] = numAudioSamples;
		featureU32[2] = numFrames;
		featureU32[3] = hopSize;
		featureU32[4] = windowSize;
		featureF32[5] = attackAlpha;
		featureF32[6] = releaseAlpha;
		featureF32[7] = config.sensitivity ?? 1.0;
		featureF32[8] = noiseFloorDb;
		featureF32[9] = dynamicRangeDb;
		featureU32[10] = getCurveTypeCode(config.curve);
		featureF32[11] = config.beatThreshold ?? 0.08;
		featureF32[12] = beatDecayAlpha;
		featureU32[13] = getExtractionModeCode(config.extractionMode);
		featureF32[14] = 0.0; // pad0
		featureF32[15] = 0.0; // pad1

		const featUniformBuffer = device.createBuffer({
			size: featureUniformsBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "audio_feature_uniform_buffer",
		});
		device.queue.writeBuffer(
			featUniformBuffer,
			0,
			featureUniformsBuffer as unknown as GPUAllowSharedBufferSource,
		);

		const statsBuffer = device.createBuffer({
			size: 8 * 4,
			usage:
				GPUBufferUsage.STORAGE |
				GPUBufferUsage.COPY_SRC |
				GPUBufferUsage.COPY_DST,
			label: "audio_feature_stats_buffer",
		});

		const statsReadBuffer = device.createBuffer({
			size: 8 * 4,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			label: "audio_feature_stats_read_buffer",
		});

		const featureBindGroup = device.createBindGroup({
			layout: featurePipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: featUniformBuffer } },
				{ binding: 1, resource: { buffer: rawAudioBuffer } },
				{ binding: 2, resource: { buffer: bassAudioBuffer } },
				{ binding: 3, resource: { buffer: primaryBuffer } },
				{ binding: 4, resource: { buffer: beatBuffer } },
				{ binding: 5, resource: { buffer: bassBuffer } },
				{ binding: 6, resource: { buffer: energyBuffer } },
				{ binding: 7, resource: { buffer: statsBuffer } },
			],
		});

		// 4. Pass 3: Pack into 2D/1D Texture
		const textureWidth = Math.max(targetWidth, 128);
		const signalTexture = device.createTexture({
			size: [textureWidth, 1, 1],
			format: "rgba16float",
			usage:
				GPUTextureUsage.STORAGE_BINDING |
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_DST,
			label: "audio_extracted_signal_texture",
		});

		const packPipeline = AudioSignalComputePipeline.getPipeline(
			device,
			"AudioTexturePackPipeline",
			AUDIO_SIGNAL_TO_TEXTURE_SHADER,
		);

		const packUniforms = new Uint32Array([numFrames, textureWidth, 0, 0]);
		const packUniformBuffer = device.createBuffer({
			size: packUniforms.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "audio_pack_uniform_buffer",
		});
		device.queue.writeBuffer(
			packUniformBuffer,
			0,
			packUniforms as unknown as GPUAllowSharedBufferSource,
		);

		const packBindGroup = device.createBindGroup({
			layout: packPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: packUniformBuffer } },
				{ binding: 1, resource: { buffer: primaryBuffer } },
				{ binding: 2, resource: { buffer: beatBuffer } },
				{ binding: 3, resource: { buffer: bassBuffer } },
				{ binding: 4, resource: { buffer: energyBuffer } },
				{ binding: 5, resource: signalTexture.createView() },
			],
		});

		// 5. Execute Command Encoder
		const encoder = device.createCommandEncoder({
			label: "audio_signal_extractor_encoder",
		});

		// Compute Pass 1: Biquad Filter
		const pass1 = encoder.beginComputePass({ label: "audio_biquad_pass" });
		pass1.setPipeline(biquadPipeline);
		pass1.setBindGroup(0, biquadBindGroup);
		pass1.dispatchWorkgroups(1);
		pass1.end();

		// Compute Pass 2: Feature Extraction
		const pass2 = encoder.beginComputePass({ label: "audio_feature_pass" });
		pass2.setPipeline(featurePipeline);
		pass2.setBindGroup(0, featureBindGroup);
		pass2.dispatchWorkgroups(1);
		pass2.end();

		encoder.copyBufferToBuffer(statsBuffer, 0, statsReadBuffer, 0, 8 * 4);

		const readbackPrimary = device.createBuffer({
			size: numFrames * 4,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			label: "audio_primary_readback",
		});
		const readbackBeat = device.createBuffer({
			size: numFrames * 4,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			label: "audio_beat_readback",
		});
		const readbackBass = device.createBuffer({
			size: numFrames * 4,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			label: "audio_bass_readback",
		});
		const readbackEnergy = device.createBuffer({
			size: numFrames * 4,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			label: "audio_energy_readback",
		});

		encoder.copyBufferToBuffer(
			primaryBuffer,
			0,
			readbackPrimary,
			0,
			numFrames * 4,
		);
		encoder.copyBufferToBuffer(beatBuffer, 0, readbackBeat, 0, numFrames * 4);
		encoder.copyBufferToBuffer(bassBuffer, 0, readbackBass, 0, numFrames * 4);
		encoder.copyBufferToBuffer(
			energyBuffer,
			0,
			readbackEnergy,
			0,
			numFrames * 4,
		);

		// Compute Pass 3: Texture Packing
		const pass3 = encoder.beginComputePass({ label: "audio_pack_pass" });
		pass3.setPipeline(packPipeline);
		pass3.setBindGroup(0, packBindGroup);
		pass3.dispatchWorkgroups(Math.ceil(textureWidth / 64));
		pass3.end();

		device.queue.submit([encoder.finish()]);

		// Read back calculation min and max stats and channel samples
		await Promise.all([
			statsReadBuffer.mapAsync(GPUMapMode.READ),
			readbackPrimary.mapAsync(GPUMapMode.READ),
			readbackBeat.mapAsync(GPUMapMode.READ),
			readbackBass.mapAsync(GPUMapMode.READ),
			readbackEnergy.mapAsync(GPUMapMode.READ),
		]);

		const statsArray = new Float32Array(
			statsReadBuffer.getMappedRange().slice(0),
		);
		const channelSamples = {
			primary: new Float32Array(readbackPrimary.getMappedRange().slice(0)),
			beat: new Float32Array(readbackBeat.getMappedRange().slice(0)),
			bass: new Float32Array(readbackBass.getMappedRange().slice(0)),
			energy: new Float32Array(readbackEnergy.getMappedRange().slice(0)),
		};

		statsReadBuffer.unmap();
		statsReadBuffer.destroy();
		statsBuffer.destroy();

		readbackPrimary.unmap();
		readbackPrimary.destroy();
		readbackBeat.unmap();
		readbackBeat.destroy();
		readbackBass.unmap();
		readbackBass.destroy();
		readbackEnergy.unmap();
		readbackEnergy.destroy();

		const stats: ExtractedSignalStats = {
			primary: { min: statsArray[0], max: statsArray[1] },
			beat: { min: statsArray[2], max: statsArray[3] },
			bass: { min: statsArray[4], max: statsArray[5] },
			energy: { min: statsArray[6], max: statsArray[7] },
		};

		// Cleanup intermediate uniform/temp buffers
		biquadUniformBuffer.destroy();
		featUniformBuffer.destroy();
		packUniformBuffer.destroy();
		rawAudioBuffer.destroy();
		bassAudioBuffer.destroy();

		return {
			primaryBuffer,
			beatBuffer,
			bassBuffer,
			energyBuffer,
			texture: signalTexture,
			textureView: signalTexture.createView(),
			numFrames,
			durationSec,
			stats,
			channelSamples,
		};
	}

	/**
	 * Computes cumulative speed-ramped presentation timestamps for video pace control.
	 */
	public static computePaceTimestamps(
		device: GPUDevice,
		signalBuffer: GPUBuffer,
		numFrames: number,
		fps: number,
		baseSpeed = 1.0,
		gain = 1.0,
	): GPUBuffer {
		const outBuffer = device.createBuffer({
			size: numFrames * 4,
			usage:
				GPUBufferUsage.STORAGE |
				GPUBufferUsage.COPY_SRC |
				GPUBufferUsage.COPY_DST,
			label: "audio_pace_timestamps_buffer",
		});

		const pacePipeline = AudioSignalComputePipeline.getPipeline(
			device,
			"AudioPaceIntegralPipeline",
			AUDIO_PACE_INTEGRAL_SHADER,
		);

		const dt = 1 / fps;
		const uniformsData = new Float32Array([baseSpeed, gain, dt, 0]);
		new Uint32Array(uniformsData.buffer)[3] = numFrames;

		const uniformBuffer = device.createBuffer({
			size: uniformsData.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "audio_pace_uniform_buffer",
		});
		device.queue.writeBuffer(
			uniformBuffer,
			0,
			uniformsData as unknown as GPUAllowSharedBufferSource,
		);

		const bindGroup = device.createBindGroup({
			layout: pacePipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: signalBuffer } },
				{ binding: 2, resource: { buffer: outBuffer } },
			],
		});

		const encoder = device.createCommandEncoder({
			label: "audio_pace_integral_encoder",
		});
		const pass = encoder.beginComputePass({ label: "audio_pace_pass" });
		pass.setPipeline(pacePipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(1);
		pass.end();

		device.queue.submit([encoder.finish()]);
		uniformBuffer.destroy();

		return outBuffer;
	}
}
