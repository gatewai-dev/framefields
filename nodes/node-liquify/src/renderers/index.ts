import { defineRenderer } from "@framefields/node-sdk/renderer";
import { LiquifyWebGPURenderer } from "./webgpu-renderer.js";

export { LiquifyWebGPURenderer };

export default defineRenderer({
	WebGPURenderer: LiquifyWebGPURenderer,
});
