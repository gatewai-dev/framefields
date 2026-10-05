import type { AudioProcessor } from "@framefields/node-sdk";
import { WebGPUAudioProcessor } from "@framefields/webgpu-renderers";

const PARAM_ORDER = ["delayTime", "feedback", "wet", "dry"];

const DELAY_SHADER_TEMPLATE = () => `
struct Uniforms {
    sampleRate       : f32,
    delaySec         : f32,
    feedback         : f32,
    wet              : f32,
    dry              : f32,
    pingPong         : f32,
    bufferLength     : f32,
    hasDelayTimeSig  : f32,
    hasFeedbackSig   : f32,
    hasWetSig        : f32,
    hasDrySig        : f32,
    baseTime         : f32,
    frame            : f32,
    numSamples       : f32,
    numChannels      : f32,
    pad1             : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> inputChannels : array<f32>;
@group(0) @binding(2) var<storage, read_write> outputChannels : array<f32>;
@group(0) @binding(3) var<storage, read_write> state : array<f32>;
@group(0) @binding(4) var<storage, read> delayTimeSignal : array<f32>;
@group(0) @binding(5) var<storage, read> feedbackSignal  : array<f32>;
@group(0) @binding(6) var<storage, read> wetSignal       : array<f32>;
@group(0) @binding(7) var<storage, read> drySignal       : array<f32>;

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
    let bufferLength = u32(u.bufferLength);

    var writeIndex = u32(state[0]);
    if (is_nan_or_inf(state[0])) {
        writeIndex = 0u;
    }

    for (var index = 0u; index < numSamples; index = index + 1u) {
        // 1. Dynamic Parameter Modulation & Anti-Explosion Clamping
        var effDelaySec = u.delaySec;
        if (u.hasDelayTimeSig > 0.5f) {
            effDelaySec = delayTimeSignal[index];
        }
        effDelaySec = clamp(effDelaySec, 0.001f, 5.0f);

        var effFeedback = u.feedback;
        if (u.hasFeedbackSig > 0.5f) {
            effFeedback = feedbackSignal[index];
        }
        effFeedback = clamp(effFeedback, 0.0f, 0.95f);

        var effWet = u.wet;
        if (u.hasWetSig > 0.5f) {
            effWet = wetSignal[index];
        }
        effWet = clamp(effWet, 0.0f, 2.0f);

        var effDry = u.dry;
        if (u.hasDrySig > 0.5f) {
            effDry = drySignal[index];
        }
        effDry = clamp(effDry, 0.0f, 2.0f);

        // 2. Safe Dynamic Read Index
        let readOffset = u32(clamp(effDelaySec * u.sampleRate, 1.0f, f32(bufferLength - 1u)));
        let readIndex = (writeIndex + bufferLength - readOffset) % bufferLength;

        if (numChannels == 1u || u.pingPong == 0.0f) {
            // Standard Delay
            for (var c = 0u; c < numChannels; c = c + 1u) {
                let sampleIndex = c * numSamples + index;
                var inputVal = inputChannels[sampleIndex];
                if (is_nan_or_inf(inputVal)) {
                    inputVal = 0.0f;
                }

                let stateOffset = c * bufferLength + 1u;
                var delayedSample = state[stateOffset + readIndex];
                if (is_nan_or_inf(delayedSample)) {
                    delayedSample = 0.0f;
                }

                var nextStateVal = inputVal + delayedSample * effFeedback;
                if (is_nan_or_inf(nextStateVal)) {
                    nextStateVal = 0.0f;
                }
                state[stateOffset + writeIndex] = clamp(nextStateVal, -4.0f, 4.0f);

                var outVal = effDry * inputVal + effWet * delayedSample;
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
        } else {
            // Stereo Ping-Pong Delay
            var sampleL = inputChannels[index];
            if (is_nan_or_inf(sampleL)) { sampleL = 0.0f; }

            var sampleR = inputChannels[numSamples + index];
            if (is_nan_or_inf(sampleR)) { sampleR = 0.0f; }

            var delayedL = state[1u + readIndex];
            if (is_nan_or_inf(delayedL)) { delayedL = 0.0f; }

            var delayedR = state[bufferLength + 1u + readIndex];
            if (is_nan_or_inf(delayedR)) { delayedR = 0.0f; }

            // Ping-pong cross-feedback
            var nextL = sampleL + delayedR * effFeedback;
            var nextR = sampleR + delayedL * effFeedback;
            if (is_nan_or_inf(nextL)) { nextL = 0.0f; }
            if (is_nan_or_inf(nextR)) { nextR = 0.0f; }

            state[1u + writeIndex] = clamp(nextL, -4.0f, 4.0f);
            state[bufferLength + 1u + writeIndex] = clamp(nextR, -4.0f, 4.0f);

            var outL = effDry * sampleL + effWet * delayedL;
            var outR = effDry * sampleR + effWet * delayedR;
            if (is_nan_or_inf(outL)) { outL = 0.0f; }
            if (is_nan_or_inf(outR)) { outR = 0.0f; }

            if (outL > 1.0f) { outL = 1.0f; } else if (outL < -1.0f) { outL = -1.0f; }
            else if (outL > 0.9f) { outL = 0.9f + 0.1f * tanh((outL - 0.9f) / 0.1f); }
            else if (outL < -0.9f) { outL = -0.9f + 0.1f * tanh((outL + 0.9f) / 0.1f); }

            if (outR > 1.0f) { outR = 1.0f; } else if (outR < -1.0f) { outR = -1.0f; }
            else if (outR > 0.9f) { outR = 0.9f + 0.1f * tanh((outR - 0.9f) / 0.1f); }
            else if (outR < -0.9f) { outR = -0.9f + 0.1f * tanh((outR + 0.9f) / 0.1f); }

            outputChannels[index] = outL;
            outputChannels[numSamples + index] = outR;
        }

        writeIndex = (writeIndex + 1u) % bufferLength;
    }

    state[0] = f32(writeIndex);
}
`;

export const delayAudioProcessor: AudioProcessor = async (
	channels,
	sampleRate,
	virtualMedia,
	ctx,
) => {
	if (!ctx?.device) {
		throw new Error("GPUDevice is required for WebGPU Audio Delay.");
	}

	const op = (virtualMedia.operation as Record<string, unknown>) || {};
	const inputs = (op.inputs as Record<string, any>) || {};

	const numChannels = channels.length;
	if (numChannels === 0) return;
	const numSamples = channels[0].length;
	if (numSamples === 0) return;

	// Clamp and extract parameters
	const delaySec = Math.max(
		0.001,
		Math.min(typeof op.delayTime === "number" ? op.delayTime : 0.25, 5.0),
	);
	const feedbackInternal = Math.max(
		0.0,
		Math.min(typeof op.feedback === "number" ? op.feedback : 0.4, 0.95),
	);
	const wetInternal = Math.max(
		0.0,
		Math.min(typeof op.wet === "number" ? op.wet : 0.3, 1.0),
	);
	const dryInternal = Math.max(
		0.0,
		Math.min(typeof op.dry === "number" ? op.dry : 1.0, 1.0),
	);
	const pingPongInternal =
		typeof op.pingPong === "boolean" ? op.pingPong : false;

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

	const hasDelayTimeSig = isHandleConnected("delayTimeHandleId") ? 1.0 : 0.0;
	const hasFeedbackSig = isHandleConnected("feedbackHandleId") ? 1.0 : 0.0;
	const hasWetSig = isHandleConnected("wetHandleId") ? 1.0 : 0.0;
	const hasDrySig = isHandleConnected("dryHandleId") ? 1.0 : 0.0;

	// Allocate max possible delay buffer (5 seconds) to allow smooth dynamic modulation
	const maxDelaySec = 5.0;
	const bufferLength = Math.ceil(maxDelaySec * sampleRate);

	// 100% WebGPU Compute Path
	const nodeId = (op.id as string) || "audio-delay";
	const frame = ctx.frame ?? 0;
	const fps = ctx.fps ?? 24;

	const stateFloatCount = numChannels * bufferLength + 1;

	await WebGPUAudioProcessor.process(
		ctx.device,
		nodeId,
		channels,
		sampleRate,
		virtualMedia,
		frame,
		fps,
		DELAY_SHADER_TEMPLATE,
		() => [
			sampleRate,
			delaySec,
			feedbackInternal,
			wetInternal,
			dryInternal,
			pingPongInternal ? 1.0 : 0.0,
			bufferLength,
			hasDelayTimeSig,
			hasFeedbackSig,
			hasWetSig,
			hasDrySig,
			0.0, // baseTime
			frame,
			numSamples,
			numChannels,
			0, // padding
		],
		16, // Aligned to 16 bytes (16 * 4 = 64 bytes)
		stateFloatCount, // Persistent Ring Buffer state
		ctx?.renderId,
		true,
		ctx?.elapsedMs,
		ctx?.durationMs,
		undefined,
		undefined,
		PARAM_ORDER,
	);
};
