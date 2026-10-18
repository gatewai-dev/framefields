import { defineRenderer } from "@framefields/node-sdk/renderer";
import { AsciiWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: AsciiWebGPURenderer,
});
export { AsciiWebGPURenderer };
