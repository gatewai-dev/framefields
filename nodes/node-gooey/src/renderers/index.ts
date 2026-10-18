import { defineRenderer } from "@framefields/node-sdk/renderer";
import { GooeyWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: GooeyWebGPURenderer,
});
export { GooeyWebGPURenderer };
