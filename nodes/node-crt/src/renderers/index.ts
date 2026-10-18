import { defineRenderer } from "@framefields/node-sdk/renderer";
import { CRTWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: CRTWebGPURenderer,
});
export { CRTWebGPURenderer };
