import {
	type AudioProcessor,
	resolveNumber,
	resolveString,
} from "@framefields/node-sdk";
import { WebGPUAudioProcessor } from "@framefields/webgpu-renderers";

const PARAM_ORDER = ["fadeInDuration", "fadeOutDuration"];

const FADE_SHADER_TEMPLATE = () => `
struct Uniforms {
    sampleRate            : f32,
    fadeInDuration        : f32,
    fadeOutDuration       : f32,
    fadeInCurve           : f32,
    fadeOutCurve          : f32,
    clipDuration          : f32,
    hasFadeInDurationSig  : f32,
    hasFadeOutDurationSig : f32,
    baseTime              : f32,
    frame                 : f32,
    numSamples            : f32,
    numChannels           : f32,
    pad1                  : f32,
    pad2                  : f32,
    pad3                  : f32,
    pad4                  : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> inputChannels : array<f32>;
@group(0) @binding(2) var<storage, read_write> outputChannels : array<f32>;
@group(0) @binding(3) var<storage, read_write> state : array<f32>; // state[0] = samplesProcessed
@group(0) @binding(4) var<storage, read> fadeInDurationSignal  : array<f32>;
@group(0) @binding(5) var<storage, read> fadeOutDurationSignal : array<f32>;

fn applyCurve(p: f32, curve: f32) -> f32 {
    let clampedP = max(0.0f, min(p, 1.0f));
    if (curve == 1.0f) { // exponential
        return clampedP * clampedP;
    }
    if (curve == 2.0f) { // scurve
        return clampedP * clampedP * (3.0f - 2.0f * clampedP);
    }
    return clampedP; // linear
}

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

    for (var index = 0u; index < numSamples; index = index + 1u) {
        let t = u.baseTime + f32(index) / u.sampleRate;
        var gain = 1.0f;

        var effFadeIn = u.fadeInDuration;
        if (u.hasFadeInDurationSig > 0.5f) {
            effFadeIn = fadeInDurationSignal[index];
        }
        effFadeIn = clamp(effFadeIn, 0.0f, 60.0f);

        var effFadeOut = u.fadeOutDuration;
        if (u.hasFadeOutDurationSig > 0.5f) {
            effFadeOut = fadeOutDurationSignal[index];
        }
        effFadeOut = clamp(effFadeOut, 0.0f, 60.0f);

        if (effFadeIn > 0.0f && t < effFadeIn) {
            let p = t / effFadeIn;
            gain = gain * applyCurve(p, u.fadeInCurve);
        }

        if (effFadeOut > 0.0f && t > u.clipDuration - effFadeOut) {
            let p = (u.clipDuration - t) / effFadeOut;
            gain = gain * applyCurve(p, u.fadeOutCurve);
        }

        gain = clamp(gain, 0.0f, 1.0f);

        for (var c = 0u; c < numChannels; c = c + 1u) {
            let sampleIndex = c * numSamples + index;
            var inVal = inputChannels[sampleIndex];
            if (is_nan_or_inf(inVal)) {
                inVal = 0.0f;
            }

            var outVal = inVal * gain;
            if (is_nan_or_inf(outVal)) {
                outVal = 0.0f;
            }

            if (outVal > 1.0f) {
                outVal = 1.0f;
            } else if (outVal < -1.0f) {
                outVal = -1.0f;
            } else if (outVal > 0.9f) {
                outVal = 0.9f + 0.1f * tanh((outVal - 0.9f) / 0.1f);
            } else if (outVal < -0.9f) {
                outVal = -0.9f + 0.1f * tanh((outVal + 0.9f) / 0.1f);
            }

            outputChannels[sampleIndex] = outVal;
        }
    }

    // Dummy reference to keep state binding active
    state[0] = state[0];
}
`;

const getCurveCode = (curve: string): number => {
	if (curve === "exponential") return 1.0;
	if (curve === "scurve") return 2.0;
	return 0.0; // linear
};

export const fadeAudioProcessor: AudioProcessor = async (
	channels,
	sampleRate,
	virtualMedia,
	ctx,
) => {
	if (!ctx?.device) {
		throw new Error("GPUDevice is required for WebGPU Audio Fade.");
	}

	const op = (virtualMedia.operation as Record<string, unknown>) || {};
	const inputs =
		(op.inputs as Record<
			string,
			{ connectionValid?: boolean; outputItem?: { type?: string } }
		>) || {};

	const numChannels = channels.length;
	if (numChannels === 0) return;
	const numSamples = channels[0].length;
	if (numSamples === 0) return;

	// Extract parameters
	const fadeInDuration = Math.max(0.0, resolveNumber(op.fadeInDuration, 0.0));
	const fadeOutDuration = Math.max(0.0, resolveNumber(op.fadeOutDuration, 0.0));
	const fadeInCurve = resolveString(op.fadeInCurve, "linear");
	const fadeOutCurve = resolveString(op.fadeOutCurve, "linear");

	// Get duration
	const durationMs = virtualMedia.metadata?.durationMs ?? 0;
	const clipDuration = durationMs / 1000;

	// Clamp durations so they share the midpoint if they overlap
	let fadeIn = fadeInDuration;
	let fadeOut = fadeOutDuration;
	if (fadeIn + fadeOut > clipDuration) {
		const half = clipDuration / 2;
		fadeIn = Math.min(fadeIn, half);
		fadeOut = Math.min(fadeOut, half);
	}

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

	const hasFadeInDurationSig = isHandleConnected("fadeInDurationHandleId")
		? 1.0
		: 0.0;
	const hasFadeOutDurationSig = isHandleConnected("fadeOutDurationHandleId")
		? 1.0
		: 0.0;

	// 100% WebGPU Compute Path
	const nodeId = (op.id as string) || "audio-fade";
	const frame = ctx.frame ?? 0;
	const fps = ctx.fps ?? 24;

	await WebGPUAudioProcessor.process(
		ctx.device,
		nodeId,
		channels,
		sampleRate,
		virtualMedia,
		frame,
		fps,
		FADE_SHADER_TEMPLATE,
		(chunkTimeSec) => {
			const startFrame =
				typeof op.startFrame === "number" ? op.startFrame : frame;
			const localTimeSec =
				ctx.elapsedMs !== undefined
					? ctx.elapsedMs / 1000 + (chunkTimeSec - frame / fps)
					: Math.max(0, chunkTimeSec - startFrame / fps);
			return [
				sampleRate,
				fadeIn,
				fadeOut,
				getCurveCode(fadeInCurve),
				getCurveCode(fadeOutCurve),
				clipDuration,
				hasFadeInDurationSig,
				hasFadeOutDurationSig,
				localTimeSec, // baseTime (local to clip start!)
				frame,
				numSamples,
				numChannels,
				0, // pad1
				0, // pad2
				0, // pad3
				0, // pad4
			];
		},
		16, // Aligned to 16 bytes (16 * 4 = 64 bytes)
		1, // stateFloatCount: 1 (state[0] = samplesProcessed)
		ctx?.renderId,
		true,
		ctx?.elapsedMs,
		ctx?.durationMs,
		undefined,
		undefined,
		PARAM_ORDER,
	);
};
