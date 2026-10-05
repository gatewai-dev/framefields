import { defineRenderer } from "@framefields/node-sdk/renderer";
import { noiseGateAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: noiseGateAudioProcessor,
});
