import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { fadeAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: fadeAudioProcessor,
});
