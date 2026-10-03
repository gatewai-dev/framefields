import type { AudioProcessor } from "@gitframes/node-sdk";
import {
	type AudioSignalComputeConfig,
	AudioSignalComputePipeline,
	shaderStore,
	signalRegistry,
} from "@gitframes/webgpu-renderers";

export const audioSignalExtractorAudioProcessor: AudioProcessor = async (
	channels,
	sampleRate,
	virtualMedia,
	ctx,
) => {
	if (!ctx?.device) return;
	if (!channels || channels.length === 0 || channels[0].length === 0) return;

	const op = (virtualMedia.operation as Record<string, unknown>) || {};
	const nodeId =
		(op.nodeId as string) || (op.id as string) || "audio-signal-extractor";
	const fps = ctx.fps ?? 24;

	const config: AudioSignalComputeConfig = {
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
	};

	// 1. WebGPU feature extraction on the audio channels produced by the pipeline
	const signals = await AudioSignalComputePipeline.extractFeatures(
		ctx.device,
		channels,
		sampleRate,
		fps,
		config,
		512,
	);

	// 2. Register signals at signal store (signalRegistry & shaderStore)
	signalRegistry.registerBuffer(
		ctx.device,
		nodeId,
		signals.primaryBuffer,
		ctx.renderId,
	);
	signalRegistry.registerBuffer(
		ctx.device,
		`${nodeId}_beat`,
		signals.beatBuffer,
		ctx.renderId,
	);
	signalRegistry.registerBuffer(
		ctx.device,
		`${nodeId}_bass`,
		signals.bassBuffer,
		ctx.renderId,
	);
	signalRegistry.registerBuffer(
		ctx.device,
		`${nodeId}_energy`,
		signals.energyBuffer,
		ctx.renderId,
	);

	signalRegistry.registerTexture(
		ctx.device,
		nodeId,
		signals.texture,
		signals.textureView,
		ctx.renderId,
	);
	signalRegistry.registerTexture(
		ctx.device,
		`${nodeId}_beat`,
		signals.texture,
		signals.textureView,
		ctx.renderId,
	);
	signalRegistry.registerTexture(
		ctx.device,
		`${nodeId}_bass`,
		signals.texture,
		signals.textureView,
		ctx.renderId,
	);
	signalRegistry.registerTexture(
		ctx.device,
		`${nodeId}_energy`,
		signals.texture,
		signals.textureView,
		ctx.renderId,
	);

	const safeNodeId = nodeId.replace(/[^a-zA-Z0-9]/g, "_");
	const fnName = `signal_${safeNodeId}`;
	const wgsl = `
fn ${fnName}(t: f32, x: f32, y: f32, z: f32, i: u32, n: u32, frame: u32, color: vec4f, t_elapsed: f32, duration: f32) -> f32 {
    return 0.0f;
}
`;
	shaderStore.register(
		nodeId,
		{
			wgsl,
			name: fnName,
			outputType: "f32",
			fnParams: [],
		},
		ctx.renderId,
	);
};
