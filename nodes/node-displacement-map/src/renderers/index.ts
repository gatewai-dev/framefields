import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { DisplacementMapWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: DisplacementMapWebGPURenderer,
});
