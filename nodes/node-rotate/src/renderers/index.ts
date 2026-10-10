import { defineRenderer } from "@framefields/node-sdk/renderer";
import { WebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer,
});
