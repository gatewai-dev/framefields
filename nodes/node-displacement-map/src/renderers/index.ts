import { defineRenderer } from "@framefields/node-sdk/renderer";
import { DisplacementMapWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: DisplacementMapWebGPURenderer,
});
