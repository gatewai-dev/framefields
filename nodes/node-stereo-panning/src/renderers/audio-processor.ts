import {
	type AudioProcessor,
	isSignal,
	resolveNumber,
} from "@framefields/node-sdk";
import { WebGPUAudioProcessor } from "@framefields/webgpu-renderers";

const PARAM_ORDER = ["pan"];

const PANNING_SHADER_TEMPLATE = () => `
struct Uniforms {
    sampleRate  : f32,
    pan         : f32,
    hasPanSig   : f32,
    baseTime    : f32,
    frame       : f32,
    numSamples  : f32,
    numChannels : f32,
    pad1        : f32,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> inputChannels : array<f32>;
@group(0) @binding(2) var<storage, read_write> outputChannels : array<f32>;
@group(0) @binding(3) var<storage, read_write> state : array<f32>;
@group(0) @binding(4) var<storage, read> panSignal : array<f32>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    if (gid.x != 0u) { return; }

    let numSamples = u32(u.numSamples);
    let numChannels = u32(u.numChannels);

    for (var index = 0u; index < numSamples; index = index + 1u) {
        var currentPan = u.pan;
        if (u.hasPanSig > 0.5f) {
            currentPan = panSignal[index];
        }
        let clampedPan = max(-1.0f, min(1.0f, currentPan));
        var leftGain = 1.0f;
        var rightGain = 1.0f;

        if (clampedPan < 0.0f) {
            rightGain = 1.0f + clampedPan;
        } else if (clampedPan > 0.0f) {
            leftGain = 1.0f - clampedPan;
        }

        if (numChannels > 1u) {
            outputChannels[index] = inputChannels[index] * leftGain;
            outputChannels[numSamples + index] = inputChannels[numSamples + index] * rightGain;
        } else {
            outputChannels[index] = inputChannels[index] * leftGain;
        }
    }

    // Dummy reference to prevent state binding from being optimized out
    state[0] = state[0];
}
`;

export const stereoPanningAudioProcessor: AudioProcessor = async (
	channels,
	sampleRate,
	node,
	ctx,
) => {
	if (!ctx?.device) {
		throw new Error("GPUDevice is required for WebGPU Stereo Panning.");
	}

	const op = (node.operation as Record<string, unknown> | undefined) || {};
	const inputs =
		(op.inputs as Record<
			string,
			{ connectionValid?: boolean; outputItem?: { type?: string } }
		>) || {};

	const pan = resolveNumber(op.pan, 0);
	const clampedPan = Math.max(-1, Math.min(1, pan));

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

	const hasPanSig =
		isSignal(op.pan) ||
		isSignal((op.signals as Record<string, unknown> | undefined)?.pan) ||
		isHandleConnected("panHandleId")
			? 1.0
			: 0.0;

	if (channels.length === 0) return;
	const numSamples = channels[0].length;
	if (numSamples === 0) return;

	if (channels.length === 1) {
		const rightChannel = new Float32Array(numSamples);
		rightChannel.set(channels[0]);
		channels.push(rightChannel);
	}

	const numChannels = channels.length;

	const nodeId = (op.id as string) || "stereo-panning";
	const frame = ctx.frame ?? 0;
	const fps = ctx.fps ?? 24;

	await WebGPUAudioProcessor.process(
		ctx.device,
		nodeId,
		channels,
		sampleRate,
		node,
		frame,
		fps,
		PANNING_SHADER_TEMPLATE,
		() => [
			sampleRate,
			clampedPan,
			hasPanSig,
			0.0, // baseTime
			frame,
			numSamples,
			numChannels,
			0.0, // padding
		],
		8, // Aligned to 16 bytes (8 * 4 = 32 bytes)
		1, // stateFloatCount
		ctx?.renderId,
		true,
		ctx?.elapsedMs,
		ctx?.durationMs,
		undefined,
		undefined,
		PARAM_ORDER,
	);
};
