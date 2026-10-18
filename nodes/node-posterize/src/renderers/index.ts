import { defineRenderer } from "@framefields/node-sdk/renderer";
import { PosterizeWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: PosterizeWebGPURenderer,
});
export { PosterizeWebGPURenderer };
