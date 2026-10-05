import { defineRenderer } from "@framefields/node-sdk/renderer";
import { reverbAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: reverbAudioProcessor,
});
