export {
	computed,
	cosineSignal,
	type FrameSignal,
	Signal,
	type SignalContext,
	type SignalValue,
	type SineSignalOptions,
	signal,
	signalBuilder,
	sineSignal,
} from "@framefields/core";
export * as AudioSignalExtractorNode from "@framefields/node-audio-signal-extractor";
export { default as modulateRenderer } from "@framefields/node-modulate/renderer";
export * as SignalNode from "@framefields/node-signal";
export * as SignalGateNode from "@framefields/node-signal-gate";
export * as SignalMathNode from "@framefields/node-signal-math";
export {
	AudioSignalComputePipeline,
	buildWGSLSignalFn,
	type MasterAudioEntry,
	SignalRegistry,
	type SignalRegistryResource,
	signalRegistry,
} from "@framefields/webgpu-renderers";
export {
	AudioSignal,
	type AudioSignalOptions,
	type ExtractedAudioSignalsBundle,
} from "./audio.js";
