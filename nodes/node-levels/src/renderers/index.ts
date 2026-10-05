import { defineRenderer } from "@framefields/node-sdk/renderer";
import { LevelsWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: LevelsWebGPURenderer,
});
