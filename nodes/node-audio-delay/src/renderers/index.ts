import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { delayAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: delayAudioProcessor,
});
