import { defineRenderer } from "@framefields/node-sdk/renderer";
import { HalftoneScreenWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: HalftoneScreenWebGPURenderer,
});
