import { defineRenderer } from "@framefields/node-sdk/renderer";
import { delayAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: delayAudioProcessor,
});
