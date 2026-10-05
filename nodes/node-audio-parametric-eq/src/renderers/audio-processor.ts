import type { AudioProcessor } from "@framefields/node-sdk";
import { WebGPUAudioProcessor } from "@framefields/webgpu-renderers";
import type { ParametricEqNodeConfig } from "../shared";

const PARAM_ORDER = ["frequency", "gain", "q"];

const PARAMETRIC_EQ_SHADER_TEMPLATE = () => `
struct Uniforms {
    sampleRate      : f32,
    numBands        : f32,
    frequency       : f32,
    gain            : f32,
    q               : f32,
    bandType        : f32,
    hasFrequencySig : f32,
    hasGainSig      : f32,
    hasQSig         : f32,
    baseTime        : f32,
    frame           : f32,
    numSamples      : f32,
    numChannels     : f32,
    pad1            : f32,
    pad2            : f32,
    pad3            : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> inputChannels : array<f32>;
@group(0) @binding(2) var<storage, read_write> outputChannels : array<f32>;
@group(0) @binding(3) var<storage, read_write> state : array<f32>;
@group(0) @binding(4) var<storage, read> frequencySignal : array<f32>;
@group(0) @binding(5) var<storage, read> gainSignal      : array<f32>;
@group(0) @binding(6) var<storage, read> qSignal         : array<f32>;

const PI: f32 = 3.141592653589793f;

fn tanh(x: f32) -> f32 {
    let exp2x = exp(2.0f * x);
    return (exp2x - 1.0f) / (exp2x + 1.0f);
}

fn is_nan_or_inf(v: f32) -> bool {
    return (v != v) || (abs(v) > 3.402823466e+38f);
}

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    if (gid.x != 0u) { return; }

    let numSamples = u32(u.numSamples);
    let numChannels = u32(u.numChannels);
    let sampleRate = u.sampleRate;
    let bandType = u.bandType; // 0=peak, 1=lowShelf, 2=highShelf, 3=lowPass, 4=highPass, 5=notch

    let biquadStateOffset = 4u;

    for (var c = 0u; c < numChannels; c = c + 1u) {
        let offset = biquadStateOffset + c * 4u;
        var x1 = state[offset];
        var x2 = state[offset + 1u];
        var y1 = state[offset + 2u];
        var y2 = state[offset + 3u];

        if (is_nan_or_inf(x1)) { x1 = 0.0f; }
        if (is_nan_or_inf(x2)) { x2 = 0.0f; }
        if (is_nan_or_inf(y1)) { y1 = 0.0f; }
        if (is_nan_or_inf(y2)) { y2 = 0.0f; }

        for (var index = 0u; index < numSamples; index = index + 1u) {
            let sampleIndex = c * numSamples + index;
            var x = inputChannels[sampleIndex];
            if (is_nan_or_inf(x)) { x = 0.0f; }

            // 1. Dynamic Parameter Signal Resolution & Clamping
            var effFreq = u.frequency;
            if (u.hasFrequencySig > 0.5f) {
                effFreq = frequencySignal[index];
            }
            effFreq = clamp(effFreq, 20.0f, sampleRate / 2.0f - 1.0f);

            var effQ = u.q;
            if (u.hasQSig > 0.5f) {
                effQ = qSignal[index];
            }
            effQ = clamp(effQ, 0.01f, 10.0f);

            var effGain = u.gain;
            if (u.hasGainSig > 0.5f) {
                effGain = gainSignal[index];
            }
            effGain = clamp(effGain, -24.0f, 24.0f);

            if (bandType == 0.0f && abs(effGain) < 1e-5f) {
                // Bypass filter if peak gain is zero
                outputChannels[sampleIndex] = x;
                continue;
            }

            // 2. Biquad Coefficients Calculation
            let w0 = (2.0f * PI * effFreq) / sampleRate;
            let cos_w0 = cos(w0);
            let sin_w0 = sin(w0);
            let A = clamp(pow(10.0f, effGain / 40.0f), 0.25f, 4.0f);
            let alpha = sin_w0 / (2.0f * effQ);

            var b0 = 0.0f; var b1 = 0.0f; var b2 = 0.0f;
            var a0 = 0.0f; var a1 = 0.0f; var a2 = 0.0f;

            if (bandType == 0.0f) { // peak
                b0 = 1.0f + alpha * A;
                b1 = -2.0f * cos_w0;
                b2 = 1.0f - alpha * A;
                a0 = 1.0f + alpha / A;
                a1 = -2.0f * cos_w0;
                a2 = 1.0f - alpha / A;
            } else if (bandType == 1.0f) { // lowShelf
                let sqrtA = sqrt(A);
                let twoSqrtAAlpha = 2.0f * sqrtA * alpha;
                b0 = A * (A + 1.0f - (A - 1.0f) * cos_w0 + twoSqrtAAlpha);
                b1 = 2.0f * A * (A - 1.0f - (A + 1.0f) * cos_w0);
                b2 = A * (A + 1.0f - (A - 1.0f) * cos_w0 - twoSqrtAAlpha);
                a0 = A + 1.0f + (A - 1.0f) * cos_w0 + twoSqrtAAlpha;
                a1 = -2.0f * (A - 1.0f + (A + 1.0f) * cos_w0);
                a2 = A + 1.0f + (A - 1.0f) * cos_w0 - twoSqrtAAlpha;
            } else if (bandType == 2.0f) { // highShelf
                let sqrtA = sqrt(A);
                let twoSqrtAAlpha = 2.0f * sqrtA * alpha;
                b0 = A * (A + 1.0f + (A - 1.0f) * cos_w0 + twoSqrtAAlpha);
                b1 = -2.0f * A * (A - 1.0f + (A + 1.0f) * cos_w0);
                b2 = A * (A + 1.0f + (A - 1.0f) * cos_w0 - twoSqrtAAlpha);
                a0 = A + 1.0f - (A - 1.0f) * cos_w0 + twoSqrtAAlpha;
                a1 = 2.0f * (A - 1.0f - (A + 1.0f) * cos_w0);
                a2 = A + 1.0f - (A - 1.0f) * cos_w0 - twoSqrtAAlpha;
            } else if (bandType == 3.0f) { // lowPass
                b0 = (1.0f - cos_w0) / 2.0f;
                b1 = 1.0f - cos_w0;
                b2 = (1.0f - cos_w0) / 2.0f;
                a0 = 1.0f + alpha;
                a1 = -2.0f * cos_w0;
                a2 = 1.0f - alpha;
            } else if (bandType == 4.0f) { // highPass
                b0 = (1.0f + cos_w0) / 2.0f;
                b1 = -(1.0f + cos_w0);
                b2 = (1.0f + cos_w0) / 2.0f;
                a0 = 1.0f + alpha;
                a1 = -2.0f * cos_w0;
                a2 = 1.0f - alpha;
            } else if (bandType == 5.0f) { // notch
                b0 = 1.0f;
                b1 = -2.0f * cos_w0;
                b2 = 1.0f;
                a0 = 1.0f + alpha;
                a1 = -2.0f * cos_w0;
                a2 = 1.0f - alpha;
            }

            if (abs(a0) < 1e-9f) {
                outputChannels[sampleIndex] = x;
                continue;
            }

            let b0_norm = b0 / a0;
            let b1_norm = b1 / a0;
            let b2_norm = b2 / a0;
            let a1_norm = a1 / a0;
            let a2_norm = a2 / a0;

            var y = b0_norm * x + b1_norm * x1 + b2_norm * x2 - a1_norm * y1 - a2_norm * y2;
            if (is_nan_or_inf(y)) { y = 0.0f; }

            // Biquad State History Update with Soft Anti-Explosion Clamping
            x2 = x1;
            x1 = x;
            y2 = clamp(y1, -4.0f, 4.0f);
            y1 = clamp(y, -4.0f, 4.0f);

            // Output Soft Clipping
            if (y > 1.0f) {
                y = 1.0f;
            } else if (y < -1.0f) {
                y = -1.0f;
            } else if (y > 0.9f) {
                y = 0.9f + 0.1f * tanh((y - 0.9f) / 0.1f);
            } else if (y < -0.9f) {
                y = -0.9f + 0.1f * tanh((y + 0.9f) / 0.1f);
            }

            outputChannels[sampleIndex] = y;
        }

        state[offset] = x1;
        state[offset + 1u] = x2;
        state[offset + 2u] = y1;
        state[offset + 3u] = y2;
    }
}
`;

const getBandTypeVal = (type: string): number => {
	if (type === "peak") return 0.0;
	if (type === "lowShelf") return 1.0;
	if (type === "highShelf") return 2.0;
	if (type === "lowPass") return 3.0;
	if (type === "highPass") return 4.0;
	if (type === "notch") return 5.0;
	return 0.0;
};

export const parametricEqAudioProcessor: AudioProcessor = async (
	channels,
	sampleRate,
	virtualMedia,
	ctx,
) => {
	if (!ctx?.device) {
		throw new Error("GPUDevice is required for WebGPU Parametric EQ.");
	}

	const op = (virtualMedia.operation as Record<string, unknown>) || {};
	const inputs = (op.inputs as Record<string, any>) || {};

	const config: ParametricEqNodeConfig = {
		type: (typeof op.type === "string" &&
		["lowShelf", "highShelf", "peak", "lowPass", "highPass", "notch"].includes(
			op.type,
		)
			? op.type
			: "peak") as ParametricEqNodeConfig["type"],
		frequency: typeof op.frequency === "number" ? op.frequency : 1000,
		frequencyHandleId:
			typeof op.frequencyHandleId === "string" ? op.frequencyHandleId : null,
		gain: typeof op.gain === "number" ? op.gain : 0,
		gainHandleId: typeof op.gainHandleId === "string" ? op.gainHandleId : null,
		q: typeof op.q === "number" ? op.q : 1.0,
		qHandleId: typeof op.qHandleId === "string" ? op.qHandleId : null,
	};

	const isHandleConnected = (handleIdKey: string): boolean => {
		const handleId = op[handleIdKey];
		if (typeof handleId !== "string" || !handleId) return false;
		const input = inputs[handleId];
		return Boolean(
			input?.connectionValid &&
				input.outputItem &&
				(input.outputItem.type === "Signal" ||
					input.outputItem.type === "Number"),
		);
	};

	const hasFrequencySig = isHandleConnected("frequencyHandleId") ? 1.0 : 0.0;
	const hasGainSig = isHandleConnected("gainHandleId") ? 1.0 : 0.0;
	const hasQSig = isHandleConnected("qHandleId") ? 1.0 : 0.0;

	const numChannels = channels.length;
	if (numChannels === 0) return;
	const numSamples = channels[0].length;
	if (numSamples === 0) return;

	// 100% WebGPU Compute Path
	const nodeId = (op.id as string) || "audio-parametric-eq";
	const frame = ctx.frame ?? 0;
	const fps = ctx.fps ?? 24;

	// Total state buffer includes config header (4 floats) + biquad history states (numChannels * 4 floats)
	const stateFloatCount = 4 + numChannels * 4;

	await WebGPUAudioProcessor.process(
		ctx.device,
		nodeId,
		channels,
		sampleRate,
		virtualMedia,
		frame,
		fps,
		PARAMETRIC_EQ_SHADER_TEMPLATE,
		() => [
			sampleRate,
			1.0, // numBands = 1
			config.frequency,
			config.gain,
			config.q,
			getBandTypeVal(config.type),
			hasFrequencySig,
			hasGainSig,
			hasQSig,
			0.0, // baseTime
			frame,
			numSamples,
			numChannels,
			0, // pad1
			0, // pad2
			0, // pad3
		],
		16, // Aligned to 16 bytes (16 * 4 = 64 bytes)
		stateFloatCount,
		ctx?.renderId,
		true,
		ctx?.elapsedMs,
		ctx?.durationMs,
		undefined,
		undefined,
		PARAM_ORDER,
	);
};
export const clearParametricEqStateAndProcessor = () => {};
