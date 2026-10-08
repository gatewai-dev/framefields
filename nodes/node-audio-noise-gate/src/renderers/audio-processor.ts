import { type AudioProcessor, resolveNumber } from "@framefields/node-sdk";
import { WebGPUAudioProcessor } from "@framefields/webgpu-renderers";

const PARAM_ORDER = ["threshold", "attack", "hold", "release", "range"];

const NOISE_GATE_SHADER_TEMPLATE = () => `
struct Uniforms {
    sampleRate       : f32,
    threshold        : f32,
    attack           : f32,
    hold             : f32,
    release          : f32,
    closedGain       : f32,
    windowLength     : f32,
    hasThresholdSig  : f32,
    hasAttackSig     : f32,
    hasHoldSig       : f32,
    hasReleaseSig    : f32,
    hasRangeSig      : f32,
    baseTime         : f32,
    frame            : f32,
    numSamples       : f32,
    numChannels      : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> inputChannels : array<f32>;
@group(0) @binding(2) var<storage, read_write> outputChannels : array<f32>;
@group(0) @binding(3) var<storage, read_write> state : array<f32>;
@group(0) @binding(4) var<storage, read> thresholdSignal : array<f32>;
@group(0) @binding(5) var<storage, read> attackSignal    : array<f32>;
@group(0) @binding(6) var<storage, read> holdSignal      : array<f32>;
@group(0) @binding(7) var<storage, read> releaseSignal   : array<f32>;
@group(0) @binding(8) var<storage, read> rangeSignal     : array<f32>;

fn log10(x: f32) -> f32 {
    return log(x) * 0.4342944819032518f;
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
    let windowLength = u32(u.windowLength);

    var gateState = u32(state[0]); // 0=CLOSED, 1=ATTACK, 2=OPEN, 3=HOLD, 4=RELEASE
    if (is_nan_or_inf(state[0])) { gateState = 0u; }

    var currentGain = state[1];
    if (is_nan_or_inf(currentGain)) { currentGain = 0.0f; }

    var gainAtTransition = state[2];
    if (is_nan_or_inf(gainAtTransition)) { gainAtTransition = 0.0f; }

    var attackSamplesLeft = i32(state[3]);
    var holdSamplesLeft = i32(state[4]);
    var releaseSamplesLeft = i32(state[5]);
    var writeIndex = u32(state[6]);
    var sumSquares = state[7];
    if (is_nan_or_inf(sumSquares)) { sumSquares = 0.0f; }

    let sampleRate = u.sampleRate;

    for (var index = 0u; index < numSamples; index = index + 1u) {
        // 1. Dynamic Parameter Modulation & Anti-Explosion Clamping
        var effThreshold = u.threshold;
        if (u.hasThresholdSig > 0.5f) {
            effThreshold = thresholdSignal[index];
        }
        effThreshold = clamp(effThreshold, -120.0f, 0.0f);

        var effAttack = u.attack;
        if (u.hasAttackSig > 0.5f) {
            effAttack = attackSignal[index];
        }
        effAttack = clamp(effAttack, 0.0001f, 5.0f);

        var effHold = u.hold;
        if (u.hasHoldSig > 0.5f) {
            effHold = holdSignal[index];
        }
        effHold = clamp(effHold, 0.001f, 10.0f);

        var effRelease = u.release;
        if (u.hasReleaseSig > 0.5f) {
            effRelease = releaseSignal[index];
        }
        effRelease = clamp(effRelease, 0.01f, 10.0f);

        var effRange = u.closedGain;
        if (u.hasRangeSig > 0.5f) {
            let rDb = clamp(rangeSignal[index], -120.0f, 0.0f);
            effRange = select(0.0f, pow(10.0f, rDb / 20.0f), rDb > -96.0f);
        }
        effRange = clamp(effRange, 0.0f, 1.0f);

        // 2. Peak & RMS Window Calculation
        var peak = 0.0f;
        for (var c = 0u; c < numChannels; c = c + 1u) {
            var val = abs(inputChannels[c * numSamples + index]);
            if (is_nan_or_inf(val)) { val = 0.0f; }
            if (val > peak) {
                peak = val;
            }
        }

        let inputPowerSq = peak * peak;
        let oldestSq = state[8u + writeIndex];
        state[8u + writeIndex] = inputPowerSq;
        sumSquares = max(0.0f, sumSquares - oldestSq + inputPowerSq);
        writeIndex = (writeIndex + 1u) % windowLength;

        if (writeIndex == 0u) {
            var sum = 0.0f;
            for (var j = 0u; j < windowLength; j = j + 1u) {
                sum = sum + state[8u + j];
            }
            sumSquares = sum;
        }

        let rms = sqrt(sumSquares / f32(windowLength));
        let db = 20.0f * log10(max(rms, 1e-9f));

        let signalAboveThreshold = db >= effThreshold;

        if (signalAboveThreshold) {
            if (gateState == 0u || gateState == 4u) {
                gateState = 1u; // ATTACK
                gainAtTransition = currentGain;
                var samples = i32(round(effAttack * sampleRate));
                if (samples <= 0) { samples = 1; }
                attackSamplesLeft = samples;
            } else if (gateState == 3u) {
                gateState = 2u; // OPEN
                currentGain = 1.0f;
            }
        } else {
            if (gateState == 2u || gateState == 1u) {
                gateState = 3u; // HOLD
                var samples = i32(round(effHold * sampleRate));
                if (samples <= 0) { samples = 1; }
                holdSamplesLeft = samples;
            }
        }

        if (gateState == 0u) {
            currentGain = effRange;
        } else if (gateState == 2u) {
            currentGain = 1.0f;
        } else if (gateState == 1u) {
            var totalAttackSamples = i32(round(effAttack * sampleRate));
            if (totalAttackSamples <= 0) { totalAttackSamples = 1; }
            let progress = 1.0f - f32(attackSamplesLeft) / f32(totalAttackSamples);
            currentGain = gainAtTransition + progress * (1.0f - gainAtTransition);

            attackSamplesLeft = attackSamplesLeft - 1;
            if (attackSamplesLeft <= 0) {
                gateState = 2u;
                currentGain = 1.0f;
            }
        } else if (gateState == 3u) {
            currentGain = 1.0f;
            holdSamplesLeft = holdSamplesLeft - 1;
            if (holdSamplesLeft <= 0) {
                gateState = 4u; // RELEASE
                gainAtTransition = 1.0f;
                var samples = i32(round(effRelease * sampleRate));
                if (samples <= 0) { samples = 1; }
                releaseSamplesLeft = samples;
            }
        } else if (gateState == 4u) {
            var totalReleaseSamples = i32(round(effRelease * sampleRate));
            if (totalReleaseSamples <= 0) { totalReleaseSamples = 1; }
            let progress = 1.0f - f32(releaseSamplesLeft) / f32(totalReleaseSamples);
            currentGain = gainAtTransition + progress * (effRange - gainAtTransition);

            releaseSamplesLeft = releaseSamplesLeft - 1;
            if (releaseSamplesLeft <= 0) {
                gateState = 0u;
                currentGain = effRange;
            }
        }

        currentGain = clamp(currentGain, 0.0f, 1.0f);

        for (var c = 0u; c < numChannels; c = c + 1u) {
            let sampleIndex = c * numSamples + index;
            var inVal = inputChannels[sampleIndex];
            if (is_nan_or_inf(inVal)) { inVal = 0.0f; }

            var outVal = inVal * currentGain;
            if (is_nan_or_inf(outVal)) { outVal = 0.0f; }

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

    state[0] = f32(gateState);
    state[1] = currentGain;
    state[2] = gainAtTransition;
    state[3] = f32(attackSamplesLeft);
    state[4] = f32(holdSamplesLeft);
    state[5] = f32(releaseSamplesLeft);
    state[6] = f32(writeIndex);
    state[7] = sumSquares;
}
`;

export const noiseGateAudioProcessor: AudioProcessor = async (
	channels,
	sampleRate,
	virtualMedia,
	ctx,
) => {
	if (!ctx?.device) {
		throw new Error("GPUDevice is required for WebGPU Noise Gate.");
	}

	const op = (virtualMedia.operation as Record<string, unknown>) || {};
	const inputs =
		(op.inputs as Record<
			string,
			{ connectionValid?: boolean; outputItem?: { type?: string } }
		>) || {};

	const threshold = resolveNumber(op.threshold, -40);
	const attack = resolveNumber(op.attack, 0.005);
	const hold = resolveNumber(op.hold, 0.05);
	const release = resolveNumber(op.release, 0.1);
	const range = resolveNumber(op.range, -80);

	const closedGain = range <= -96 ? 0 : 10 ** (range / 20);

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

	const hasThresholdSig = isHandleConnected("thresholdHandleId") ? 1.0 : 0.0;
	const hasAttackSig = isHandleConnected("attackHandleId") ? 1.0 : 0.0;
	const hasHoldSig = isHandleConnected("holdHandleId") ? 1.0 : 0.0;
	const hasReleaseSig = isHandleConnected("releaseHandleId") ? 1.0 : 0.0;
	const hasRangeSig = isHandleConnected("rangeHandleId") ? 1.0 : 0.0;

	const numChannels = channels.length;
	if (numChannels === 0) return;
	const numSamples = channels[0].length;
	if (numSamples === 0) return;

	// 10ms RMS window
	const windowLength = Math.max(1, Math.round(0.01 * sampleRate));

	// 100% WebGPU Compute Path
	const nodeId = (op.id as string) || "audio-noise-gate";
	const frame = ctx.frame ?? 0;
	const fps = ctx.fps ?? 24;

	const stateFloatCount = 8 + windowLength;

	await WebGPUAudioProcessor.process(
		ctx.device,
		nodeId,
		channels,
		sampleRate,
		virtualMedia,
		frame,
		fps,
		NOISE_GATE_SHADER_TEMPLATE,
		() => [
			sampleRate,
			threshold,
			attack,
			hold,
			release,
			closedGain,
			windowLength,
			hasThresholdSig,
			hasAttackSig,
			hasHoldSig,
			hasReleaseSig,
			hasRangeSig,
			0.0, // baseTime
			frame,
			numSamples,
			numChannels,
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
export const clearNoiseGateStateAndProcessor = () => {};
