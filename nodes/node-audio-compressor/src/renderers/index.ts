import { defineRenderer } from "@framefields/node-sdk/renderer";
import { compressorAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: compressorAudioProcessor,
});
