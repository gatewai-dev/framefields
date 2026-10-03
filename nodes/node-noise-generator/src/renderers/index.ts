import { defineRenderer } from "@gitframes/node-sdk/renderer";
import { NoiseWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: NoiseWebGPURenderer,
});
export { NoiseWebGPURenderer };
