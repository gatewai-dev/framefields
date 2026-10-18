import { defineRenderer } from "@framefields/node-sdk/renderer";
import { PixelateWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: PixelateWebGPURenderer,
});
export { PixelateWebGPURenderer };
