import { defineRenderer } from "@framefields/node-sdk/renderer";
import { TrailsWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: TrailsWebGPURenderer,
});
export { TrailsWebGPURenderer };
