import type { AudioProcessor } from "@gitframes/node-sdk";
import { WebGPUAudioProcessor } from "@gitframes/webgpu-renderers";

const PARAM_ORDER = ["roomSize", "damping", "wet", "dry", "width"];

const REVERB_SHADER_TEMPLATE = () => `
struct Uniforms {
    sampleRate     : f32,
    roomSize       : f32,
    damping        : f32,
    wet            : f32,
    dry            : f32,
    width          : f32,
    hasRoomSizeSig : f32,
    hasDampingSig  : f32,
    hasWetSig      : f32,
    hasDrySig      : f32,
    hasWidthSig    : f32,
    baseTime       : f32,
    frame          : f32,
    numSamples     : f32,
    numChannels    : f32,
    pad1           : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> inputChannels : array<f32>;
@group(0) @binding(2) var<storage, read_write> outputChannels : array<f32>;
@group(0) @binding(3) var<storage, read_write> state : array<f32>;
@group(0) @binding(4) var<storage, read> roomSizeSignal : array<f32>;
@group(0) @binding(5) var<storage, read> dampingSignal  : array<f32>;
@group(0) @binding(6) var<storage, read> wetSignal      : array<f32>;
@group(0) @binding(7) var<storage, read> drySignal      : array<f32>;
@group(0) @binding(8) var<storage, read> widthSignal    : array<f32>;

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
    let fixedgain: f32 = 0.015f;

    var bufIndices: array<u32, 24>;
    var filterStores: array<f32, 24>;
    var sizes: array<u32, 24>;
    var startOffsets: array<u32, 24>;

    for (var f = 0u; f < 24u; f = f + 1u) {
        let metaOffset = f * 4u;
        sizes[f] = u32(state[metaOffset]);
        startOffsets[f] = u32(state[metaOffset + 1u]);
        bufIndices[f] = u32(state[metaOffset + 2u]);
        var fs = state[metaOffset + 3u];
        if (is_nan_or_inf(fs)) { fs = 0.0f; }
        filterStores[f] = fs;
    }

    if (numChannels == 1u) {
        for (var index = 0u; index < numSamples; index = index + 1u) {
            // Dynamic parameter signal evaluation
            var effRoomSize = u.roomSize;
            if (u.hasRoomSizeSig > 0.5f) { effRoomSize = roomSizeSignal[index]; }
            effRoomSize = clamp(effRoomSize, 0.0f, 0.98f);

            var effDamping = u.damping;
            if (u.hasDampingSig > 0.5f) { effDamping = dampingSignal[index]; }
            effDamping = clamp(effDamping, 0.0f, 1.0f) * 0.4f;

            var effWet = u.wet;
            if (u.hasWetSig > 0.5f) { effWet = wetSignal[index]; }
            effWet = clamp(effWet, 0.0f, 1.0f) * 3.0f;

            var effDry = u.dry;
            if (u.hasDrySig > 0.5f) { effDry = drySignal[index]; }
            effDry = clamp(effDry, 0.0f, 2.0f);

            var x = inputChannels[index];
            if (is_nan_or_inf(x)) { x = 0.0f; }
            let inputVal = x * fixedgain;

            var combSum = 0.0f;
            for (var j = 0u; j < 8u; j = j + 1u) {
                let size = sizes[j];
                let startOffset = startOffsets[j];
                let bufferIndex = bufIndices[j];
                var fs = filterStores[j];

                var output = state[startOffset + bufferIndex];
                if (is_nan_or_inf(output)) { output = 0.0f; }

                fs = output * (1.0f - effDamping) + fs * effDamping;
                var nextVal = inputVal + fs * effRoomSize;
                if (is_nan_or_inf(nextVal)) { nextVal = 0.0f; }
                state[startOffset + bufferIndex] = clamp(nextVal, -4.0f, 4.0f);

                bufIndices[j] = (bufferIndex + 1u) % size;
                filterStores[j] = fs;
                combSum = combSum + output;
            }

            var revOut = combSum;
            for (var j = 0u; j < 4u; j = j + 1u) {
                let f = 8u + j;
                let size = sizes[f];
                let startOffset = startOffsets[f];
                let bufferIndex = bufIndices[f];

                var bufOut = state[startOffset + bufferIndex];
                if (is_nan_or_inf(bufOut)) { bufOut = 0.0f; }

                var nextVal = revOut + bufOut * 0.5f;
                if (is_nan_or_inf(nextVal)) { nextVal = 0.0f; }
                state[startOffset + bufferIndex] = clamp(nextVal, -4.0f, 4.0f);

                let output = bufOut - revOut;
                bufIndices[f] = (bufferIndex + 1u) % size;
                revOut = output;
            }

            var outVal = x * effDry + revOut * effWet;
            if (is_nan_or_inf(outVal)) { outVal = 0.0f; }

            if (outVal > 1.0f) { outVal = 1.0f; }
            else if (outVal < -1.0f) { outVal = -1.0f; }
            else if (outVal > 0.9f) { outVal = 0.9f + 0.1f * tanh((outVal - 0.9f) / 0.1f); }
            else if (outVal < -0.9f) { outVal = -0.9f + 0.1f * tanh((outVal + 0.9f) / 0.1f); }

            outputChannels[index] = outVal;
        }
    } else {
        for (var index = 0u; index < numSamples; index = index + 1u) {
            // Dynamic parameter signal evaluation
            var effRoomSize = u.roomSize;
            if (u.hasRoomSizeSig > 0.5f) { effRoomSize = roomSizeSignal[index]; }
            effRoomSize = clamp(effRoomSize, 0.0f, 0.98f);

            var effDamping = u.damping;
            if (u.hasDampingSig > 0.5f) { effDamping = dampingSignal[index]; }
            effDamping = clamp(effDamping, 0.0f, 1.0f) * 0.4f;

            var effWet = u.wet;
            if (u.hasWetSig > 0.5f) { effWet = wetSignal[index]; }
            effWet = clamp(effWet, 0.0f, 1.0f) * 3.0f;

            var effDry = u.dry;
            if (u.hasDrySig > 0.5f) { effDry = drySignal[index]; }
            effDry = clamp(effDry, 0.0f, 2.0f);

            var effWidth = u.width;
            if (u.hasWidthSig > 0.5f) { effWidth = widthSignal[index]; }
            effWidth = clamp(effWidth, 0.0f, 1.0f);

            let wet1 = effWet * (effWidth / 2.0f + 0.5f);
            let wet2 = effWet * ((1.0f - effWidth) / 2.0f);

            var inputL = inputChannels[index];
            if (is_nan_or_inf(inputL)) { inputL = 0.0f; }
            var inputR = inputChannels[numSamples + index];
            if (is_nan_or_inf(inputR)) { inputR = 0.0f; }

            let inputVal = (inputL + inputR) * fixedgain;

            // Left channel (Filters 0-11)
            var combSumL = 0.0f;
            for (var j = 0u; j < 8u; j = j + 1u) {
                let size = sizes[j];
                let startOffset = startOffsets[j];
                let bufferIndex = bufIndices[j];
                var fs = filterStores[j];

                var output = state[startOffset + bufferIndex];
                if (is_nan_or_inf(output)) { output = 0.0f; }

                fs = output * (1.0f - effDamping) + fs * effDamping;
                var nextVal = inputVal + fs * effRoomSize;
                if (is_nan_or_inf(nextVal)) { nextVal = 0.0f; }
                state[startOffset + bufferIndex] = clamp(nextVal, -4.0f, 4.0f);

                bufIndices[j] = (bufferIndex + 1u) % size;
                filterStores[j] = fs;
                combSumL = combSumL + output;
            }
            var revOutL = combSumL;
            for (var j = 0u; j < 4u; j = j + 1u) {
                let f = 8u + j;
                let size = sizes[f];
                let startOffset = startOffsets[f];
                let bufferIndex = bufIndices[f];

                var bufOut = state[startOffset + bufferIndex];
                if (is_nan_or_inf(bufOut)) { bufOut = 0.0f; }

                var nextVal = revOutL + bufOut * 0.5f;
                if (is_nan_or_inf(nextVal)) { nextVal = 0.0f; }
                state[startOffset + bufferIndex] = clamp(nextVal, -4.0f, 4.0f);

                let output = bufOut - revOutL;
                bufIndices[f] = (bufferIndex + 1u) % size;
                revOutL = output;
            }

            // Right channel (Filters 12-23)
            var combSumR = 0.0f;
            for (var j = 0u; j < 8u; j = j + 1u) {
                let f = 12u + j;
                let size = sizes[f];
                let startOffset = startOffsets[f];
                let bufferIndex = bufIndices[f];
                var fs = filterStores[f];

                var output = state[startOffset + bufferIndex];
                if (is_nan_or_inf(output)) { output = 0.0f; }

                fs = output * (1.0f - effDamping) + fs * effDamping;
                var nextVal = inputVal + fs * effRoomSize;
                if (is_nan_or_inf(nextVal)) { nextVal = 0.0f; }
                state[startOffset + bufferIndex] = clamp(nextVal, -4.0f, 4.0f);

                bufIndices[f] = (bufferIndex + 1u) % size;
                filterStores[f] = fs;
                combSumR = combSumR + output;
            }
            var revOutR = combSumR;
            for (var j = 0u; j < 4u; j = j + 1u) {
                let f = 20u + j;
                let size = sizes[f];
                let startOffset = startOffsets[f];
                let bufferIndex = bufIndices[f];

                var bufOut = state[startOffset + bufferIndex];
                if (is_nan_or_inf(bufOut)) { bufOut = 0.0f; }

                var nextVal = revOutR + bufOut * 0.5f;
                if (is_nan_or_inf(nextVal)) { nextVal = 0.0f; }
                state[startOffset + bufferIndex] = clamp(nextVal, -4.0f, 4.0f);

                let output = bufOut - revOutR;
                bufIndices[f] = (bufferIndex + 1u) % size;
                revOutR = output;
            }

            var outL = inputL * effDry + revOutL * wet1 + revOutR * wet2;
            var outR = inputR * effDry + revOutR * wet1 + revOutL * wet2;
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
    }

    for (var f = 0u; f < 24u; f = f + 1u) {
        let metaOffset = f * 4u;
        state[metaOffset + 2u] = f32(bufIndices[f]);
        state[metaOffset + 3u] = filterStores[f];
    }
}
`;

const leftCombLengths = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const leftAllpassLengths = [556, 441, 341, 225];

export const reverbAudioProcessor: AudioProcessor = async (
	channels,
	sampleRate,
	virtualMedia,
	ctx,
) => {
	if (!ctx?.device) {
		throw new Error("GPUDevice is required for WebGPU Reverb.");
	}

	const op = (virtualMedia.operation as Record<string, unknown>) || {};
	const inputs = (op.inputs as Record<string, any>) || {};

	const numChannels = channels.length;
	if (numChannels === 0) return;
	const numSamples = channels[0].length;
	if (numSamples === 0) return;

	// Scale parameters based on Freeverb tuning specs
	const roomSizeInternal = Math.max(
		0,
		Math.min(typeof op.roomSize === "number" ? op.roomSize : 0.5, 0.98),
	);
	const dampingInternal = Math.max(
		0,
		Math.min(typeof op.damping === "number" ? op.damping : 0.5, 1.0),
	);
	const wetInternal = Math.max(
		0,
		Math.min(typeof op.wet === "number" ? op.wet : 0.3, 1.0),
	);
	const dryInternal = Math.max(
		0,
		Math.min(typeof op.dry === "number" ? op.dry : 1.0, 1.0),
	);
	const widthInternal = Math.max(
		0,
		Math.min(typeof op.width === "number" ? op.width : 1.0, 1.0),
	);

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

	const hasRoomSizeSig = isHandleConnected("roomSizeHandleId") ? 1.0 : 0.0;
	const hasDampingSig = isHandleConnected("dampingHandleId") ? 1.0 : 0.0;
	const hasWetSig = isHandleConnected("wetHandleId") ? 1.0 : 0.0;
	const hasDrySig = isHandleConnected("dryHandleId") ? 1.0 : 0.0;
	const hasWidthSig = isHandleConnected("widthHandleId") ? 1.0 : 0.0;

	const scale = sampleRate / 44100;

	const nodeId = (op.id as string) || "audio-reverb";
	const frame = ctx.frame ?? 0;
	const fps = ctx.fps ?? 24;

	// Left & Right filter delay buffer dimensions
	const sizesL: number[] = [];
	const sizesR: number[] = [];

	leftCombLengths.forEach((len) => {
		sizesL.push(Math.round(len * scale));
	});
	leftCombLengths.forEach((len) => {
		sizesR.push(Math.round((len + 23) * scale));
	});
	leftAllpassLengths.forEach((len) => {
		sizesL.push(Math.round(len * scale));
	});
	leftAllpassLengths.forEach((len) => {
		sizesR.push(Math.round((len + 23) * scale));
	});

	const totalMetadataFloats = 24 * 4; // 24 filters * 4 float attributes
	let totalDelaySamples = 0;
	const filterSizes = [...sizesL, ...sizesR];
	for (const size of filterSizes) {
		totalDelaySamples += size;
	}

	const stateFloatCount = totalMetadataFloats + totalDelaySamples;

	const metaData = new Float32Array(totalMetadataFloats);
	let currentOffset = totalMetadataFloats;

	for (let f = 0; f < 24; f++) {
		const size = filterSizes[f];
		metaData[f * 4] = size;
		metaData[f * 4 + 1] = currentOffset;
		metaData[f * 4 + 2] = 0.0; // writeIndex
		metaData[f * 4 + 3] = 0.0; // filterStore
		currentOffset += size;
	}

	await WebGPUAudioProcessor.process(
		ctx.device,
		nodeId,
		channels,
		sampleRate,
		virtualMedia,
		frame,
		fps,
		REVERB_SHADER_TEMPLATE,
		() => [
			sampleRate,
			roomSizeInternal,
			dampingInternal,
			wetInternal,
			dryInternal,
			widthInternal,
			hasRoomSizeSig,
			hasDampingSig,
			hasWetSig,
			hasDrySig,
			hasWidthSig,
			0.0, // baseTime
			frame,
			numSamples,
			numChannels,
			0, // pad1
		],
		16, // Aligned to 16 bytes (16 * 4 = 64 bytes)
		stateFloatCount,
		ctx?.renderId,
		true,
		ctx?.elapsedMs,
		ctx?.durationMs,
		metaData,
		undefined,
		PARAM_ORDER,
	);
};

export const clearReverbStateAndProcessor = () => {};
