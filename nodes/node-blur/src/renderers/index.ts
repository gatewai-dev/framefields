import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { BlurWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: BlurWebGPURenderer,
});
