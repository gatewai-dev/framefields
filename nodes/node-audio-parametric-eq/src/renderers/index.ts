import { defineRenderer } from "@framefields/node-sdk/renderer";
import { parametricEqAudioProcessor } from "./audio-processor.js";

export default defineRenderer({
	audioProcessor: parametricEqAudioProcessor,
});
