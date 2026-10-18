import { defineRenderer } from "@framefields/node-sdk/renderer";
import { ToonWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ToonWebGPURenderer,
});
export { ToonWebGPURenderer };
