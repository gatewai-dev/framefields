import { defineRenderer } from "@framefields/node-sdk/renderer";
import { LutWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: LutWebGPURenderer,
});
