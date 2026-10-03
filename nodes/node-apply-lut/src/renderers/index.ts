import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { LutWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: LutWebGPURenderer,
});
