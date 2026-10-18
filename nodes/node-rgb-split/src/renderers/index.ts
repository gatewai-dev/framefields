import { defineRenderer } from "@framefields/node-sdk/renderer";
import { RGBSplitWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: RGBSplitWebGPURenderer,
});
export { RGBSplitWebGPURenderer };
