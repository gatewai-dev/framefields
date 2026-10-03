import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { audioSignalExtractorAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: audioSignalExtractorAudioProcessor,
});
