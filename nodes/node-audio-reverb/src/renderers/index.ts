import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { reverbAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: reverbAudioProcessor,
});
