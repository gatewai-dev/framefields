import { defineRenderer } from "@framefields/node-sdk/renderer";
import { VignetteWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: VignetteWebGPURenderer,
});
