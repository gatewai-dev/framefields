import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { stereoPanningAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: stereoPanningAudioProcessor,
});
