import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { drawAudioSignalExtractorNode } from "@framefields/webgpu-renderers";

export const AudioSignalExtractorWebGPURenderer: WebGPUNodeRenderer = async (
	args,
) => {
	const { ctx, encoder, pass, targetWidth, targetHeight, props } = args;
	const op = (props.virtualMedia?.operation as Record<string, unknown>) || {};

	await drawAudioSignalExtractorNode(ctx, encoder, pass, {
		nodeId: props.renderId,
		sourceUrl: typeof op.sourceUrl === "string" ? op.sourceUrl : undefined,
		extractionMode: op.extractionMode as
			| "rms_envelope"
			| "transient_beat"
			| "sub_bass"
			| "bass"
			| "mid"
			| "high"
			| "spectral_flux"
			| undefined,
		attackMs: typeof op.attackMs === "number" ? op.attackMs : 10,
		releaseMs: typeof op.releaseMs === "number" ? op.releaseMs : 120,
		sensitivity: typeof op.sensitivity === "number" ? op.sensitivity : 1.0,
		noiseFloorDb: typeof op.noiseFloorDb === "number" ? op.noiseFloorDb : -45,
		dynamicRangeDb:
			typeof op.dynamicRangeDb === "number" ? op.dynamicRangeDb : 36,
		smoothing: typeof op.smoothing === "number" ? op.smoothing : 0.15,
		curve: op.curve as
			| "linear"
			| "exponential"
			| "logarithmic"
			| "square"
			| "smoothstep"
			| undefined,
		beatThreshold:
			typeof op.beatThreshold === "number" ? op.beatThreshold : 0.55,
		beatDecayMs: typeof op.beatDecayMs === "number" ? op.beatDecayMs : 80,
		frame: props.frame ?? 0,
		fps: props.fps ?? 24,
		elapsedMs: props.elapsedMs,
		durationMs: props.durationMs,
		width: targetWidth,
		height: targetHeight,
		opacity: props.opacity,
		renderId: props.renderId,
		signalConfig: op,
	});
};
