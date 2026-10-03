import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { ExtractFrameWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ExtractFrameWebGPURenderer,
});
