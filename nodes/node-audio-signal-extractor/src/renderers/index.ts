import { defineRenderer } from "@framefields/node-sdk/renderer";
import { audioSignalExtractorAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: audioSignalExtractorAudioProcessor,
});
