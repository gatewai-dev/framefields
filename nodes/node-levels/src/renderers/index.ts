import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { LevelsWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: LevelsWebGPURenderer,
});
