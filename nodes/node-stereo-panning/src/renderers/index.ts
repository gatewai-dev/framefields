import { defineRenderer } from "@framefields/node-sdk/renderer";
import { stereoPanningAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: stereoPanningAudioProcessor,
});
