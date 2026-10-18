import { defineRenderer } from "@framefields/node-sdk/renderer";
import { DitherWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: DitherWebGPURenderer,
});
export { DitherWebGPURenderer };
