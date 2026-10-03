import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { VisionWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: VisionWebGPURenderer,
});
