import { defineRenderer } from "@framefields/node-sdk/renderer";
import { ShaderWebGPURenderer } from "./webgpu-renderer.js";

export default defineRenderer({
	WebGPURenderer: ShaderWebGPURenderer,
});
export { ShaderWebGPURenderer };
