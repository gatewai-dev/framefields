import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { WebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer,
});
