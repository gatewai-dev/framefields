import { defineRenderer } from "@framefields/node-sdk/renderer";
import { ContourWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ContourWebGPURenderer,
});
export { ContourWebGPURenderer };
