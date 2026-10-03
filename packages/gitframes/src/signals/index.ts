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
} from "@gitframes/core";
export * as AudioSignalExtractorNode from "@gitframes/node-audio-signal-extractor";
export { default as modulateRenderer } from "@gitframes/node-modulate/renderer";
export * as SignalNode from "@gitframes/node-signal";
export * as SignalGateNode from "@gitframes/node-signal-gate";
export * as SignalMathNode from "@gitframes/node-signal-math";
export {
	AudioSignalComputePipeline,
	buildWGSLSignalFn,
	type MasterAudioEntry,
	SignalRegistry,
	type SignalRegistryResource,
	signalRegistry,
} from "@gitframes/webgpu-renderers";
export {
	AudioSignal,
	type AudioSignalOptions,
	type ExtractedAudioSignalsBundle,
} from "./audio.js";
