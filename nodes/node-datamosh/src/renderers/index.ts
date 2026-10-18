import { defineRenderer } from "@framefields/node-sdk/renderer";
import { DatamoshWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: DatamoshWebGPURenderer,
});
export { DatamoshWebGPURenderer };
